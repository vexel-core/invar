import fs from 'node:fs';
import path from 'node:path';
import type { InvarConfig, TransactionResult } from '../config/types.js';
import { computeVaultState } from '../vault/hasher.js';
import { verifyVaultIntegrity } from '../vault/locker.js';
import {
  createShadowWorktree,
  destroyShadowWorktree,
  type ShadowWorktreeInstance,
} from '../shadow/worktree.js';
import { extractShadowDiff, applyShadowDiffToActiveTree } from '../shadow/merger.js';
import { runLockedSuite } from '../gate/runner.js';
import { captureActiveTreeStatus, detectActiveTreeEscape } from './escape.js';
import { saveAuditLog } from '../audit/logger.js';

export interface CoordinatorOptions {
  intent?: string;
  onLog?: (message: string) => void;
}

export function parkQuarantine(
  baseDir: string,
  txId: string,
  diff: string,
  status: 'tampered' | 'test_failure' | 'ast_violation',
  reason: string
): string {
  const qDir = path.join(baseDir, '.invar', 'quarantine', txId);
  fs.mkdirSync(qDir, { recursive: true });

  const manifest = {
    txId,
    status,
    reason,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(qDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (diff) {
    fs.writeFileSync(path.join(qDir, 'candidate.patch'), diff, 'utf8');
  }

  return qDir;
}

export async function executeTransaction(
  baseDir: string,
  config: InvarConfig,
  agentExecutor: (shadowDir: string) => Promise<void> | void,
  options: CoordinatorOptions = {}
): Promise<TransactionResult> {
  const txId = `tx_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const log = options.onLog || (() => {});

  log(`[invar] Initializing transaction ${txId}...`);

  // 1. Capture initial status of active tree for escape monitoring
  const initialActiveStatus = captureActiveTreeStatus(baseDir);

  // 2. Create shadow worktree
  let shadow: ShadowWorktreeInstance | null = null;
  try {
    shadow = createShadowWorktree(baseDir, txId);
    log(`[invar] Shadow worktree mounted at: ${shadow.shadowDir}`);
  } catch (err: any) {
    return {
      txId,
      status: 'ROLLED_BACK',
      success: false,
      error: `Failed to create shadow worktree: ${err.message}`,
      preVaultRoot: '',
    };
  }

  // 3. Compute pre-run Merkle root
  const preVault = computeVaultState(shadow.shadowDir, config.vault.locked_paths);
  log(`[invar] Locked ${preVault.fileCount} test suites (Merkle root: ${preVault.rootHash.substring(0, 12)}...)`);

  let diff = '';

  try {
    // 4. Execute the agent task inside shadow worktree
    log(`[invar] Executing agent task inside shadow worktree...`);
    await agentExecutor(shadow.shadowDir);

    // 5. Check for active tree escape (agent modifying files outside shadow)
    const escapeCheck = detectActiveTreeEscape(baseDir, initialActiveStatus);
    if (escapeCheck.escaped) {
      diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
      const qPath = parkQuarantine(
        baseDir,
        txId,
        diff,
        'tampered',
        `Agent escaped shadow sandbox and modified parent repo: ${escapeCheck.unauthorizedModifications.join(', ')}`
      );

      destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
      return {
        txId,
        status: 'QUARANTINED',
        success: false,
        error: `Hard Violation: Agent escaped shadow sandbox. Changes rolled back. Diff parked at ${qPath}`,
        preVaultRoot: preVault.rootHash,
        quarantinePath: qPath,
      };
    }

    // 6. Verify Vault Integrity (Anti-Cheat)
    log(`[invar] Verifying anti-cheat test vault integrity...`);
    const vaultCheck = verifyVaultIntegrity(
      shadow.shadowDir,
      preVault,
      config.vault.locked_paths,
      config.vault.mode
    );

    if (vaultCheck.tamperDetected) {
      diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
      const qPath = parkQuarantine(
        baseDir,
        txId,
        diff,
        'tampered',
        vaultCheck.error || 'Test suite tampering detected'
      );

      destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
      return {
        txId,
        status: 'QUARANTINED',
        success: false,
        error: `Anti-Cheat Violation: ${vaultCheck.error}. Implementation diff quarantined at ${qPath}`,
        preVaultRoot: preVault.rootHash,
        postVaultRoot: vaultCheck.postVault.rootHash,
        quarantinePath: qPath,
      };
    }

    // 7. Run Locked Test Suite
    if (config.project.test_runner) {
      log(`[invar] Running locked test suite: "${config.project.test_runner}"...`);
      const testResult = runLockedSuite(shadow.shadowDir, config.project.test_runner);

      if (!testResult.passed) {
        diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
        const qPath = parkQuarantine(
          baseDir,
          txId,
          diff,
          'test_failure',
          `Tests failed with exit code ${testResult.exitCode}\n${testResult.stderr || testResult.stdout}`
        );

        destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
        return {
          txId,
          status: 'QUARANTINED',
          success: false,
          error: `Test suite failed (exit code ${testResult.exitCode}). Candidate diff quarantined at ${qPath}`,
          preVaultRoot: preVault.rootHash,
          postVaultRoot: vaultCheck.postVault.rootHash,
          testResult,
          quarantinePath: qPath,
        };
      }
    }

    // 8. All gates passed -> Atomic Commit!
    log(`[invar] All invariant gates passed! Applying atomic commit...`);
    diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
    const merge = applyShadowDiffToActiveTree(baseDir, shadow.shadowDir, shadow.baseCommit);

    if (!merge.success) {
      destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
      return {
        txId,
        status: 'ROLLED_BACK',
        success: false,
        error: merge.error,
        preVaultRoot: preVault.rootHash,
      };
    }

    // Teardown shadow worktree
    destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);

    const result: TransactionResult = {
      txId,
      status: 'COMMITTED',
      success: true,
      preVaultRoot: preVault.rootHash,
      postVaultRoot: vaultCheck.postVault.rootHash,
      diff: merge.diff,
    };

    saveAuditLog(baseDir, result, options.intent);
    log(`[invar] Transaction ${txId} committed cleanly!`);
    return result;
  } catch (err: any) {
    if (shadow) {
      destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
    }
    return {
      txId,
      status: 'ROLLED_BACK',
      success: false,
      error: `Unexpected execution error: ${err.message}`,
      preVaultRoot: preVault.rootHash,
    };
  }
}
