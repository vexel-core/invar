import fs from 'node:fs';
import path from 'node:path';

export interface ExtractedImport {
  raw: string;
  sourceModule: string;
  line: number;
}

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'const' | 'let' | 'var';
  line: number;
  linesCount: number;
  cyclomaticComplexity: number;
}

export interface ParsedFileAst {
  filePath: string;
  imports: ExtractedImport[];
  symbols: ExtractedSymbol[];
}

/**
 * Calculates cyclomatic complexity for a given code block.
 * Base complexity = 1.
 * Increments for each branching point: if, for, while, catch, case, ternary (?), logical operators (&&, ||, ??).
 */
export function calculateCyclomaticComplexity(functionBody: string): number {
  let complexity = 1;

  // Strip comments and string literals so literals never trigger false positive complexity
  const cleanBody = functionBody
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .replace(/'(?:\\.|[^'])*'/g, '')
    .replace(/"(?:\\.|[^"])*"/g, '')
    .replace(/`(?:\\.|[^`])*`/g, '');

  const patterns = [
    /\bif\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcatch\b/g,
    /\bcase\b/g,
    /\s+\?\s+/g, // ternary operator
    /&&/g,
    /\|\|/g,
    /\?\?/g,
  ];

  for (const pattern of patterns) {
    const matches = cleanBody.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

function extractPythonImports(sourceCode: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];
  const lines = sourceCode.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#')) continue;

    const pyImportMatch = line.match(/^import\s+([a-zA-Z0-9_\.]+)/);
    if (pyImportMatch) {
      imports.push({ raw: line, sourceModule: pyImportMatch[1], line: i + 1 });
      continue;
    }
    const pyFromMatch = line.match(/^from\s+([a-zA-Z0-9_\.]+)\s+import/);
    if (pyFromMatch) {
      imports.push({ raw: line, sourceModule: pyFromMatch[1], line: i + 1 });
    }
  }
  return imports;
}

function extractJsTsImports(sourceCode: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];
  const esmRegex = /(?:^|\n)\s*import\s*(?:(?:(?:[\w*\s{},]*)\s*from\s*)|(?:\(\s*))?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = esmRegex.exec(sourceCode)) !== null) {
    const index = match.index;
    const lineNum = sourceCode.substring(0, index + (match[0].startsWith('\n') ? 1 : 0)).split('\n').length;
    imports.push({ raw: match[0].trim(), sourceModule: match[1], line: lineNum });
  }

  const cjsRegex = /(?:^|\n)\s*(?:const|let|var)?\s*.*=\s*require\(['"]([^'"]+)['"]\)/g;
  while ((match = cjsRegex.exec(sourceCode)) !== null) {
    const index = match.index;
    const lineNum = sourceCode.substring(0, index + (match[0].startsWith('\n') ? 1 : 0)).split('\n').length;
    imports.push({ raw: match[0].trim(), sourceModule: match[1], line: lineNum });
  }
  return imports;
}

export function extractImports(sourceCode: string, ext: string): ExtractedImport[] {
  if (ext === '.py') {
    return extractPythonImports(sourceCode);
  }
  return extractJsTsImports(sourceCode);
}

function extractPythonSymbols(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const pyDefRegex = /^(\s*)def\s+([a-zA-Z0-9_]+)\s*\(/;
  const pyClassRegex = /^(\s*)class\s+([a-zA-Z0-9_]+)\s*[:\(]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const defMatch = line.match(pyDefRegex);
    if (defMatch) {
      const indent = defMatch[1].length;
      const name = defMatch[2];
      const bodyLines: string[] = [line];
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        const curIndent = lines[j].search(/\S/);
        if (curIndent <= indent) break;
        bodyLines.push(lines[j]);
      }
      symbols.push({
        name,
        kind: 'function',
        line: i + 1,
        linesCount: bodyLines.length,
        cyclomaticComplexity: calculateCyclomaticComplexity(bodyLines.join('\n')),
      });
    }

    const classMatch = line.match(pyClassRegex);
    if (classMatch) {
      symbols.push({ name: classMatch[2], kind: 'class', line: i + 1, linesCount: 1, cyclomaticComplexity: 1 });
    }
  }
  return symbols;
}

function extractJsTsSymbols(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const fnDeclRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/;
  const arrowFnRegex = /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/;
  const classDeclRegex = /(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(fnDeclRegex);
    if (fnMatch) {
      const { body, lineCount } = extractBracedBlock(lines, i);
      symbols.push({
        name: fnMatch[1],
        kind: 'function',
        line: i + 1,
        linesCount: lineCount,
        cyclomaticComplexity: calculateCyclomaticComplexity(body),
      });
      continue;
    }

    const arrowMatch = line.match(arrowFnRegex);
    if (arrowMatch) {
      const { body, lineCount } = extractBracedBlock(lines, i);
      symbols.push({
        name: arrowMatch[1],
        kind: 'function',
        line: i + 1,
        linesCount: lineCount,
        cyclomaticComplexity: calculateCyclomaticComplexity(body),
      });
      continue;
    }

    const classMatch = line.match(classDeclRegex);
    if (classMatch) {
      symbols.push({ name: classMatch[1], kind: 'class', line: i + 1, linesCount: 1, cyclomaticComplexity: 1 });
    }
  }
  return symbols;
}

export function extractSymbols(sourceCode: string, ext: string): ExtractedSymbol[] {
  const lines = sourceCode.split(/\r?\n/);
  if (ext === '.py') {
    return extractPythonSymbols(lines);
  }
  return extractJsTsSymbols(lines);
}

function extractBracedBlock(lines: string[], startLineIndex: number): { body: string; lineCount: number } {
  let openBraces = 0;
  let started = false;
  const bodyLines: string[] = [];

  for (let i = startLineIndex; i < lines.length; i++) {
    const line = lines[i];
    bodyLines.push(line);

    for (const char of line) {
      if (char === '{') {
        openBraces++;
        started = true;
      } else if (char === '}') {
        openBraces--;
      }
    }

    if (started && openBraces <= 0) break;
    if (bodyLines.length > 500) break;
  }

  return { body: bodyLines.join('\n'), lineCount: bodyLines.length };
}

export function parseFileAst(filePath: string, content?: string): ParsedFileAst {
  const code = content !== undefined ? content : fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();

  return {
    filePath,
    imports: extractImports(code, ext),
    symbols: extractSymbols(code, ext),
  };
}
