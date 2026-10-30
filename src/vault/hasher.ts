import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { globSync } from 'glob';
import type { FileHashManifest, SemanticTestBlock, VaultState } from '../config/types.js';
import { parseTestFile } from './semantic-parser.js';

const JS_TS_REGEX = /\.[cm]?[jt]sx?$/i;

export function hashFileContent(content: string): string {
  // Normalize CRLF to LF to prevent false-positive Windows hash discrepancies
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return hashFileContent(content);
}

function extractSemanticSnapshots(
  baseDir: string,
  sortedPaths: string[]
): Record<string, SemanticTestBlock[]> {
  const snapshots: Record<string, SemanticTestBlock[]> = {};
  for (const relPath of sortedPaths) {
    if (JS_TS_REGEX.test(relPath)) {
      try {
        const fullPath = path.join(baseDir, relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          snapshots[relPath] = parseTestFile(content, relPath).blocks;
        }
      } catch {
        // Fallback for unparseable files
      }
    }
  }
  return snapshots;
}

function resolveLockedPaths(baseDir: string, lockedPatterns: string[]): string[] {
  const matchedFiles = new Set<string>();
  for (const pattern of lockedPatterns) {
    const files = globSync(pattern, {
      cwd: baseDir,
      nodir: true,
      dot: false,
      ignore: ['node_modules/**', '.git/**', '.invar/**'],
    });
    for (const file of files) {
      matchedFiles.add(file.replace(/\\/g, '/'));
    }
  }
  return Array.from(matchedFiles).sort();
}

export function computeVaultState(baseDir: string, lockedPatterns: string[]): VaultState {
  const manifest: FileHashManifest = {};
  const sortedPaths = resolveLockedPaths(baseDir, lockedPatterns);

  for (const relPath of sortedPaths) {
    const fullPath = path.join(baseDir, relPath);
    manifest[relPath] = computeFileHash(fullPath);
  }

  const rootHasher = crypto.createHash('sha256');
  for (const relPath of sortedPaths) {
    const fileHash = manifest[relPath];
    rootHasher.update(`${relPath}\0${fileHash}\n`, 'utf8');
  }

  return {
    rootHash: rootHasher.digest('hex'),
    manifest,
    lockedAt: new Date().toISOString(),
    fileCount: sortedPaths.length,
    semanticSnapshots: extractSemanticSnapshots(baseDir, sortedPaths),
  };
}
