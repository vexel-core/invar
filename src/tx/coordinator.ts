import fs from 'node:fs';
import path from 'node:path';
import type {
  AssertionTransitionMatrix,
  InvarConfig,
  MutationProofResult,
  TaskProfileConfig,
  TaskProfileName,
  TransactionResult,
  VaultState,
} from '../config/types.js';
import { resolveProfile } from '../config/defaults.js';
import { computeVaultState } from '../vault/hasher.js';
import { verifyVaultIntegrity, type VaultVerificationResult } from '../vault/locker.js';
import { buildAssertionTransitionMatrix } from '../vault/transition-matrix.js';
import { proveMutationsKilled } from '../mutation/prover.js';
import {
  createShadowWorktree,
  destroyShadowWorktree,
  runGit,
  type ShadowWorktreeInstance,
} from '../shadow/worktree.js';
import { extractShadowDiff, applyShadowDiffToActiveTree } from '../shadow/merger.js';
import { runLockedSuite } from '../gate/runner.js';
import { extractSymbols } from '../gate/ast.js';
import { evaluateAstInvariants } from '../gate/rules.js';
import { captureActiveTreeStatus, detectActiveTreeEscape } from './escape.js';
import { saveAuditLog } from '../audit/logger.js';
import { parkQuarantine } from './quarantine.js';

export { parkQuarantine };
export * from './quarantine.js';

export interface CoordinatorOptions {
  intent?: string;
  profile?: TaskProfileName;
  onLog?: (message: string) => void;
}

export function getModifiedFiles(shadowDir: string, baseCommit: string): string[] {
  try {
    runGit(['add', '-A'], shadowDir);
    const output = runGit(['diff', '--name-only', baseCommit], shadowDir);
    if (!output || !output.trim()) return [];
    return output
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .map((f) => path.join(shadowDir, f));
  } catch {
    return [];
  }
}

function verifyFrozenExports(
  baseDir: string,
  shadowDir: string,
  modifiedFiles: string[]
): string[] {
  const violations: string[] = [];
  for (const shadowFilePath of modifiedFiles) {
    const ext = path.extname(shadowFilePath).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) continue;
    const relPath = path.relative(shadowDir, shadowFilePath).replace(/\\/g, '/');
    const baseFilePath = path.join(baseDir, relPath);
    if (!fs.existsSync(baseFilePath)) continue;

    const baseSymbols = extractSymbols(fs.readFileSync(baseFilePath, 'utf8'), ext);
    const shadowSymbols = extractSymbols(fs.readFileSync(shadowFilePath, 'utf8'), ext);
    const shadowSymNames = new Set(shadowSymbols.map((s) => s.name));

    for (const baseSym of baseSymbols) {
      if (!shadowSymNames.has(baseSym.name)) {
        violations.push(
          `[PUBLIC_EXPORT_ALTERED] Symbol "${baseSym.name}" was removed from ${relPath} under refactor profile.`
        );
      }
    }
  }
  return violations;
}

function evaluateVaultGauntlet(
  baseDir: string,
  shadow: ShadowWorktreeInstance,
  txId: string,
  preVault: VaultState,
  config: InvarConfig,
  profile: TaskProfileConfig,
  log: (msg: string) => void
): { passed: boolean; vaultCheck: VaultVerificationResult; transitionMatrix?: AssertionTransitionMatrix; quarantineResult?: TransactionResult } {
  log(`[invar] Verifying test vault integrity under "${profile.name}" profile (${profile.vault_mode} mode)...`);
  const vaultCheck = verifyVaultIntegrity(
    shadow.shadowDir,
    preVault,
    config.vault.locked_paths,
    profile.vault_mode
  );

  let transitionMatrix: AssertionTransitionMatrix | undefined;
  if (profile.require_assertion_diff_review) {
    transitionMatrix = buildAssertionTransitionMatrix(
      preVault.semanticSnapshots,
      vaultCheck.postVault.semanticSnapshots
    );
    log(`[invar] ${transitionMatrix.summary}`);
  }

  if (vaultCheck.tamperDetected && !profile.allow_test_modifications) {
    const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
    const qPath = parkQuarantine(
      baseDir,
      txId,
      diff,
      'tampered',
      vaultCheck.error || 'Test suite tampering detected'
    );
    destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
    return {
      passed: false,
      vaultCheck,
      quarantineResult: {
        txId,
        status: 'QUARANTINED',
        success: false,
        error: `Anti-Cheat Violation: ${vaultCheck.error}. Implementation diff quarantined at ${qPath}`,
        preVaultRoot: preVault.rootHash,
        postVaultRoot: vaultCheck.postVault.rootHash,
        quarantinePath: qPath,
        activeProfile: profile.name,
      },
    };
  }

  return { passed: true, vaultCheck, transitionMatrix };
}

function evaluateMutationGauntlet(
  baseDir: string,
  shadow: ShadowWorktreeInstance,
  txId: string,
  preVaultRoot: string,
  postVaultRoot: string,
  config: InvarConfig,
  profile: TaskProfileConfig,
  log: (msg: string) => void
): { passed: boolean; mutationProof?: MutationProofResult; quarantineResult?: TransactionResult } {
  if (!profile.enforce_mutation_proof || !config.project.test_runner) {
    return { passed: true };
  }

  log(`[invar] Enforcing targeted micro-mutation proof (anti-placebo)...`);
  const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
  const proof = proveMutationsKilled(shadow.shadowDir, diff, config.project.test_runner, { onLog: log });

  if (!proof.isLoadBearing && proof.survivedMutants > 0) {
    const qPath = parkQuarantine(
      baseDir,
      txId,
      diff,
      'placebo_test',
      `Placebo Test Breach: ${proof.violations.join('; ')}`
    );
    destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
    return {
      passed: false,
      mutationProof: proof,
      quarantineResult: {
        txId,
        status: 'QUARANTINED',
        success: false,
        error: `Placebo Test Breach: New tests failed to catch micro-mutations on modified code lines. Diff quarantined at ${qPath}`,
        preVaultRoot,
        postVaultRoot,
        quarantinePath: qPath,
        mutationProof: proof,
        activeProfile: profile.name,
      },
    };
  }

  return { passed: true, mutationProof: proof };
}

function evaluateAstAndExportsGauntlet(
  baseDir: string,
  shadow: ShadowWorktreeInstance,
  txId: string,
  preVaultRoot: string,
  postVaultRoot: string,
  config: InvarConfig,
  profile: TaskProfileConfig,
  log: (msg: string) => void
): { passed: boolean; violations: string[]; quarantineResult?: TransactionResult } {
  log(`[invar] Validating AST architectural invariants...`);
  const modifiedFiles = getModifiedFiles(shadow.shadowDir, shadow.baseCommit);
  const violations: string[] = [];

  if (profile.freeze_public_exports && modifiedFiles.length > 0) {
    const exportViolations = verifyFrozenExports(baseDir, shadow.shadowDir, modifiedFiles);
    violations.push(...exportViolations);
  }

  if (modifiedFiles.length > 0) {
    const astResult = evaluateAstInvariants(shadow.shadowDir, modifiedFiles, config);
    if (!astResult.passed) {
      violations.push(...astResult.violations);
    }
  }

  if (violations.length > 0) {
    const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
    const qPath = parkQuarantine(
      baseDir,
      txId,
      diff,
      'ast_violation',
      `Architectural invariant violations detected:\n${violations.join('\n')}`
    );
    destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
    return {
      passed: false,
      violations,
      quarantineResult: {
        txId,
        status: 'QUARANTINED',
        success: false,
        error: `Invariant Violation: Found ${violations.length} violations. Candidate diff quarantined at ${qPath}`,
        preVaultRoot,
        postVaultRoot,
        astViolations: violations,
        quarantinePath: qPath,
        activeProfile: profile.name,
      },
    };
  }

  log(`[invar] All AST architectural invariants satisfied.`);
  return { passed: true, violations: [] };
}

export async function executeTransaction(
  baseDir: string,
  config: InvarConfig,
  agentExecutor: (shadowDir: string) => Promise<void> | void,
  options: CoordinatorOptions = {}
): Promise<TransactionResult> {
  const txId = `tx_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const log = options.onLog || (() => {});
  const profile = resolveProfile(config, options.profile);

  log(`[invar] Initializing transaction ${txId} under profile "${profile.name}"...`);
  const initialActiveStatus = captureActiveTreeStatus(baseDir);

  let shadow: ShadowWorktreeInstance | null = null;
  try {
    shadow = createShadowWorktree(baseDir, txId);
  } catch (err: any) {
    return {
      txId,
      status: 'ROLLED_BACK',
      success: false,
      error: `Failed to create shadow worktree: ${err.message}`,
      preVaultRoot: '',
      activeProfile: profile.name,
    };
  }

  const preVault = computeVaultState(shadow.shadowDir, config.vault.locked_paths);
  try {
    log(`[invar] Executing agent task inside shadow worktree...`);
    await agentExecutor(shadow.shadowDir);

    const escapeCheck = detectActiveTreeEscape(baseDir, initialActiveStatus);
    if (escapeCheck.escaped) {
      const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
      const qPath = parkQuarantine(
        baseDir,
        txId,
        diff,
        'tampered',
        `Agent escaped shadow sandbox: ${escapeCheck.unauthorizedModifications.join(', ')}`
      );
      destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
      return {
        txId,
        status: 'QUARANTINED',
        success: false,
        error: `Hard Violation: Agent escaped shadow sandbox. Diff parked at ${qPath}`,
        preVaultRoot: preVault.rootHash,
        quarantinePath: qPath,
        activeProfile: profile.name,
      };
    }

    const vResult = evaluateVaultGauntlet(baseDir, shadow, txId, preVault, config, profile, log);
    if (!vResult.passed && vResult.quarantineResult) return vResult.quarantineResult;

    if (config.project.test_runner) {
      log(`[invar] Running locked test suite: "${config.project.test_runner}"...`);
      const testResult = runLockedSuite(shadow.shadowDir, config.project.test_runner);
      if (!testResult.passed) {
        const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
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
          postVaultRoot: vResult.vaultCheck.postVault.rootHash,
          testResult,
          quarantinePath: qPath,
          activeProfile: profile.name,
          transitionMatrix: vResult.transitionMatrix,
        };
      }
    }

    const mResult = evaluateMutationGauntlet(
      baseDir,
      shadow,
      txId,
      preVault.rootHash,
      vResult.vaultCheck.postVault.rootHash,
      config,
      profile,
      log
    );
    if (!mResult.passed && mResult.quarantineResult) return mResult.quarantineResult;

    const astResult = evaluateAstAndExportsGauntlet(
      baseDir,
      shadow,
      txId,
      preVault.rootHash,
      vResult.vaultCheck.postVault.rootHash,
      config,
      profile,
      log
    );
    if (!astResult.passed && astResult.quarantineResult) return astResult.quarantineResult;

    const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
    const merge = applyShadowDiffToActiveTree(baseDir, shadow.shadowDir, shadow.baseCommit, diff);
    destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);

    if (!merge.success) {
      return {
        txId,
        status: 'ROLLED_BACK',
        success: false,
        error: merge.error,
        preVaultRoot: preVault.rootHash,
        activeProfile: profile.name,
      };
    }

    const result: TransactionResult = {
      txId,
      status: 'COMMITTED',
      success: true,
      preVaultRoot: preVault.rootHash,
      postVaultRoot: vResult.vaultCheck.postVault.rootHash,
      diff: merge.diff,
      activeProfile: profile.name,
      mutationProof: mResult.mutationProof,
      transitionMatrix: vResult.transitionMatrix,
    };
    saveAuditLog(baseDir, result, options.intent);
    log(`[invar] Transaction ${txId} committed cleanly under profile "${profile.name}"!`);
    return result;
  } catch (err: any) {
    if (shadow) destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
    return {
      txId,
      status: 'ROLLED_BACK',
      success: false,
      error: `Unexpected execution error: ${err.message}`,
      preVaultRoot: preVault.rootHash,
      activeProfile: profile.name,
    };
  }
}
