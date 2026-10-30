import { minimatch } from 'minimatch';
import { runGit } from '../shadow/worktree.js';
import { DEFAULT_ARTIFACT_IGNORE } from '../config/defaults.js';

export interface EscapeCheckResult {
  escaped: boolean;
  unauthorizedModifications: string[];
}

export function captureActiveTreeStatus(baseDir: string): string[] {
  try {
    const raw = runGit(['status', '--porcelain', '-uall'], baseDir);
    return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function extractPathFromPorcelainLine(line: string): string {
  const rawPath = line.length > 3 ? line.slice(3).trim() : line.trim();
  const target = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()!.trim() : rawPath;
  const unquoted = target.replace(/^"(.*)"$/, '$1');
  return unquoted.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isArtifactIgnored(
  filePath: string,
  ignorePatterns: string[] = DEFAULT_ARTIFACT_IGNORE
): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('.invar/') || normalized.includes('/.invar/')) {
    return true;
  }

  for (const pattern of ignorePatterns) {
    if (!pattern) continue;
    if (minimatch(normalized, pattern, { dot: true })) {
      return true;
    }
    if (!pattern.startsWith('**/')) {
      if (minimatch(normalized, `**/${pattern}`, { dot: true })) {
        return true;
      }
    }
  }

  return false;
}

export function detectActiveTreeEscape(
  baseDir: string,
  initialStatus: string[],
  ignorePatterns: string[] = DEFAULT_ARTIFACT_IGNORE
): EscapeCheckResult {
  const currentStatus = captureActiveTreeStatus(baseDir);

  const initialSet = new Set(initialStatus);
  const unauthorized: string[] = [];

  for (const line of currentStatus) {
    if (initialSet.has(line)) {
      continue;
    }
    const filePath = extractPathFromPorcelainLine(line);
    if (isArtifactIgnored(filePath, ignorePatterns)) {
      continue;
    }
    unauthorized.push(line);
  }

  return {
    escaped: unauthorized.length > 0,
    unauthorizedModifications: unauthorized,
  };
}
