import { runGit } from '../shadow/worktree.js';

export interface EscapeCheckResult {
  escaped: boolean;
  unauthorizedModifications: string[];
}

export function captureActiveTreeStatus(baseDir: string): string[] {
  try {
    const raw = runGit(['status', '--porcelain'], baseDir);
    return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function detectActiveTreeEscape(
  baseDir: string,
  initialStatus: string[]
): EscapeCheckResult {
  const currentStatus = captureActiveTreeStatus(baseDir);

  const initialSet = new Set(initialStatus);
  const unauthorized: string[] = [];

  for (const line of currentStatus) {
    // Ignore .invar internal directories
    if (line.includes('.invar/')) {
      continue;
    }
    if (!initialSet.has(line)) {
      unauthorized.push(line);
    }
  }

  return {
    escaped: unauthorized.length > 0,
    unauthorizedModifications: unauthorized,
  };
}
