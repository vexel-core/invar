import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createDirectoryJunction, removeDirectoryJunction } from './junction.js';

export interface ShadowWorktreeInstance {
  txId: string;
  shadowDir: string;
  baseCommit: string;
  hasStashedState: boolean;
  linkedJunctions: string[];
}

export function runGit(args: string[], cwd: string): string {
  return runGitRaw(args, cwd).trim();
}

export function runGitRaw(args: string[], cwd: string): string {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err: any) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`Git error (${args.join(' ')}): ${stderr}`);
  }
}

function copyUntrackedFiles(baseDir: string, shadowDir: string): void {
  try {
    const untracked = runGit(['ls-files', '--others', '--exclude-standard'], baseDir);
    if (!untracked) return;

    const files = untracked.split(/\r?\n/).filter(Boolean);
    for (const relFile of files) {
      if (relFile.startsWith('.invar/') || relFile.startsWith('.invar\\')) {
        continue;
      }
      const srcPath = path.join(baseDir, relFile);
      const destPath = path.join(shadowDir, relFile);
      if (fs.existsSync(srcPath) && !fs.lstatSync(srcPath).isDirectory()) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  } catch {
    // Non-fatal
  }
}

function linkProjectDependencies(baseDir: string, shadowDir: string): string[] {
  const linkedJunctions: string[] = [];
  const itemsToLink = ['node_modules', '.env', '.env.local'];

  for (const item of itemsToLink) {
    const src = path.join(baseDir, item);
    const dest = path.join(shadowDir, item);
    if (!fs.existsSync(src)) continue;

    if (fs.lstatSync(src).isDirectory()) {
      if (createDirectoryJunction(src, dest)) {
        linkedJunctions.push(dest);
      }
    } else {
      try {
        fs.copyFileSync(src, dest);
      } catch {}
    }
  }
  return linkedJunctions;
}

export function createShadowWorktree(baseDir: string, txId: string): ShadowWorktreeInstance {
  const shadowParent = path.join(baseDir, '.invar', 'shadow');
  const shadowDir = path.join(shadowParent, txId);

  if (fs.existsSync(shadowDir)) {
    destroyShadowWorktree(baseDir, shadowDir, []);
  }
  fs.mkdirSync(shadowParent, { recursive: true });

  let baseCommit = 'HEAD';
  let hasStashedState = false;

  try {
    const stashSha = runGit(['stash', 'create'], baseDir);
    if (stashSha && stashSha.length >= 7) {
      baseCommit = stashSha;
      hasStashedState = true;
    }
  } catch {}

  runGit(['worktree', 'add', '--detach', `"${shadowDir}"`, baseCommit], baseDir);
  copyUntrackedFiles(baseDir, shadowDir);
  const linkedJunctions = linkProjectDependencies(baseDir, shadowDir);

  return {
    txId,
    shadowDir,
    baseCommit,
    hasStashedState,
    linkedJunctions,
  };
}

export function destroyShadowWorktree(
  baseDir: string,
  shadowDir: string,
  linkedJunctions: string[] = []
): void {
  for (const junction of linkedJunctions) {
    removeDirectoryJunction(junction);
  }
  removeDirectoryJunction(path.join(shadowDir, 'node_modules'));

  const maxRetries = 3;
  const delays = [50, 150, 300];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (fs.existsSync(shadowDir)) {
        runGit(['worktree', 'remove', '--force', `"${shadowDir}"`], baseDir);
      }
      break;
    } catch {
      if (attempt === maxRetries) {
        try {
          fs.rmSync(shadowDir, { recursive: true, force: true });
        } catch {
          console.warn(`[invar-shadow] Warning: Could not completely remove ${shadowDir}`);
        }
      } else {
        const delay = delays[attempt] || 100;
        const start = Date.now();
        while (Date.now() - start < delay) {}
      }
    }
  }

  try {
    runGit(['worktree', 'prune'], baseDir);
  } catch {}
}
