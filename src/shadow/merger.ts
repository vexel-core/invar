import fs from 'node:fs';
import path from 'node:path';
import { runGit } from './worktree.js';

export interface MergeResult {
  success: boolean;
  filesChanged: number;
  diff: string;
  error?: string;
}

export function extractShadowDiff(baseDir: string, shadowDir: string, baseCommit: string): string {
  // Commit changes inside the shadow worktree to capture the exact delta
  try {
    runGit(['add', '-A'], shadowDir);
    const status = runGit(['status', '--porcelain'], shadowDir);
    if (!status) {
      return ''; // No changes
    }

    runGit(['commit', '-m', 'invar: shadow transaction candidate'], shadowDir);
    return runGit(['diff', baseCommit, 'HEAD'], shadowDir);
  } catch (err: any) {
    return runGit(['diff', baseCommit], shadowDir);
  }
}

export function applyShadowDiffToActiveTree(
  baseDir: string,
  shadowDir: string,
  baseCommit: string
): MergeResult {
  const diff = extractShadowDiff(baseDir, shadowDir, baseCommit);
  if (!diff) {
    return {
      success: true,
      filesChanged: 0,
      diff: '',
    };
  }

  // Create temporary patch file
  const patchFile = path.join(baseDir, '.invar', `apply_${Date.now()}.patch`);
  try {
    fs.writeFileSync(patchFile, diff, 'utf8');

    // Apply patch directly to active working tree
    runGit(['apply', '--whitespace=nowarn', `"${patchFile}"`], baseDir);

    const changedFiles = diff.split('\ndiff --git').length - 1;
    return {
      success: true,
      filesChanged: changedFiles || 1,
      diff,
    };
  } catch (err: any) {
    return {
      success: false,
      filesChanged: 0,
      diff,
      error: `Failed to apply transaction diff: ${err.message}`,
    };
  } finally {
    if (fs.existsSync(patchFile)) {
      try {
        fs.unlinkSync(patchFile);
      } catch {}
    }
  }
}
