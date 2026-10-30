import ts from 'typescript';
import type {
  SemanticAssertion,
  SemanticDiffResult,
  SemanticFileAnalysis,
  SemanticTestBlock,
} from '../config/types.js';
import { compareAssertionLists, isTautologicalAssertion } from './assertion-diff.js';

interface CallClassification {
  type: 'suite' | 'test' | 'unknown';
  kind: 'describe' | 'suite' | 'it' | 'test' | '';
}

function classifyCall(expr: ts.LeftHandSideExpression): CallClassification {
  let baseName = '';
  if (ts.isIdentifier(expr)) {
    baseName = expr.text;
  } else if (ts.isPropertyAccessExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      baseName = expr.expression.text;
    }
  }

  if (baseName === 'describe' || baseName === 'suite') {
    return { type: 'suite', kind: baseName };
  }
  if (baseName === 'it' || baseName === 'test') {
    return { type: 'test', kind: baseName };
  }
  return { type: 'unknown', kind: '' };
}

function extractStringArg(arg?: ts.Expression): string {
  if (!arg) return 'anonymous';
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  return arg.getText();
}

function extractExpectAssertion(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): SemanticAssertion | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;

  const propAccess = node.expression;
  const matcherParts: string[] = [propAccess.name.text];
  let current: ts.Expression = propAccess.expression;

  while (ts.isPropertyAccessExpression(current)) {
    matcherParts.unshift(current.name.text);
    current = current.expression;
  }

  if (ts.isCallExpression(current)) {
    const inner = current;
    if (ts.isIdentifier(inner.expression) && inner.expression.text === 'expect') {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      return {
        matcher: matcherParts.join('.'),
        line,
        targetExpr: inner.arguments[0]?.getText(sourceFile) || '',
        expectedExpr: node.arguments[0]?.getText(sourceFile),
      };
    }
  }
  return null;
}

function extractAssertAssertion(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): SemanticAssertion | null {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  if (ts.isIdentifier(node.expression) && node.expression.text === 'assert') {
    return {
      matcher: 'assert',
      line,
      targetExpr: node.arguments[0]?.getText(sourceFile) || '',
    };
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    const obj = node.expression.expression;
    if (ts.isIdentifier(obj) && obj.text === 'assert') {
      return {
        matcher: `assert.${node.expression.name.text}`,
        line,
        targetExpr: node.arguments[0]?.getText(sourceFile) || '',
        expectedExpr: node.arguments[1]?.getText(sourceFile),
      };
    }
  }
  return null;
}

function findAssertionsInNode(node: ts.Node, sourceFile: ts.SourceFile): SemanticAssertion[] {
  const assertions: SemanticAssertion[] = [];
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      const expAss = extractExpectAssertion(n, sourceFile);
      if (expAss) {
        assertions.push(expAss);
      } else {
        const asstAss = extractAssertAssertion(n, sourceFile);
        if (asstAss) assertions.push(asstAss);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return assertions;
}

function extractBlockBody(callNode: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const fnArg = callNode.arguments.find(
    (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
  );
  if (fnArg) {
    return fnArg.getText(sourceFile).replace(/\r\n/g, '\n').trim();
  }
  return '';
}

function createTestBlock(
  call: ts.CallExpression,
  hierarchy: string[],
  kind: 'it' | 'test',
  sourceFile: ts.SourceFile,
  idCounts: Map<string, number>
): SemanticTestBlock {
  const name = extractStringArg(call.arguments[0]);
  const baseId = hierarchy.length > 0 ? `${hierarchy.join(' > ')} > ${name}` : name;
  const count = (idCounts.get(baseId) || 0) + 1;
  idCounts.set(baseId, count);
  const id = count > 1 ? `${baseId} (#${count})` : baseId;

  const line = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line + 1;
  const assertions = findAssertionsInNode(call, sourceFile);
  const bodyText = extractBlockBody(call, sourceFile);

  return { id, name, kind, suiteHierarchy: [...hierarchy], line, assertions, bodyText };
}

export function parseTestFile(code: string, fileName = 'test.ts'): SemanticFileAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const blocks: SemanticTestBlock[] = [];
  const currentHierarchy: string[] = [];
  const idCounts = new Map<string, number>();

  function walk(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const cls = classifyCall(node.expression);
      if (cls.type === 'suite') {
        const suiteName = extractStringArg(node.arguments[0]);
        currentHierarchy.push(suiteName);
        ts.forEachChild(node, walk);
        currentHierarchy.pop();
        return;
      }
      if (cls.type === 'test') {
        const block = createTestBlock(node, currentHierarchy, cls.kind as 'it' | 'test', sourceFile, idCounts);
        blocks.push(block);
        return;
      }
    }
    ts.forEachChild(node, walk);
  }

  walk(sourceFile);
  return { filePath: fileName, blocks };
}

function evaluateBlockAssertions(
  preAssertions: SemanticAssertion[],
  postAssertions: SemanticAssertion[],
  blockId: string
): string[] {
  const diff = compareAssertionLists(preAssertions, postAssertions, blockId);
  return diff.violations;
}

export function diffSemanticBlocks(
  preBlocks: SemanticTestBlock[],
  postBlocks: SemanticTestBlock[],
  filePath: string
): SemanticDiffResult {
  const preMap = new Map<string, SemanticTestBlock>(preBlocks.map((b) => [b.id, b]));
  const postMap = new Map<string, SemanticTestBlock>(postBlocks.map((b) => [b.id, b]));

  const preservedBlocks: SemanticTestBlock[] = [];
  const addedBlocks: SemanticTestBlock[] = [];
  const removedBlocks: SemanticTestBlock[] = [];
  const modifiedBlocks: SemanticDiffResult['modifiedBlocks'] = [];
  const violations: string[] = [];

  for (const pre of preBlocks) {
    const post = postMap.get(pre.id);
    if (!post) {
      removedBlocks.push(pre);
      violations.push(`[DELETED_TEST] Existing test block removed or renamed: "${pre.id}"`);
    } else {
      const blockViolations = evaluateBlockAssertions(pre.assertions, post.assertions, pre.id);
      if (blockViolations.length > 0) {
        violations.push(...blockViolations);
        modifiedBlocks.push({ blockId: pre.id, pre, post, reason: blockViolations.join('; ') });
      } else {
        preservedBlocks.push(post);
      }
    }
  }

  for (const post of postBlocks) {
    if (!preMap.has(post.id)) {
      addedBlocks.push(post);
      for (const assertion of post.assertions) {
        if (isTautologicalAssertion(assertion)) {
          violations.push(
            `[TAUTOLOGICAL_ASSERTION] Block "${post.id}" contains tautological assertion: ${assertion.targetExpr}.${assertion.matcher}`
          );
        }
      }
    }
  }

  return {
    filePath,
    preservedBlocks,
    addedBlocks,
    removedBlocks,
    modifiedBlocks,
    isValidAdditive: violations.length === 0,
    violations,
  };
}
