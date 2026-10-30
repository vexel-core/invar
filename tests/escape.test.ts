import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extractPathFromPorcelainLine,
  isArtifactIgnored,
  detectActiveTreeEscape,
} from '../src/tx/escape.js';
import { runGit } from '../src/shadow/worktree.js';
import { DEFAULT_ARTIFACT_IGNORE } from '../src/config/defaults.js';
import { loadConfig } from '../src/config/loader.js';

describe('Monorepo & Artifact Path Classification (Phase 11)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_escape_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('extractPathFromPorcelainLine', () => {
    it('extracts unquoted untracked file paths', () => {
      expect(extractPathFromPorcelainLine('?? dist/index.js')).toBe('dist/index.js');
    });

    it('extracts modified file paths', () => {
      expect(extractPathFromPorcelainLine(' M packages/core/src/index.ts')).toBe('packages/core/src/index.ts');
    });

    it('extracts destination path from git rename lines', () => {
      expect(extractPathFromPorcelainLine('R  old/path.ts -> new/path.ts')).toBe('new/path.ts');
    });

    it('strips surrounding quotes from git escaped paths', () => {
      expect(extractPathFromPorcelainLine('?? "packages/web/dist/my file.js"')).toBe('packages/web/dist/my file.js');
    });

    it('normalizes Windows backslashes to forward slashes', () => {
      expect(extractPathFromPorcelainLine('?? dist\\bundle.js')).toBe('dist/bundle.js');
    });
  });

  describe('isArtifactIgnored', () => {
    it('always ignores .invar internal directories', () => {
      expect(isArtifactIgnored('.invar/quarantine/tx_01/candidate.patch')).toBe(true);
      expect(isArtifactIgnored('.invar/audit/tx_01.json')).toBe(true);
      expect(isArtifactIgnored('subpkg/.invar/cache')).toBe(true);
    });

    it('ignores default root compiler artifacts', () => {
      expect(isArtifactIgnored('dist/index.js')).toBe(true);
      expect(isArtifactIgnored('.next/cache/webpack.pack')).toBe(true);
      expect(isArtifactIgnored('coverage/lcov.info')).toBe(true);
      expect(isArtifactIgnored('build/main.js')).toBe(true);
      expect(isArtifactIgnored('.turbo/cache/manifest.json')).toBe(true);
    });

    it('ignores nested compiler artifacts in monorepo packages', () => {
      expect(isArtifactIgnored('packages/core/dist/bundle.js')).toBe(true);
      expect(isArtifactIgnored('apps/web/.next/static/chunks/main.js')).toBe(true);
      expect(isArtifactIgnored('packages/db/generated/client/index.d.ts')).toBe(true);
      expect(isArtifactIgnored('services/api/coverage/lcov-report/index.html')).toBe(true);
      expect(isArtifactIgnored('packages/ui/.turbo/turbo-build.log')).toBe(true);
    });

    it('does NOT ignore real source code files in root or monorepos', () => {
      expect(isArtifactIgnored('src/index.ts')).toBe(false);
      expect(isArtifactIgnored('packages/core/src/service.ts')).toBe(false);
      expect(isArtifactIgnored('apps/web/pages/api/login.ts')).toBe(false);
      expect(isArtifactIgnored('tests/escape.test.ts')).toBe(false);
      expect(isArtifactIgnored('prisma/schema.prisma')).toBe(false);
    });

    it('respects custom ignore patterns', () => {
      const customPatterns = ['custom_build/**', 'generated_models/**'];
      expect(isArtifactIgnored('custom_build/output.bin', customPatterns)).toBe(true);
      expect(isArtifactIgnored('apps/api/generated_models/user.ts', customPatterns)).toBe(true);
      expect(isArtifactIgnored('apps/api/src/user.ts', customPatterns)).toBe(false);
    });
  });

  describe('detectActiveTreeEscape in Git Repository', () => {
    it('does not trigger escape when only compiler artifacts are created in active tree', () => {
      runGit(['init'], tmpDir);
      runGit(['config', 'user.name', 'test'], tmpDir);
      runGit(['config', 'user.email', 'test@test.com'], tmpDir);

      // Create initial commit
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      runGit(['add', '.'], tmpDir);
      runGit(['commit', '-m', '"init"'], tmpDir);

      const initialStatus: string[] = [];

      // Simulate compiler or build creating artifacts in active tree
      fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'dist', 'index.js'), 'console.log("built");');
      fs.mkdirSync(path.join(tmpDir, 'packages', 'web', '.next'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'packages', 'web', '.next', 'build.json'), '{}');

      const result = detectActiveTreeEscape(tmpDir, initialStatus, DEFAULT_ARTIFACT_IGNORE);
      expect(result.escaped).toBe(false);
      expect(result.unauthorizedModifications).toHaveLength(0);
    });

    it('detects unauthorized modifications when real source code escapes sandbox', () => {
      runGit(['init'], tmpDir);
      runGit(['config', 'user.name', 'test'], tmpDir);
      runGit(['config', 'user.email', 'test@test.com'], tmpDir);

      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      runGit(['add', '.'], tmpDir);
      runGit(['commit', '-m', '"init"'], tmpDir);

      const initialStatus: string[] = [];

      // Simulate unauthorized escape writing directly to active repo
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'malicious.ts'), 'export const escape = true;');

      const result = detectActiveTreeEscape(tmpDir, initialStatus, DEFAULT_ARTIFACT_IGNORE);
      expect(result.escaped).toBe(true);
      expect(result.unauthorizedModifications.length).toBeGreaterThan(0);
      expect(result.unauthorizedModifications[0]).toContain('src/malicious.ts');
    });
  });

  describe('Config Loader & TOML merging with artifacts', () => {
    it('merges custom artifacts.ignore_escape from .invar.toml', () => {
      const customToml = `
[project]
name = "monorepo-app"

[artifacts]
ignore_escape = [
  "custom-dist/**",
  "packages/*/cache/**"
]
`;
      fs.writeFileSync(path.join(tmpDir, '.invar.toml'), customToml);
      const loaded = loadConfig(tmpDir);

      expect(loaded.artifacts?.ignore_escape).toEqual([
        'custom-dist/**',
        'packages/*/cache/**',
      ]);
    });
  });
});
