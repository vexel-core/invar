import fs from 'node:fs';
import path from 'node:path';
import { runGit } from '../shadow/worktree.js';
import { minimatch } from 'minimatch';

export type QuarantineStatus =
  | 'tampered'
  | 'test_failure'
  | 'ast_violation'
  | 'placebo_test'
  | 'user_aborted';

export interface QuarantineManifest {
  txId: string;
  status: QuarantineStatus;
  reason: string;
  timestamp: string;
}

export function parkQuarantine(
  baseDir: string,
  txId: string,
  diff: string,
  status: QuarantineStatus,
  reason: string
): string {
  const qDir = path.join(baseDir, '.invar', 'quarantine', txId);
  fs.mkdirSync(qDir, { recursive: true });

  const manifest: QuarantineManifest = {
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

export function listQuarantinedTransactions(baseDir: string): QuarantineManifest[] {
  const qDir = path.join(baseDir, '.invar', 'quarantine');
  if (!fs.existsSync(qDir)) return [];

  const manifests: QuarantineManifest[] = [];
  const entries = fs.readdirSync(qDir);

  for (const entry of entries) {
    const manifestPath = path.join(qDir, entry, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as QuarantineManifest;
        manifests.push(data);
      } catch {}
    }
  }

  return manifests.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getQuarantineManifest(baseDir: string, txId: string): QuarantineManifest | null {
  const manifestPath = path.join(baseDir, '.invar', 'quarantine', txId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as QuarantineManifest;
  } catch {
    return null;
  }
}

/**
 * Filters a multi-file unified git diff to exclude test files.
 */
export function filterDiffExcludingTests(
  diff: string,
  testPatterns: string[] = ['tests/**', 'test/**', '**/*.test.*', '**/*.spec.*']
): { filteredDiff: string; excludedFiles: string[]; includedFiles: string[] } {
  if (!diff) {
    return { filteredDiff: '', excludedFiles: [], includedFiles: [] };
  }

  const fileDiffs = diff.split(/(?=diff --git )/);
  const includedHunks: string[] = [];
  const excludedFiles: string[] = [];
  const includedFiles: string[] = [];

  for (const fileDiff of fileDiffs) {
    if (!fileDiff.trim()) continue;

    const match = fileDiff.match(/^diff --git a\/(.+?) b\/(.+?)(?:\r?\n|$)/);
    if (match) {
      const filePath = match[2];
      const isTestFile = testPatterns.some((pattern) => minimatch(filePath, pattern));

      if (isTestFile) {
        excludedFiles.push(filePath);
      } else {
        includedFiles.push(filePath);
        includedHunks.push(fileDiff);
      }
    } else {
      includedHunks.push(fileDiff);
    }
  }

  return {
    filteredDiff: includedHunks.join(''),
    excludedFiles,
    includedFiles,
  };
}

export interface ApplyQuarantineResult {
  success: boolean;
  appliedFiles: string[];
  excludedFiles: string[];
  error?: string;
}

export function applyQuarantinedDiff(
  baseDir: string,
  txId: string,
  options: { excludeTests?: boolean; testPatterns?: string[] } = {}
): ApplyQuarantineResult {
  const patchPath = path.join(baseDir, '.invar', 'quarantine', txId, 'candidate.patch');
  if (!fs.existsSync(patchPath)) {
    return { success: false, appliedFiles: [], excludedFiles: [], error: `No candidate patch found for ${txId}` };
  }

  const fullDiff = fs.readFileSync(patchPath, 'utf8');
  let patchToApply = fullDiff;
  let excludedFiles: string[] = [];
  let appliedFiles: string[] = [];

  if (options.excludeTests) {
    const filter = filterDiffExcludingTests(fullDiff, options.testPatterns);
    patchToApply = filter.filteredDiff;
    excludedFiles = filter.excludedFiles;
    appliedFiles = filter.includedFiles;
  }

  if (!patchToApply.trim()) {
    return { success: true, appliedFiles: [], excludedFiles, error: 'Patch contained only excluded files.' };
  }

  const tempPatchFile = path.join(baseDir, '.invar', `apply_salvage_${Date.now()}.patch`);
  try {
    fs.writeFileSync(tempPatchFile, patchToApply, 'utf8');
    runGit(['apply', '--whitespace=nowarn', `"${tempPatchFile}"`], baseDir);

    if (!options.excludeTests) {
      const matchFiles = patchToApply.match(/^diff --git a\/.+? b\/(.+?)$/gm);
      appliedFiles = matchFiles ? matchFiles.map((m) => m.replace(/^diff --git a\/.+? b\//, '')) : [];
    }

    return { success: true, appliedFiles, excludedFiles };
  } catch (err: any) {
    return { success: false, appliedFiles: [], excludedFiles, error: `Failed to apply salvaged patch: ${err.message}` };
  } finally {
    if (fs.existsSync(tempPatchFile)) {
      try {
        fs.unlinkSync(tempPatchFile);
      } catch {}
    }
  }
}
