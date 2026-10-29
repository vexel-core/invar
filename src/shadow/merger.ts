import fs from 'node:fs';
import path from 'node:path';
import { runGit, runGitRaw } from './worktree.js';

export interface MergeResult {
  success: boolean;
  filesChanged: number;
  diff: string;
  error?: string;
}

export function extractShadowDiff(baseDir: string, shadowDir: string, baseCommit: string): string {
  try {
    runGit(['add', '-A'], shadowDir);
    const status = runGit(['status', '--porcelain'], shadowDir);
    if (status) {
      runGit(['commit', '-m', 'invar: shadow transaction candidate'], shadowDir);
    }
    return runGitRaw(['diff', baseCommit, 'HEAD'], shadowDir);
  } catch {
    try {
      return runGitRaw(['diff', baseCommit], shadowDir);
    } catch {
      return '';
    }
  }
}

export function applyShadowDiffToActiveTree(
  baseDir: string,
  shadowDir: string,
  baseCommit: string,
  existingDiff?: string
): MergeResult {
  const diff = existingDiff !== undefined ? existingDiff : extractShadowDiff(baseDir, shadowDir, baseCommit);
  if (!diff || !diff.trim()) {
    return {
      success: true,
      filesChanged: 0,
      diff: '',
    };
  }

  const invarDir = path.join(baseDir, '.invar');
  fs.mkdirSync(invarDir, { recursive: true });

  const patchFile = path.join(invarDir, `apply_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.patch`);
  try {
    const normalizedDiff = (diff.endsWith('\n') ? diff : `${diff}\n`).replace(/\r\n/g, '\n');
    fs.writeFileSync(patchFile, normalizedDiff, 'utf8');
    runGit(['apply', '--whitespace=nowarn', `"${patchFile}"`], baseDir);

    const matchFiles = diff.match(/^diff --git /gm);
    const changedFiles = matchFiles ? matchFiles.length : 1;
    return {
      success: true,
      filesChanged: changedFiles,
      diff: normalizedDiff,
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
