import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  findMicroMutants,
  applyMutant,
  extractModifiedLinesFromDiff,
} from '../src/mutation/operators.js';
import { proveMutationsKilled } from '../src/mutation/prover.js';

describe('Targeted Micro-Mutation Prover (TIMM)', () => {
  describe('Operator Candidate Generation', () => {
    it('generates ROR, LCR, and RVM mutants on target code', () => {
      const code = `
        function checkAccess(user: any, age: number): boolean {
          if (age >= 18 && user.isActive) {
            return true;
          }
          return false;
        }
      `;

      const mutants = findMicroMutants('src/auth.ts', code);
      expect(mutants.length).toBeGreaterThanOrEqual(4);

      const rorMutant = mutants.find((m) => m.operator === 'ROR' && m.originalText === '>=');
      expect(rorMutant).toBeDefined();
      expect(rorMutant?.mutatedText).toBe('<');

      const lcrMutant = mutants.find((m) => m.operator === 'LCR' && m.originalText === '&&');
      expect(lcrMutant).toBeDefined();
      expect(lcrMutant?.mutatedText).toBe('||');

      const rvmMutant = mutants.find((m) => m.operator === 'RVM' && m.originalText === 'true');
      expect(rvmMutant).toBeDefined();
      expect(rvmMutant?.mutatedText).toBe('false');
    });

    it('filters mutants strictly to modified line numbers', () => {
      const code = `
        const x = 10 > 5;
        const y = 20 < 30;
      `;
      // Line 3 only has 20 < 30
      const mutants = findMicroMutants('src/calc.ts', code, new Set([3]));
      expect(mutants.length).toBe(1);
      expect(mutants[0].originalText).toBe('<');
    });

    it('applies a mutant cleanly to source text', () => {
      const code = 'const valid = a === b;';
      const mutants = findMicroMutants('src/test.ts', code);
      expect(mutants.length).toBe(1);

      const mutated = applyMutant(code, mutants[0]);
      expect(mutated).toBe('const valid = a !== b;');
    });
  });

  describe('extractModifiedLinesFromDiff', () => {
    it('extracts added line numbers from unified diff format', () => {
      const diffText = `
diff --git a/src/service.ts b/src/service.ts
--- a/src/service.ts
+++ b/src/service.ts
@@ -10,3 +10,4 @@
 existing line
+addedLineOne
+addedLineTwo
 existing line
      `;

      const map = extractModifiedLinesFromDiff(diffText);
      expect(map.has('src/service.ts')).toBe(true);
      const lines = map.get('src/service.ts')!;
      expect(lines.has(11)).toBe(true);
      expect(lines.has(12)).toBe(true);
      expect(lines.has(10)).toBe(false);
    });
  });

  describe('Micro-Mutation Prover Execution', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_mutation_'));
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('detects a placebo test when a micro-mutant survives', () => {
      const sourceCode = [
        'function isEligible(age) {',
        '  return age >= 18;',
        '}',
        'module.exports = { isEligible };',
      ].join('\n');

      const testCode = `
const { isEligible } = require('./src/logic.js');
// Hollow placebo test: checks type instead of value
if (typeof isEligible(20) !== 'boolean') {
  process.exit(1);
}
      `;

      fs.writeFileSync(path.join(tempDir, 'src', 'logic.js'), sourceCode, 'utf8');
      fs.writeFileSync(path.join(tempDir, 'test.js'), testCode, 'utf8');

      const diffText = `
diff --git a/src/logic.js b/src/logic.js
--- a/src/logic.js
+++ b/src/logic.js
@@ -1,3 +1,3 @@
 function isEligible(age) {
-  return false;
+  return age >= 18;
 }
      `;

      const proof = proveMutationsKilled(tempDir, diffText, 'node test.js');
      expect(proof.totalMutants).toBeGreaterThan(0);
      expect(proof.survivedMutants).toBeGreaterThan(0);
      expect(proof.isLoadBearing).toBe(false);
      expect(proof.violations[0]).toContain('[PLACEBO_TEST_DETECTED]');
    });

    it('proves a test is load-bearing when it kills the micro-mutant', () => {
      const sourceCode = [
        'function calcTotal(subtotal) {',
        '  return subtotal > 100 ? subtotal - 10 : subtotal;',
        '}',
        'module.exports = { calcTotal };',
      ].join('\n');

      const testCode = `
const { calcTotal } = require('./src/discount.js');
if (calcTotal(150) !== 140) {
  process.exit(1);
}
if (calcTotal(50) !== 50) {
  process.exit(1);
}
      `;

      fs.writeFileSync(path.join(tempDir, 'src', 'discount.js'), sourceCode, 'utf8');
      fs.writeFileSync(path.join(tempDir, 'test.js'), testCode, 'utf8');

      const diffText = `
diff --git a/src/discount.js b/src/discount.js
--- a/src/discount.js
+++ b/src/discount.js
@@ -1,3 +1,3 @@
 function calcTotal(subtotal) {
-  return subtotal;
+  return subtotal > 100 ? subtotal - 10 : subtotal;
 }
      `;

      const proof = proveMutationsKilled(tempDir, diffText, 'node test.js');
      expect(proof.totalMutants).toBeGreaterThan(0);
      expect(proof.killedMutants).toBeGreaterThan(0);
      expect(proof.survivedMutants).toBe(0);
      expect(proof.isLoadBearing).toBe(true);
      expect(proof.violations.length).toBe(0);
    });
  });
});
