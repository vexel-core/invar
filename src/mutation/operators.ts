import ts from 'typescript';
import type { MicroMutant, MutationOperatorKind } from '../config/types.js';

interface OperatorMutationDef {
  mutated: string;
  operator: MutationOperatorKind;
}

const BINARY_MUTATIONS: Partial<Record<ts.SyntaxKind, OperatorMutationDef>> = {
  [ts.SyntaxKind.GreaterThanToken]: { mutated: '<=', operator: 'ROR' },
  [ts.SyntaxKind.LessThanToken]: { mutated: '>=', operator: 'ROR' },
  [ts.SyntaxKind.GreaterThanEqualsToken]: { mutated: '<', operator: 'ROR' },
  [ts.SyntaxKind.LessThanEqualsToken]: { mutated: '>', operator: 'ROR' },
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: { mutated: '!==', operator: 'ROR' },
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: { mutated: '===', operator: 'ROR' },
  [ts.SyntaxKind.EqualsEqualsToken]: { mutated: '!=', operator: 'ROR' },
  [ts.SyntaxKind.ExclamationEqualsToken]: { mutated: '==', operator: 'ROR' },
  [ts.SyntaxKind.AmpersandAmpersandToken]: { mutated: '||', operator: 'LCR' },
  [ts.SyntaxKind.BarBarToken]: { mutated: '&&', operator: 'LCR' },
  [ts.SyntaxKind.PlusToken]: { mutated: '-', operator: 'AOR' },
  [ts.SyntaxKind.MinusToken]: { mutated: '+', operator: 'AOR' },
  [ts.SyntaxKind.AsteriskToken]: { mutated: '/', operator: 'AOR' },
  [ts.SyntaxKind.SlashToken]: { mutated: '*', operator: 'AOR' },
};

function getReturnMutation(expr: ts.Expression): OperatorMutationDef | null {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return { mutated: 'false', operator: 'RVM' };
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return { mutated: 'true', operator: 'RVM' };
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return { mutated: 'undefined', operator: 'RVM' };
  }
  if (ts.isIdentifier(expr) && expr.text === 'undefined') {
    return { mutated: 'null', operator: 'RVM' };
  }
  return { mutated: 'undefined', operator: 'RVM' };
}

function createBinaryMutant(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
  counter: { count: number }
): MicroMutant | null {
  const opToken = node.operatorToken;
  const def = BINARY_MUTATIONS[opToken.kind];
  if (!def) return null;

  const line = sourceFile.getLineAndCharacterOfPosition(opToken.getStart(sourceFile)).line + 1;
  const startPos = opToken.getStart(sourceFile);
  const endPos = opToken.getEnd();
  const originalText = opToken.getText(sourceFile);
  counter.count++;

  return {
    id: `mut_${def.operator.toLowerCase()}_${counter.count}`,
    filePath,
    line,
    operator: def.operator,
    originalText,
    mutatedText: def.mutated,
    startPos,
    endPos,
  };
}

function createReturnMutant(
  node: ts.ReturnStatement,
  sourceFile: ts.SourceFile,
  filePath: string,
  counter: { count: number }
): MicroMutant | null {
  if (!node.expression) return null;
  const def = getReturnMutation(node.expression);
  if (!def) return null;

  const line = sourceFile.getLineAndCharacterOfPosition(node.expression.getStart(sourceFile)).line + 1;
  const startPos = node.expression.getStart(sourceFile);
  const endPos = node.expression.getEnd();
  const originalText = node.expression.getText(sourceFile);
  counter.count++;

  return {
    id: `mut_rvm_${counter.count}`,
    filePath,
    line,
    operator: def.operator,
    originalText,
    mutatedText: def.mutated,
    startPos,
    endPos,
  };
}

export function findMicroMutants(
  filePath: string,
  code: string,
  targetLines?: Set<number>
): MicroMutant[] {
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
  const mutants: MicroMutant[] = [];
  const counter = { count: 0 };

  function visitMutationNode(node: ts.Node) {
    if (ts.isBinaryExpression(node)) {
      const mutant = createBinaryMutant(node, sourceFile, filePath, counter);
      if (mutant && (!targetLines || targetLines.has(mutant.line))) {
        mutants.push(mutant);
      }
    } else if (ts.isReturnStatement(node)) {
      const mutant = createReturnMutant(node, sourceFile, filePath, counter);
      if (mutant && (!targetLines || targetLines.has(mutant.line))) {
        mutants.push(mutant);
      }
    }
    ts.forEachChild(node, visitMutationNode);
  }

  visitMutationNode(sourceFile);
  return mutants;
}

export function applyMutant(code: string, mutant: MicroMutant): string {
  return code.slice(0, mutant.startPos) + mutant.mutatedText + code.slice(mutant.endPos);
}

export function extractModifiedLinesFromDiff(diffText: string): Map<string, Set<number>> {
  const fileLinesMap = new Map<string, Set<number>>();
  const lines = diffText.split(/\r?\n/);
  let currentFile: string | null = null;
  let currentNewLine = 0;

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      const rawPath = line.substring(6).trim();
      currentFile = rawPath.replace(/\\/g, '/');
      if (!fileLinesMap.has(currentFile)) {
        fileLinesMap.set(currentFile, new Set<number>());
      }
      continue;
    }
    if (line.startsWith('@@ ')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentNewLine = Number.parseInt(match[1], 10);
      }
      continue;
    }
    if (!currentFile || !fileLinesMap.has(currentFile)) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      fileLinesMap.get(currentFile)!.add(currentNewLine);
      currentNewLine++;
    } else if (line.startsWith(' ')) {
      currentNewLine++;
    }
  }

  return fileLinesMap;
}
