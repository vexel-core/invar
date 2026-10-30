import type {
  AssertionTransitionMatrix,
  SemanticAssertion,
  SemanticTestBlock,
  TransitionEntryType,
  TransitionMatrixEntry,
} from '../config/types.js';
import { getMatcherStrength } from './assertion-diff.js';

function formatAssertionText(assertion: SemanticAssertion): string {
  const arg = assertion.expectedExpr ? assertion.expectedExpr : '';
  return `expect(${assertion.targetExpr}).${assertion.matcher}(${arg})`;
}

function classifyTransitionType(pre: SemanticAssertion, post: SemanticAssertion): TransitionEntryType {
  const preStrength = getMatcherStrength(pre.matcher);
  const postStrength = getMatcherStrength(post.matcher);

  if (postStrength > preStrength) return 'UPGRADED';
  if (postStrength < preStrength) return 'DOWNGRADED';
  if (pre.expectedExpr !== post.expectedExpr) return 'VALUE_MODIFIED';
  if (pre.targetExpr !== post.targetExpr) return 'TARGET_MODIFIED';
  return 'VALUE_MODIFIED';
}

function processExistingBlockAssertions(
  filePath: string,
  preBlock: SemanticTestBlock,
  postBlock: SemanticTestBlock,
  entries: TransitionMatrixEntry[]
): void {
  const minLen = Math.min(preBlock.assertions.length, postBlock.assertions.length);
  for (let i = 0; i < minLen; i++) {
    const pre = preBlock.assertions[i];
    const post = postBlock.assertions[i];
    if (formatAssertionText(pre) !== formatAssertionText(post)) {
      entries.push({
        filePath,
        blockId: preBlock.id,
        preAssertion: formatAssertionText(pre),
        postAssertion: formatAssertionText(post),
        preStrength: getMatcherStrength(pre.matcher),
        postStrength: getMatcherStrength(post.matcher),
        type: classifyTransitionType(pre, post),
      });
    }
  }

  for (let i = minLen; i < preBlock.assertions.length; i++) {
    const pre = preBlock.assertions[i];
    entries.push({
      filePath,
      blockId: preBlock.id,
      preAssertion: formatAssertionText(pre),
      postAssertion: '',
      preStrength: getMatcherStrength(pre.matcher),
      postStrength: 0,
      type: 'DELETED',
    });
  }

  for (let i = minLen; i < postBlock.assertions.length; i++) {
    const post = postBlock.assertions[i];
    entries.push({
      filePath,
      blockId: postBlock.id,
      preAssertion: '',
      postAssertion: formatAssertionText(post),
      preStrength: 0,
      postStrength: getMatcherStrength(post.matcher),
      type: 'ADDED',
    });
  }
}

function processFileBlocks(
  filePath: string,
  preBlocks: SemanticTestBlock[],
  postBlocks: SemanticTestBlock[],
  entries: TransitionMatrixEntry[]
): void {
  const preMap = new Map<string, SemanticTestBlock>(preBlocks.map((b) => [b.id, b]));
  const postMap = new Map<string, SemanticTestBlock>(postBlocks.map((b) => [b.id, b]));

  for (const pre of preBlocks) {
    const post = postMap.get(pre.id);
    if (!post) {
      for (const a of pre.assertions) {
        entries.push({
          filePath,
          blockId: pre.id,
          preAssertion: formatAssertionText(a),
          postAssertion: '',
          preStrength: getMatcherStrength(a.matcher),
          postStrength: 0,
          type: 'DELETED',
        });
      }
    } else {
      processExistingBlockAssertions(filePath, pre, post, entries);
    }
  }

  for (const post of postBlocks) {
    if (!preMap.has(post.id)) {
      for (const a of post.assertions) {
        entries.push({
          filePath,
          blockId: post.id,
          preAssertion: '',
          postAssertion: formatAssertionText(a),
          preStrength: 0,
          postStrength: getMatcherStrength(a.matcher),
          type: 'ADDED',
        });
      }
    }
  }
}

export function buildAssertionTransitionMatrix(
  preSnapshots: Record<string, SemanticTestBlock[]> = {},
  postSnapshots: Record<string, SemanticTestBlock[]> = {}
): AssertionTransitionMatrix {
  const entries: TransitionMatrixEntry[] = [];
  const allFiles = Array.from(
    new Set([...Object.keys(preSnapshots), ...Object.keys(postSnapshots)])
  ).sort();

  for (const file of allFiles) {
    const preBlocks = preSnapshots[file] || [];
    const postBlocks = postSnapshots[file] || [];
    processFileBlocks(file, preBlocks, postBlocks, entries);
  }

  const breakingTypes: TransitionEntryType[] = [
    'DOWNGRADED',
    'DELETED',
    'VALUE_MODIFIED',
    'TARGET_MODIFIED',
  ];
  const hasBreakingChanges = entries.some((e) => breakingTypes.includes(e.type));
  const summary = `Assertion Transition Matrix: ${entries.length} assertion migrations detected (${entries.filter((e) => e.type === 'VALUE_MODIFIED').length} value changes, ${entries.filter((e) => e.type === 'DOWNGRADED').length} downgraded, ${entries.filter((e) => e.type === 'UPGRADED').length} upgraded).`;

  return {
    entries,
    hasBreakingChanges,
    summary,
  };
}
