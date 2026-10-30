import { describe, it, expect } from 'vitest';
import {
  MatcherLevel,
  getMatcherStrength,
  isTautologicalAssertion,
  compareIndividualAssertions,
  compareAssertionLists,
} from '../src/vault/assertion-diff.js';
import { parseTestFile, diffSemanticBlocks } from '../src/vault/semantic-parser.js';

describe('Assertion Differential & Anti-Weakening Engine', () => {
  describe('getMatcherStrength', () => {
    it('classifies exact, constraint, and existence matchers', () => {
      expect(getMatcherStrength('toBe')).toBe(MatcherLevel.EXACT);
      expect(getMatcherStrength('toEqual')).toBe(MatcherLevel.EXACT);
      expect(getMatcherStrength('assert.strictEqual')).toBe(MatcherLevel.EXACT);

      expect(getMatcherStrength('toContain')).toBe(MatcherLevel.CONSTRAINT);
      expect(getMatcherStrength('toBeGreaterThan')).toBe(MatcherLevel.CONSTRAINT);
      expect(getMatcherStrength('toHaveLength')).toBe(MatcherLevel.CONSTRAINT);
      expect(getMatcherStrength('not.toBe')).toBe(MatcherLevel.CONSTRAINT);

      expect(getMatcherStrength('toBeDefined')).toBe(MatcherLevel.EXISTENCE);
      expect(getMatcherStrength('toBeTruthy')).toBe(MatcherLevel.EXISTENCE);
      expect(getMatcherStrength('toBeNull')).toBe(MatcherLevel.EXISTENCE);
      expect(getMatcherStrength('not.toBeNull')).toBe(MatcherLevel.EXISTENCE);
      expect(getMatcherStrength('assert')).toBe(MatcherLevel.EXISTENCE);
    });
  });

  describe('isTautologicalAssertion', () => {
    it('flags constant literal tautologies as placebo assertions', () => {
      expect(
        isTautologicalAssertion({
          matcher: 'toBe',
          line: 1,
          targetExpr: 'true',
          expectedExpr: 'true',
        })
      ).toBe(true);

      expect(
        isTautologicalAssertion({
          matcher: 'toBe',
          line: 2,
          targetExpr: '1',
          expectedExpr: '1',
        })
      ).toBe(true);

      expect(
        isTautologicalAssertion({
          matcher: 'toBeTruthy',
          line: 3,
          targetExpr: 'true',
        })
      ).toBe(true);

      expect(
        isTautologicalAssertion({
          matcher: 'assert',
          line: 4,
          targetExpr: 'true',
        })
      ).toBe(true);
    });

    it('does not flag legitimate dynamic assertions', () => {
      expect(
        isTautologicalAssertion({
          matcher: 'toBe',
          line: 1,
          targetExpr: 'status',
          expectedExpr: '200',
        })
      ).toBe(false);

      expect(
        isTautologicalAssertion({
          matcher: 'toBeTruthy',
          line: 2,
          targetExpr: 'user.isAdmin',
        })
      ).toBe(false);
    });
  });

  describe('compareIndividualAssertions', () => {
    it('detects when an assertion is weakened from Exact to Existence', () => {
      const pre = { matcher: 'toBe', line: 10, targetExpr: 'res.code', expectedExpr: '200' };
      const post = { matcher: 'toBeDefined', line: 10, targetExpr: 'res.code' };

      const verdict = compareIndividualAssertions(pre, post, 'API > returns 200');
      expect(verdict.status).toBe('WEAKENED');
      expect(verdict.preStrength).toBe(MatcherLevel.EXACT);
      expect(verdict.postStrength).toBe(MatcherLevel.EXISTENCE);
      expect(verdict.reason).toContain('[ASSERTION_WEAKENED]');
    });

    it('detects when an assertion is weakened from Constraint to Existence', () => {
      const pre = { matcher: 'toHaveLength', line: 10, targetExpr: 'items', expectedExpr: '5' };
      const post = { matcher: 'toBeTruthy', line: 10, targetExpr: 'items' };

      const verdict = compareIndividualAssertions(pre, post, 'Items > list');
      expect(verdict.status).toBe('WEAKENED');
      expect(verdict.reason).toContain('[ASSERTION_WEAKENED]');
    });

    it('approves strengthening an assertion from Existence to Exact', () => {
      const pre = { matcher: 'toBeDefined', line: 10, targetExpr: 'res.token' };
      const post = { matcher: 'toBe', line: 10, targetExpr: 'res.token', expectedExpr: '"jwt-xyz"' };

      const verdict = compareIndividualAssertions(pre, post, 'Auth > token');
      expect(verdict.status).toBe('STRENGTHENED');
      expect(verdict.preStrength).toBe(MatcherLevel.EXISTENCE);
      expect(verdict.postStrength).toBe(MatcherLevel.EXACT);
    });

    it('flags altered target or expected expressions as tampering', () => {
      const pre = { matcher: 'toBe', line: 10, targetExpr: 'x', expectedExpr: '1' };
      const post1 = { matcher: 'toBe', line: 10, targetExpr: 'y', expectedExpr: '1' };
      const post2 = { matcher: 'toBe', line: 10, targetExpr: 'x', expectedExpr: '2' };

      expect(compareIndividualAssertions(pre, post1, 'Test').status).toBe('TAMPERED');
      expect(compareIndividualAssertions(pre, post2, 'Test').status).toBe('TAMPERED');
    });
  });

  describe('compareAssertionLists and diffSemanticBlocks Integration', () => {
    it('catches assertion weakening inside existing test blocks', () => {
      const preCode = `
        describe('Orders', () => {
          it('verifies order status', () => {
            expect(order.status).toBe('PAID');
          });
        });
      `;
      const postCode = `
        describe('Orders', () => {
          it('verifies order status', () => {
            // Weakened from toBe('PAID') to toBeDefined()
            expect(order.status).toBeDefined();
          });
        });
      `;

      const pre = parseTestFile(preCode).blocks;
      const post = parseTestFile(postCode).blocks;
      const diff = diffSemanticBlocks(pre, post, 'orders.test.ts');

      expect(diff.isValidAdditive).toBe(false);
      expect(diff.violations.length).toBe(1);
      expect(diff.violations[0]).toContain('[ASSERTION_WEAKENED]');
    });

    it('catches tautological placeholder tests in newly added blocks', () => {
      const preCode = `
        describe('Calc', () => {
          it('adds', () => {
            expect(add(1, 1)).toBe(2);
          });
        });
      `;
      const postCode = `
        describe('Calc', () => {
          it('adds', () => {
            expect(add(1, 1)).toBe(2);
          });
          it('placeholder test', () => {
            expect(true).toBe(true);
          });
        });
      `;

      const pre = parseTestFile(preCode).blocks;
      const post = parseTestFile(postCode).blocks;
      const diff = diffSemanticBlocks(pre, post, 'calc.test.ts');

      expect(diff.isValidAdditive).toBe(false);
      expect(diff.violations[0]).toContain('[TAUTOLOGICAL_ASSERTION]');
    });

    it('approves legitimate strengthening and additional assertions', () => {
      const preCode = `
        describe('Profile', () => {
          it('loads user profile', () => {
            expect(user.id).toBeDefined();
          });
        });
      `;
      const postCode = `
        describe('Profile', () => {
          it('loads user profile', () => {
            expect(user.id).toBe('u123');
            expect(user.email).toBe('test@example.com');
          });
        });
      `;

      const pre = parseTestFile(preCode).blocks;
      const post = parseTestFile(postCode).blocks;
      const diff = diffSemanticBlocks(pre, post, 'profile.test.ts');

      expect(diff.isValidAdditive).toBe(true);
      expect(diff.violations.length).toBe(0);
      expect(diff.preservedBlocks.length).toBe(1);
    });
  });
});
