import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { globSync } from 'glob';
import type { FileHashManifest, VaultState } from '../config/types.js';

export function hashFileContent(content: string): string {
  // Normalize CRLF to LF to prevent false-positive Windows hash discrepancies
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return hashFileContent(content);
}

export function computeVaultState(baseDir: string, lockedPatterns: string[]): VaultState {
  const manifest: FileHashManifest = {};
  const matchedFiles = new Set<string>();

  for (const pattern of lockedPatterns) {
    const files = globSync(pattern, {
      cwd: baseDir,
      nodir: true,
      dot: false,
      ignore: ['node_modules/**', '.git/**', '.invar/**'],
    });

    for (const file of files) {
      // Normalize to forward slashes for cross-platform consistency
      const normalizedPath = file.replace(/\\/g, '/');
      matchedFiles.add(normalizedPath);
    }
  }

  // Sort paths lexicographically
  const sortedPaths = Array.from(matchedFiles).sort();

  for (const relPath of sortedPaths) {
    const fullPath = path.join(baseDir, relPath);
    manifest[relPath] = computeFileHash(fullPath);
  }

  // Compute aggregate Merkle root with null-byte and newline delimiters
  const rootHasher = crypto.createHash('sha256');
  for (const relPath of sortedPaths) {
    const fileHash = manifest[relPath];
    rootHasher.update(`${relPath}\0${fileHash}\n`, 'utf8');
  }

  const rootHash = rootHasher.digest('hex');

  return {
    rootHash,
    manifest,
    lockedAt: new Date().toISOString(),
    fileCount: sortedPaths.length,
  };
}
