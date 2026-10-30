import fs from 'node:fs';
import path from 'node:path';
import type { VaultMode, VaultState } from '../config/types.js';
import { computeVaultState } from './hasher.js';
import { diffSemanticBlocks } from './semantic-parser.js';

export interface VaultVerificationResult {
  verified: boolean;
  tamperDetected: boolean;
  error?: string;
  violations: string[];
  postVault: VaultState;
}

function checkPreExistingPaths(
  preVault: VaultState,
  postVault: VaultState,
  mode: VaultMode,
  violations: string[]
): void {
  for (const relPath of Object.keys(preVault.manifest)) {
    const expectedHash = preVault.manifest[relPath];
    const actualHash = postVault.manifest[relPath];

    if (!actualHash) {
      violations.push(`[DELETED] Locked test file removed: ${relPath}`);
      continue;
    }
    if (actualHash === expectedHash) continue;

    if (mode === 'semantic') {
      const preBlocks = preVault.semanticSnapshots?.[relPath];
      const postBlocks = postVault.semanticSnapshots?.[relPath];
      if (preBlocks && postBlocks) {
        const diff = diffSemanticBlocks(preBlocks, postBlocks, relPath);
        if (!diff.isValidAdditive) {
          violations.push(...diff.violations);
        }
        continue;
      }
    }
    violations.push(`[MODIFIED] Test file content altered: ${relPath}`);
  }
}

function checkNewPaths(
  preVault: VaultState,
  postVault: VaultState,
  mode: VaultMode,
  violations: string[]
): void {
  for (const relPath of Object.keys(postVault.manifest)) {
    if (!preVault.manifest[relPath]) {
      if (mode === 'strict') {
        violations.push(`[ADDED] New test file added under strict mode: ${relPath}`);
      }
    }
  }
}

export function verifyVaultIntegrity(
  shadowDir: string,
  preVault: VaultState,
  lockedPatterns: string[],
  mode: VaultMode = 'strict'
): VaultVerificationResult {
  const postVault = computeVaultState(shadowDir, lockedPatterns);
  const violations: string[] = [];

  checkPreExistingPaths(preVault, postVault, mode, violations);
  checkNewPaths(preVault, postVault, mode, violations);

  if (violations.length > 0) {
    return {
      verified: false,
      tamperDetected: true,
      error: `Vault integrity breach: ${violations.length} violations detected in locked test suite.`,
      violations,
      postVault,
    };
  }

  return {
    verified: true,
    tamperDetected: false,
    violations: [],
    postVault,
  };
}

export function lockFilesReadOnly(baseDir: string, manifest: Record<string, string>): void {
  for (const relPath of Object.keys(manifest)) {
    const fullPath = path.join(baseDir, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.chmodSync(fullPath, 0o444);
      } catch {
        // Non-blocking on platforms where chmod fails
      }
    }
  }
}
