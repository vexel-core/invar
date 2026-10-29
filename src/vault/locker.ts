import fs from 'node:fs';
import path from 'node:path';
import type { VaultMode, VaultState } from '../config/types.js';
import { computeVaultState } from './hasher.js';

export interface VaultVerificationResult {
  verified: boolean;
  tamperDetected: boolean;
  error?: string;
  violations: string[];
  postVault: VaultState;
}

export function verifyVaultIntegrity(
  shadowDir: string,
  preVault: VaultState,
  lockedPatterns: string[],
  mode: VaultMode = 'strict'
): VaultVerificationResult {
  const postVault = computeVaultState(shadowDir, lockedPatterns);
  const violations: string[] = [];

  const prePaths = Object.keys(preVault.manifest);
  const postPaths = Object.keys(postVault.manifest);

  // Check 1: Did any pre-existing test file get modified or deleted?
  for (const relPath of prePaths) {
    const expectedHash = preVault.manifest[relPath];
    const actualHash = postVault.manifest[relPath];

    if (!actualHash) {
      violations.push(`[DELETED] Locked test file removed: ${relPath}`);
    } else if (actualHash !== expectedHash) {
      violations.push(`[MODIFIED] Test file content altered: ${relPath}`);
    }
  }

  // Check 2: Were any new test files added?
  for (const relPath of postPaths) {
    if (!preVault.manifest[relPath]) {
      if (mode === 'strict') {
        violations.push(`[ADDED] New test file added under strict mode: ${relPath}`);
      }
    }
  }

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
