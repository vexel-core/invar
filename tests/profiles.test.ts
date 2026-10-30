import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProfile, DEFAULT_PROFILES } from '../src/config/defaults.js';
import { buildAssertionTransitionMatrix } from '../src/vault/transition-matrix.js';
import { parseTestFile } from '../src/vault/semantic-parser.js';
import { executeTransaction } from '../src/tx/coordinator.js';
import { runGit } from '../src/shadow/worktree.js';
import type { InvarConfig } from '../src/config/types.js';

describe('Task-Aware Invariant Profiles & Contract Evolution Matrix', () => {
  describe('Profile Resolution', () => {
    const baseConfig: InvarConfig = {
      project: { name: 'test-app' },
      vault: { mode: 'strict', locked_paths: ['tests/**'] },
      shadow: { quarantine_on_failure: true, max_retries: 0, windows_junctions: false },
      invariants: {},
    };

    it('resolves default bugfix profile when unspecified', () => {
      const profile = resolveProfile(baseConfig);
      expect(profile.name).toBe('bugfix');
      expect(profile.vault_mode).toBe('strict');
      expect(profile.allow_test_additions).toBe(false);
      expect(profile.enforce_mutation_proof).toBe(false);
    });

    it('resolves feature profile with semantic mode and mutation proving', () => {
      const profile = resolveProfile(baseConfig, 'feature');
      expect(profile.name).toBe('feature');
      expect(profile.vault_mode).toBe('semantic');
      expect(profile.allow_test_additions).toBe(true);
      expect(profile.enforce_mutation_proof).toBe(true);
    });

    it('resolves refactor profile with frozen public exports', () => {
      const profile = resolveProfile(baseConfig, 'refactor');
      expect(profile.name).toBe('refactor');
      expect(profile.vault_mode).toBe('strict');
      expect(profile.freeze_public_exports).toBe(true);
    });

    it('resolves contract-migration profile with assertion reviews', () => {
      const profile = resolveProfile(baseConfig, 'contract-migration');
      expect(profile.name).toBe('contract-migration');
      expect(profile.vault_mode).toBe('semantic');
      expect(profile.allow_test_modifications).toBe(true);
      expect(profile.require_assertion_diff_review).toBe(true);
    });
  });

  describe('Assertion Transition Matrix Generator', () => {
    it('accurately identifies value modifications, upgrades, and deletions', () => {
      const preCode = `
        describe('Contract', () => {
          it('checks user role', () => {
            expect(user.role).toBe('member');
            expect(user.token).toBeDefined();
            expect(user.legacyFlag).toBe(true);
          });
        });
      `;
      const postCode = `
        describe('Contract', () => {
          it('checks user role', () => {
            expect(user.role).toBe('admin'); // VALUE_MODIFIED
            expect(user.token).toBe('jwt-123'); // UPGRADED (L1 -> L3)
          });
        });
      `;

      const pre = { 'tests/user.test.ts': parseTestFile(preCode).blocks };
      const post = { 'tests/user.test.ts': parseTestFile(postCode).blocks };
      const matrix = buildAssertionTransitionMatrix(pre, post);

      expect(matrix.hasBreakingChanges).toBe(true);
      expect(matrix.entries.length).toBe(3);

      const valMod = matrix.entries.find((e) => e.type === 'VALUE_MODIFIED');
      expect(valMod).toBeDefined();
      expect(valMod?.preAssertion).toContain("'member'");
      expect(valMod?.postAssertion).toContain("'admin'");

      const upgraded = matrix.entries.find((e) => e.type === 'UPGRADED');
      expect(upgraded).toBeDefined();

      const deleted = matrix.entries.find((e) => e.type === 'DELETED');
      expect(deleted).toBeDefined();
      expect(deleted?.preAssertion).toContain('legacyFlag');
    });
  });

  describe('Transactional Profile Gauntlet Integration', () => {
    let repoDir: string;
    let config: InvarConfig;

    beforeEach(() => {
      repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_prof_test_'));
      runGit(['init', '-b', 'main'], repoDir);
      runGit(['config', 'user.name', 'Invar Test'], repoDir);
      runGit(['config', 'user.email', 'test@invar.dev'], repoDir);

      fs.writeFileSync(path.join(repoDir, '.gitignore'), '.invar/\nnode_modules/\n', 'utf8');
      fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true });

      fs.writeFileSync(
        path.join(repoDir, 'src', 'api.ts'),
        'export function getStatus(): string {\n  return "OK";\n}\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(repoDir, 'tests', 'api.test.ts'),
        'describe("API", () => {\n  it("checks status", () => {\n    expect(getStatus()).toBe("OK");\n  });\n});\n',
        'utf8'
      );

      runGit(['add', '-A'], repoDir);
      runGit(['commit', '-m', '"initial"'], repoDir);

      config = {
        project: { name: 'prof-test' },
        vault: { mode: 'strict', locked_paths: ['tests/**'] },
        shadow: { quarantine_on_failure: true, max_retries: 0, windows_junctions: false },
        invariants: { max_cyclomatic_complexity: 15, max_function_lines: 60 },
      };
    });

    afterEach(() => {
      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('rejects same-file test additions under bugfix profile', async () => {
      const result = await executeTransaction(
        repoDir,
        config,
        (shadowDir) => {
          const testPath = path.join(shadowDir, 'tests', 'api.test.ts');
          const content = fs.readFileSync(testPath, 'utf8');
          fs.writeFileSync(
            testPath,
            content + '\ndescribe("Extra", () => { it("fails bugfix", () => { expect(1).toBe(1); }); });\n',
            'utf8'
          );
        },
        { profile: 'bugfix' }
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('QUARANTINED');
      expect(result.error).toContain('Anti-Cheat Violation');
    });

    it('approves same-file test additions under feature profile', async () => {
      const result = await executeTransaction(
        repoDir,
        config,
        (shadowDir) => {
          const testPath = path.join(shadowDir, 'tests', 'api.test.ts');
          const content = fs.readFileSync(testPath, 'utf8');
          fs.writeFileSync(
            testPath,
            content + '\ndescribe("Health", () => { it("checks ping", () => { expect(getStatus()).toBe("OK"); }); });\n',
            'utf8'
          );
        },
        { profile: 'feature' }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMMITTED');
      expect(result.activeProfile).toBe('feature');
    });

    it('allows assertion evolution and produces transition matrix under contract-migration profile', async () => {
      const result = await executeTransaction(
        repoDir,
        config,
        (shadowDir) => {
          const testPath = path.join(shadowDir, 'tests', 'api.test.ts');
          // Update expectation to "HEALTHY"
          fs.writeFileSync(
            testPath,
            'describe("API", () => {\n  it("checks status", () => {\n    expect(getStatus()).toBe("HEALTHY");\n  });\n});\n',
            'utf8'
          );
        },
        { profile: 'contract-migration' }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMMITTED');
      expect(result.transitionMatrix).toBeDefined();
      expect(result.transitionMatrix?.hasBreakingChanges).toBe(true);
      expect(result.transitionMatrix?.entries.length).toBeGreaterThan(0);
    });
  });
});
