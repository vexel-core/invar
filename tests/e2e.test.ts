import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { executeTransaction } from '../src/tx/coordinator.js';
import { loadConfig } from '../src/config/loader.js';
import { applyQuarantinedDiff, listQuarantinedTransactions } from '../src/tx/quarantine.js';

describe('End-to-End Cheating Gauntlet & Invariant Protection (e2e)', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_e2e_test_'));

    // Initialize Git repo
    execSync('git init', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git config user.name "Vexel Bot"', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git config user.email "bot@vexel.dev"', { cwd: tmpRepo, stdio: 'ignore' });

    // Create source and test directories
    fs.mkdirSync(path.join(tmpRepo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpRepo, 'tests'), { recursive: true });

    // Initial files
    fs.writeFileSync(
      path.join(tmpRepo, 'src', 'calculator.ts'),
      'export function calculateTax(amount: number): number {\n  return amount * 0.20;\n}\n'
    );
    fs.writeFileSync(
      path.join(tmpRepo, 'tests', 'calculator.test.ts'),
      '// Locked Test Suite\nimport { calculateTax } from "../src/calculator.js";\n// assertion: expect(calculateTax(100)).toBe(20);\n'
    );
    fs.writeFileSync(
      path.join(tmpRepo, '.gitignore'),
      '.invar/\nnode_modules/\n'
    );
    fs.writeFileSync(
      path.join(tmpRepo, '.invar.toml'),
      '[project]\nname = "e2e-project"\n\n[vault]\nmode = "strict"\nlocked_paths = ["tests/**"]\n\n[shadow]\nquarantine_on_failure = true\n\n[invariants]\nmax_cyclomatic_complexity = 15\nmax_function_lines = 60\n'
    );

    execSync('git add .', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git commit -m "feat: initial commit with locked test suite"', { cwd: tmpRepo, stdio: 'ignore' });
  });

  afterEach(() => {
    try {
      execSync('git worktree prune', { cwd: tmpRepo, stdio: 'ignore' });
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    } catch {}
  });

  it(
    'detects Goodhart Law test weakening, executes instant rollback, and parks diff in quarantine',
    async () => {
      const config = loadConfig(tmpRepo);

    // Initial commit hash
    const initialGitStatus = execSync('git status --porcelain', { cwd: tmpRepo, encoding: 'utf8' }).trim();
    expect(initialGitStatus).toBe('');

    // Simulated rogue agent:
    // 1. Adds a legitimate discount feature to src/calculator.ts
    // 2. Modifies tests/calculator.test.ts to weaken or falsify the assertion
    const result = await executeTransaction(
      tmpRepo,
      config,
      async (shadowDir) => {
        // Step 1: Legitimate code
        const calcFile = path.join(shadowDir, 'src', 'calculator.ts');
        fs.appendFileSync(calcFile, '\nexport function calculateDiscount(price: number) { return price * 0.1; }\n');

        // Step 2: Goodhart's Law violation (cheating the test suite!)
        const testFile = path.join(shadowDir, 'tests', 'calculator.test.ts');
        fs.writeFileSync(
          testFile,
          '// CHEATED TEST: Weakened assertion\n// expect(calculateTax(100)).toBe(999);\n'
        );
      },
      { intent: 'Implement discount and cheat tests' }
    );

    // Invar must detect the breach!
    expect(result.success).toBe(false);
    expect(result.status).toBe('QUARANTINED');
    expect(result.error).toContain('Anti-Cheat Violation');
    expect(result.quarantinePath).toBeDefined();

    // Verify: Active Git working tree is 100% CLEAN (0 modified files, 0 residual files)
    const postStatus = execSync('git status --porcelain', { cwd: tmpRepo, encoding: 'utf8' }).trim();
    expect(postStatus).toBe('');

    // Verify: Active test file in main repo was NEVER modified
    const originalTestContent = fs.readFileSync(path.join(tmpRepo, 'tests', 'calculator.test.ts'), 'utf8');
    expect(originalTestContent).toContain('expect(calculateTax(100)).toBe(20)');
    expect(originalTestContent).not.toContain('CHEATED');

    // Verify: Candidate diff was safely parked in quarantine
    const quarantined = listQuarantinedTransactions(tmpRepo);
    expect(quarantined.length).toBeGreaterThan(0);
    expect(quarantined[0].status).toBe('tampered');

    // Verify Developer Salvage: Developer can apply the quarantined diff with --exclude-tests!
    const salvageResult = applyQuarantinedDiff(tmpRepo, quarantined[0].txId, { excludeTests: true });
    expect(salvageResult.success).toBe(true);
    expect(salvageResult.excludedFiles).toContain('tests/calculator.test.ts');

    // Now src/calculator.ts has the salvaged discount feature!
    const updatedCalc = fs.readFileSync(path.join(tmpRepo, 'src', 'calculator.ts'), 'utf8');
    expect(updatedCalc).toContain('calculateDiscount');

      // But tests/calculator.test.ts remains 100% UNTOUCHED!
      const testAfterSalvage = fs.readFileSync(path.join(tmpRepo, 'tests', 'calculator.test.ts'), 'utf8');
      expect(testAfterSalvage).not.toContain('CHEATED');
    },
    30000
  );

  it(
    'allows clean implementation transactions to commit cleanly',
    async () => {
      const config = loadConfig(tmpRepo);

      const result = await executeTransaction(
        tmpRepo,
        config,
        async (shadowDir) => {
          const newFile = path.join(shadowDir, 'src', 'utils.ts');
          fs.writeFileSync(newFile, 'export function formatCurrency(n: number) { return `$${n}`; }\n');
        },
        { intent: 'Add currency formatter' }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMMITTED');

      // Change must be merged into parent repo
      expect(fs.existsSync(path.join(tmpRepo, 'src', 'utils.ts'))).toBe(true);
    },
    30000
  );
});
