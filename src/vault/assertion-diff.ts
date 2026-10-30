import type { SemanticAssertion } from '../config/types.js';

export enum MatcherLevel {
  TAUTOLOGY = 0,
  EXISTENCE = 1,
  CONSTRAINT = 2,
  EXACT = 3,
}

export interface AssertionDiffVerdict {
  status: 'IDENTICAL' | 'STRENGTHENED' | 'WEAKENED' | 'TAUTOLOGY' | 'TAMPERED';
  preStrength: MatcherLevel;
  postStrength: MatcherLevel;
  reason?: string;
}

export interface AssertionBlockDiff {
  blockId: string;
  isWeakened: boolean;
  isTampered: boolean;
  isTautological: boolean;
  verdicts: AssertionDiffVerdict[];
  violations: string[];
}

function isLiteralConstant(expr: string): boolean {
  const trimmed = expr.trim();
  if (['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'].includes(trimmed)) {
    return true;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return true;
  }
  if (/^(['"`])(?:(?!\1)[^\\]|\\.)*\1$/.test(trimmed)) {
    return true;
  }
  return false;
}

function isMatchingExistenceLiteral(target: string, matcher: string): boolean {
  const map: Record<string, string> = {
    true: 'toBeTruthy',
    false: 'toBeFalsy',
    null: 'toBeNull',
    undefined: 'toBeUndefined',
  };
  return map[target] === matcher;
}

function isEqualLiteralExpectation(target: string, expected?: string): boolean {
  if (!expected) return false;
  return isLiteralConstant(expected) && target === expected;
}

function isAssertTrue(target: string, matcher: string): boolean {
  return target === 'true' && (matcher === 'assert' || matcher === 'assert.ok');
}

export function isTautologicalAssertion(assertion: SemanticAssertion): boolean {
  const target = assertion.targetExpr.trim();
  if (!isLiteralConstant(target)) return false;

  if (isMatchingExistenceLiteral(target, assertion.matcher)) return true;
  if (isEqualLiteralExpectation(target, assertion.expectedExpr?.trim())) return true;
  return isAssertTrue(target, assertion.matcher);
}

export function getMatcherStrength(matcher: string): MatcherLevel {
  const normalized = matcher.replace(/^(resolves|rejects)\./, '');

  if (normalized.startsWith('not.')) {
    const base = normalized.substring(4);
    if (['toBeNull', 'toBeUndefined', 'toBeDefined'].includes(base)) {
      return MatcherLevel.EXISTENCE;
    }
    return MatcherLevel.CONSTRAINT;
  }

  const EXACT = new Set([
    'toBe', 'toEqual', 'toStrictEqual', 'toMatchObject', 'toBeCloseTo',
    'assert.strictEqual', 'assert.deepStrictEqual', 'assert.equal', 'assert.deepEqual',
  ]);
  if (EXACT.has(normalized)) return MatcherLevel.EXACT;

  const CONSTRAINT = new Set([
    'toBeGreaterThan', 'toBeLessThan', 'toBeGreaterThanOrEqual', 'toBeLessThanOrEqual',
    'toContain', 'toContainEqual', 'toMatch', 'toHaveLength', 'toHaveProperty',
    'toThrow', 'toThrowError', 'assert.match', 'assert.throws', 'assert.includes',
  ]);
  if (CONSTRAINT.has(normalized)) return MatcherLevel.CONSTRAINT;

  const EXISTENCE = new Set([
    'toBeDefined', 'toBeUndefined', 'toBeTruthy', 'toBeFalsy', 'toBeNull',
    'toBeNaN', 'assert.ok', 'assert',
  ]);
  if (EXISTENCE.has(normalized)) return MatcherLevel.EXISTENCE;

  return MatcherLevel.CONSTRAINT;
}

export function compareIndividualAssertions(
  pre: SemanticAssertion,
  post: SemanticAssertion,
  blockId: string
): AssertionDiffVerdict {
  if (isTautologicalAssertion(post)) {
    return {
      status: 'TAUTOLOGY',
      preStrength: getMatcherStrength(pre.matcher),
      postStrength: MatcherLevel.TAUTOLOGY,
      reason: `[TAUTOLOGICAL_ASSERTION] Block "${blockId}" introduced tautology: ${post.targetExpr}.${post.matcher}`,
    };
  }

  if (pre.targetExpr !== post.targetExpr) {
    return {
      status: 'TAMPERED',
      preStrength: getMatcherStrength(pre.matcher),
      postStrength: getMatcherStrength(post.matcher),
      reason: `[ASSERTION_TAMPERED] Block "${blockId}" target expression altered: "${pre.targetExpr}" -> "${post.targetExpr}"`,
    };
  }

  const preStrength = getMatcherStrength(pre.matcher);
  const postStrength = getMatcherStrength(post.matcher);

  if (postStrength < preStrength) {
    return {
      status: 'WEAKENED',
      preStrength,
      postStrength,
      reason: `[ASSERTION_WEAKENED] Block "${blockId}" downgraded matcher from "${pre.matcher}" (L${preStrength}) to "${post.matcher}" (L${postStrength})`,
    };
  }

  if (postStrength === preStrength && pre.expectedExpr !== post.expectedExpr) {
    return {
      status: 'TAMPERED',
      preStrength,
      postStrength,
      reason: `[ASSERTION_TAMPERED] Block "${blockId}" expected value altered: "${pre.expectedExpr}" -> "${post.expectedExpr}"`,
    };
  }

  return {
    status: postStrength > preStrength ? 'STRENGTHENED' : 'IDENTICAL',
    preStrength,
    postStrength,
  };
}

export function compareAssertionLists(
  pre: SemanticAssertion[],
  post: SemanticAssertion[],
  blockId: string
): AssertionBlockDiff {
  const verdicts: AssertionDiffVerdict[] = [];
  const violations: string[] = [];

  if (post.length < pre.length) {
    violations.push(
      `[ASSERTION_DELETED] Block "${blockId}" assertions reduced from ${pre.length} to ${post.length}`
    );
  }

  const pairsToCompare = Math.min(pre.length, post.length);
  for (let i = 0; i < pairsToCompare; i++) {
    const verdict = compareIndividualAssertions(pre[i], post[i], blockId);
    verdicts.push(verdict);
    if (verdict.reason) violations.push(verdict.reason);
  }

  for (let i = pairsToCompare; i < post.length; i++) {
    if (isTautologicalAssertion(post[i])) {
      violations.push(
        `[TAUTOLOGICAL_ASSERTION] Block "${blockId}" appended tautology: ${post[i].targetExpr}.${post[i].matcher}`
      );
    }
  }

  return {
    blockId,
    isWeakened: verdicts.some((v) => v.status === 'WEAKENED'),
    isTampered: verdicts.some((v) => v.status === 'TAMPERED'),
    isTautological: violations.some((v) => v.includes('[TAUTOLOGICAL_ASSERTION]')),
    verdicts,
    violations,
  };
}
