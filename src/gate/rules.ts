import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import type { InvarConfig, BoundaryRule } from '../config/types.js';
import { parseFileAst, type ParsedFileAst } from './ast.js';

export interface InvariantEvaluationResult {
  passed: boolean;
  violations: string[];
}

/**
 * Checks if an imported module matches any of the forbidden boundary patterns.
 */
export function checkBoundaryRules(
  ast: ParsedFileAst,
  boundaries: BoundaryRule[],
  baseDir: string
): string[] {
  const violations: string[] = [];
  const absPath = path.isAbsolute(ast.filePath) ? ast.filePath : path.join(baseDir, ast.filePath);
  const relFilePath = path.relative(baseDir, absPath).replace(/\\/g, '/');

  for (const boundary of boundaries) {
    // Check if the current file matches the source pattern
    if (!minimatch(relFilePath, boundary.source)) {
      continue;
    }

    // Check each import against cannot_import patterns
    for (const imp of ast.imports) {
      // Resolve relative imports to absolute relative paths within the repo
      let resolvedImportPath = imp.sourceModule;
      if (imp.sourceModule.startsWith('.')) {
        const fileDir = path.dirname(relFilePath);
        resolvedImportPath = path.posix.normalize(path.posix.join(fileDir, imp.sourceModule));
      }

      for (const forbiddenPattern of boundary.cannot_import) {
        // Strip trailing wildcard variations for clean prefix matching
        const cleanPattern = forbiddenPattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
        const matchesGlob = minimatch(resolvedImportPath, forbiddenPattern);
        const startsWithPrefix =
          resolvedImportPath.startsWith(cleanPattern) ||
          resolvedImportPath.startsWith(`${cleanPattern}/`);

        if (matchesGlob || startsWithPrefix) {
          violations.push(
            `[BOUNDARY_VIOLATION] ${relFilePath}:${imp.line} imports disallowed module "${imp.sourceModule}" (violates rule: "${forbiddenPattern}")`
          );
        }
      }
    }
  }

  return violations;
}

/**
 * Checks for duplicate function or class definitions across modified files or within the same file.
 */
export function checkDuplicateSymbols(parsedAsts: ParsedFileAst[]): string[] {
  const violations: string[] = [];
  const symbolMap = new Map<string, string[]>();

  for (const ast of parsedAsts) {
    const cleanPath = ast.filePath.replace(/\\/g, '/');
    for (const sym of ast.symbols) {
      const loc = `${cleanPath}:${sym.line}`;
      const existing = symbolMap.get(sym.name) || [];
      existing.push(loc);
      symbolMap.set(sym.name, existing);
    }
  }

  for (const [name, locations] of symbolMap.entries()) {
    if (locations.length > 1) {
      violations.push(
        `[DUPLICATE_SYMBOL] Duplicate symbol "${name}" declared multiple times:\n   ${locations.join('\n   ')}`
      );
    }
  }

  return violations;
}

/**
 * Checks function cyclomatic complexity and line count against configured ceilings.
 */
export function checkComplexityCeilings(
  ast: ParsedFileAst,
  maxComplexity: number = 15,
  maxLines: number = 60
): string[] {
  const violations: string[] = [];
  const relPath = ast.filePath.replace(/\\/g, '/');

  for (const sym of ast.symbols) {
    if (sym.kind === 'function') {
      if (sym.cyclomaticComplexity > maxComplexity) {
        violations.push(
          `[COMPLEXITY_EXCEEDED] Function "${sym.name}" at ${relPath}:${sym.line} has cyclomatic complexity ${sym.cyclomaticComplexity} (limit: ${maxComplexity})`
        );
      }
      if (sym.linesCount > maxLines) {
        violations.push(
          `[LINE_COUNT_EXCEEDED] Function "${sym.name}" at ${relPath}:${sym.line} is ${sym.linesCount} lines long (limit: ${maxLines})`
        );
      }
    }
  }

  return violations;
}

/**
 * Evaluates all AST invariants on a set of files.
 */
export function evaluateAstInvariants(
  baseDir: string,
  filePaths: string[],
  config: InvarConfig
): InvariantEvaluationResult {
  const violations: string[] = [];
  const parsedAsts: ParsedFileAst[] = [];

  const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];

  for (const file of filePaths) {
    const ext = path.extname(file).toLowerCase();
    if (!supportedExtensions.includes(ext)) {
      continue;
    }

    try {
      if (!fs.existsSync(file)) {
        continue;
      }

      const ast = parseFileAst(file);
      parsedAsts.push(ast);

      // Check 1: Boundary rules
      if (config.invariants.boundaries && config.invariants.boundaries.length > 0) {
        const boundaryViolations = checkBoundaryRules(ast, config.invariants.boundaries, baseDir);
        violations.push(...boundaryViolations);
      }

      // Check 2: Complexity ceilings
      const maxComplexity = config.invariants.max_cyclomatic_complexity ?? 15;
      const maxLines = config.invariants.max_function_lines ?? 60;
      const complexityViolations = checkComplexityCeilings(ast, maxComplexity, maxLines);
      violations.push(...complexityViolations);
    } catch {
      // Non-fatal parse fallback
    }
  }

  // Check 3: Duplicate symbols if enabled
  if (config.invariants.ban_duplicate_symbols) {
    const duplicateViolations = checkDuplicateSymbols(parsedAsts);
    violations.push(...duplicateViolations);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
