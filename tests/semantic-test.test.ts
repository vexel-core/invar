import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseTestFile, diffSemanticBlocks } from '../src/vault/semantic-parser.js';
import { computeVaultState } from '../src/vault/hasher.js';
import { verifyVaultIntegrity } from '../src/vault/locker.js';

describe('Semantic AST Test Block Fingerprinting & Verification', () => {
  describe('parseTestFile', () => {
    it('parses nested describe suites and test blocks', () => {
      const code = `
        describe('CheckoutService', () => {
          describe('Coupons', () => {
            it('applies 10% discount', () => {
              const total = applyDiscount(100, 10);
              expect(total).toBe(90);
            });
            test('rejects expired coupon', () => {
              expect(isValidCoupon('EXPIRED')).toBe(false);
            });
          });
        });
      `;
      const result = parseTestFile(code, 'checkout.test.ts');
      expect(result.blocks.length).toBe(2);

      const block1 = result.blocks[0];
      expect(block1.id).toBe('CheckoutService > Coupons > applies 10% discount');
      expect(block1.name).toBe('applies 10% discount');
      expect(block1.kind).toBe('it');
      expect(block1.suiteHierarchy).toEqual(['CheckoutService', 'Coupons']);
      expect(block1.assertions.length).toBe(1);
      expect(block1.assertions[0].matcher).toBe('toBe');
      expect(block1.assertions[0].targetExpr).toBe('total');
      expect(block1.assertions[0].expectedExpr).toBe('90');

      const block2 = result.blocks[1];
      expect(block2.id).toBe('CheckoutService > Coupons > rejects expired coupon');
      expect(block2.kind).toBe('test');
    });

    it('extracts complex matchers including negation and assert calls', () => {
      const code = `
        describe('Matchers', () => {
          it('handles negation and property chains', () => {
            expect(result).not.toBe(null);
            assert.strictEqual(status, 200);
          });
        });
      `;
      const result = parseTestFile(code);
      expect(result.blocks.length).toBe(1);
      const assertions = result.blocks[0].assertions;
      expect(assertions.length).toBe(2);
      expect(assertions[0].matcher).toBe('not.toBe');
      expect(assertions[1].matcher).toBe('assert.strictEqual');
    });
  });

  describe('diffSemanticBlocks', () => {
    it('approves legitimate additive tests in existing suites', () => {
      const preCode = `
        describe('Math', () => {
          it('adds numbers', () => {
            expect(add(1, 2)).toBe(3);
          });
        });
      `;
      const postCode = `
        describe('Math', () => {
          it('adds numbers', () => {
            expect(add(1, 2)).toBe(3);
          });
          it('subtracts numbers', () => {
            expect(subtract(5, 2)).toBe(3);
          });
        });
      `;
      const pre = parseTestFile(preCode).blocks;
      const post = parseTestFile(postCode).blocks;
      const diff = diffSemanticBlocks(pre, post, 'math.test.ts');

      expect(diff.isValidAdditive).toBe(true);
      expect(diff.violations.length).toBe(0);
      expect(diff.preservedBlocks.length).toBe(1);
      expect(diff.addedBlocks.length).toBe(1);
      expect(diff.addedBlocks[0].id).toBe('Math > subtracts numbers');
    });

    it('detects when an existing test block is deleted or renamed', () => {
      const preCode = `
        describe('Auth', () => {
          it('validates password length', () => {
            expect(checkLen('123')).toBe(false);
          });
        });
      `;
      const postCode = `
        describe('Auth', () => {
          it('different test name entirely', () => {
            expect(checkLen('123')).toBe(false);
          });
        });
      `;
      const pre = parseTestFile(preCode).blocks;
      const post = parseTestFile(postCode).blocks;
      const diff = diffSemanticBlocks(pre, post, 'auth.test.ts');

      expect(diff.isValidAdditive).toBe(false);
      expect(diff.removedBlocks.length).toBe(1);
      expect(diff.violations[0]).toContain('[DELETED_TEST]');
    });

    it('detects when assertions are deleted from an existing test block', () => {
      const preCode = `
        describe('User', () => {
          it('creates user with profile', () => {
            expect(user.id).toBeDefined();
            expect(user.email).toBe('test@example.com');
          });
        });
      `;
      const postCode = `
        describe('User', () => {
          it('creates user with profile', () => {
            expect(user.id).toBeDefined();
          });
        });
      `;
      const pre = parseTestFile(preCode).blocks;
      const post = parseTestFile(postCode).blocks;
      const diff = diffSemanticBlocks(pre, post, 'user.test.ts');

      expect(diff.isValidAdditive).toBe(false);
      expect(diff.violations[0]).toContain('[ASSERTION_DELETED]');
    });
  });

  describe('Integration with Vault Integrity', () => {
    let testDir: string;
    let shadowDir: string;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_sem_base_'));
      shadowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_sem_shadow_'));
      fs.mkdirSync(path.join(testDir, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(shadowDir, 'tests'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
      fs.rmSync(shadowDir, { recursive: true, force: true });
    });

    it('approves same-file test additions in semantic mode while strict mode rejects', () => {
      const initialTestContent = `
describe('Billing', () => {
  it('calculates tax', () => {
    expect(calcTax(100)).toBe(10);
  });
});
      `;
      const updatedTestContent = `
describe('Billing', () => {
  it('calculates tax', () => {
    expect(calcTax(100)).toBe(10);
  });
  it('calculates tax with zero rate', () => {
    expect(calcTax(100, 0)).toBe(0);
  });
});
      `;

      fs.writeFileSync(path.join(testDir, 'tests', 'billing.test.ts'), initialTestContent, 'utf8');
      fs.writeFileSync(path.join(shadowDir, 'tests', 'billing.test.ts'), updatedTestContent, 'utf8');

      const preVault = computeVaultState(testDir, ['tests/**']);

      // 1. Strict mode must reject byte changes
      const strictCheck = verifyVaultIntegrity(shadowDir, preVault, ['tests/**'], 'strict');
      expect(strictCheck.verified).toBe(false);
      expect(strictCheck.tamperDetected).toBe(true);
      expect(strictCheck.violations[0]).toContain('[MODIFIED]');

      // 2. Semantic mode must approve legitimate additive test block
      const semanticCheck = verifyVaultIntegrity(shadowDir, preVault, ['tests/**'], 'semantic');
      expect(semanticCheck.verified).toBe(true);
      expect(semanticCheck.tamperDetected).toBe(false);
      expect(semanticCheck.violations.length).toBe(0);
    });

    it('rejects test tampering even under semantic mode', () => {
      const initialTestContent = `
describe('Security', () => {
  it('blocks unauthorized access', () => {
    expect(authenticate('bad-token')).toBe(false);
  });
});
      `;
      const tamperedContent = `
describe('Security', () => {
  it('blocks unauthorized access', () => {
    // Maliciously altered matcher to bypass check
    expect(authenticate('bad-token')).toBe(true);
  });
});
      `;

      fs.writeFileSync(path.join(testDir, 'tests', 'sec.test.ts'), initialTestContent, 'utf8');
      fs.writeFileSync(path.join(shadowDir, 'tests', 'sec.test.ts'), tamperedContent, 'utf8');

      const preVault = computeVaultState(testDir, ['tests/**']);
      const semanticCheck = verifyVaultIntegrity(shadowDir, preVault, ['tests/**'], 'semantic');

      expect(semanticCheck.verified).toBe(false);
      expect(semanticCheck.tamperDetected).toBe(true);
      expect(semanticCheck.violations[0]).toContain('[ASSERTION_TAMPERED]');
    });
  });
});
