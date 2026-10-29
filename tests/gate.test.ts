import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extractImports,
  extractSymbols,
  calculateCyclomaticComplexity,
  parseFileAst,
} from '../src/gate/ast.js';
import {
  checkBoundaryRules,
  checkDuplicateSymbols,
  checkComplexityCeilings,
  evaluateAstInvariants,
} from '../src/gate/rules.js';
import type { InvarConfig } from '../src/config/types.js';

describe('invar-gate (AST Architectural Invariants & Rules)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_gate_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('AST Parser & Lexical Tokenizer', () => {
    it('extracts ES and CommonJS imports across single and multiline declarations', () => {
      const code = `
        import { useState, useEffect } from 'react';
        import axios from 'axios';
        import {
          UserRepository,
          DatabasePool
        } from '../infrastructure/db.js';
        const config = require('./config.json');
      `;

      const imports = extractImports(code, '.ts');
      const modules = imports.map((i) => i.sourceModule);

      expect(modules).toContain('react');
      expect(modules).toContain('axios');
      expect(modules).toContain('../infrastructure/db.js');
      expect(modules).toContain('./config.json');
    });

    it('extracts Python imports and functions accurately', () => {
      const pyCode = `
import os
from database.connection import get_connection

def calculate_score(items):
    score = 0
    for item in items:
        if item.valid:
            score += 1
    return score
      `;

      const imports = extractImports(pyCode, '.py');
      expect(imports.map((i) => i.sourceModule)).toContain('os');
      expect(imports.map((i) => i.sourceModule)).toContain('database.connection');

      const symbols = extractSymbols(pyCode, '.py');
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('calculate_score');
      expect(symbols[0].cyclomaticComplexity).toBeGreaterThan(1);
    });

    it('calculates cyclomatic complexity accurately without false positives from strings', () => {
      const cleanFunc = `
        function calculateDiscount(price: number, isVip: boolean): number {
          // comments with if while for should not count
          const desc = "if we have while loop in string";
          if (price > 100 && isVip) {
            return price * 0.2;
          } else if (price > 50) {
            return price * 0.1;
          }
          return 0;
        }
      `;

      const complexity = calculateCyclomaticComplexity(cleanFunc);
      // Base: 1 + if (1) + && (1) + else if/if (1) = 4
      expect(complexity).toBe(4);
    });
  });

  describe('Architectural Boundary Rules', () => {
    it('detects when presentation layer illegally imports infrastructure modules', () => {
      const presentationFile = path.join(tmpDir, 'src', 'presentation', 'user-view.ts');
      fs.mkdirSync(path.dirname(presentationFile), { recursive: true });

      const content = `
        import { renderHtml } from '../utils/render.js';
        import { PostgresConnection } from '../infrastructure/postgres.js';

        export function renderUser() {
          return renderHtml();
        }
      `;
      fs.writeFileSync(presentationFile, content);

      const ast = parseFileAst(presentationFile);
      const boundaryRules = [
        {
          source: 'src/presentation/**',
          cannot_import: ['src/infrastructure/**', 'src/database/**'],
        },
      ];

      const violations = checkBoundaryRules(ast, boundaryRules, tmpDir);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('[BOUNDARY_VIOLATION]');
      expect(violations[0]).toContain('src/infrastructure/**');
    });

    it('allows legal imports that do not violate boundary constraints', () => {
      const presentationFile = path.join(tmpDir, 'src', 'presentation', 'user-view.ts');
      fs.mkdirSync(path.dirname(presentationFile), { recursive: true });

      const content = `
        import { renderHtml } from '../utils/render.js';
        import { UserModel } from '../domain/user.js';

        export function renderUser() {
          return renderHtml();
        }
      `;
      fs.writeFileSync(presentationFile, content);

      const ast = parseFileAst(presentationFile);
      const boundaryRules = [
        {
          source: 'src/presentation/**',
          cannot_import: ['src/infrastructure/**'],
        },
      ];

      const violations = checkBoundaryRules(ast, boundaryRules, tmpDir);
      expect(violations).toHaveLength(0);
    });
  });

  describe('Complexity and Line Count Ceilings', () => {
    it('flags functions exceeding configured cyclomatic complexity ceiling', () => {
      const filePath = path.join(tmpDir, 'complex.ts');
      // Create a function with > 15 branching points
      const complexCode = `
        function massiveBranching(x: number) {
          if (x === 1) return 1;
          if (x === 2) return 2;
          if (x === 3) return 3;
          if (x === 4) return 4;
          if (x === 5) return 5;
          if (x === 6) return 6;
          if (x === 7) return 7;
          if (x === 8) return 8;
          if (x === 9) return 9;
          if (x === 10) return 10;
          if (x === 11) return 11;
          if (x === 12) return 12;
          if (x === 13) return 13;
          if (x === 14) return 14;
          if (x === 15) return 15;
          if (x === 16) return 16;
          return 0;
        }
      `;
      fs.writeFileSync(filePath, complexCode);

      const ast = parseFileAst(filePath);
      const violations = checkComplexityCeilings(ast, 15, 60);

      expect(violations.some((v) => v.includes('[COMPLEXITY_EXCEEDED]'))).toBe(true);
      expect(violations[0]).toContain('massiveBranching');
    });

    it('flags functions exceeding line count limit', () => {
      const filePath = path.join(tmpDir, 'long-func.ts');
      const lines = ['function longProcedure() {'];
      for (let i = 0; i < 70; i++) {
        lines.push(`  const step${i} = ${i};`);
      }
      lines.push('  return 0;');
      lines.push('}');
      fs.writeFileSync(filePath, lines.join('\n'));

      const ast = parseFileAst(filePath);
      const violations = checkComplexityCeilings(ast, 20, 60);

      expect(violations.some((v) => v.includes('[LINE_COUNT_EXCEEDED]'))).toBe(true);
      expect(violations[0]).toContain('longProcedure');
    });
  });

  describe('Duplicate Symbol Detection', () => {
    it('detects duplicate function names declared within the same file', () => {
      const filePath = path.join(tmpDir, 'duplicate.ts');
      const code = `
        function calculateTax(amount: number) {
          return amount * 0.05;
        }

        // Agent mistakenly re-declares calculateTax later in the file
        function calculateTax(amount: number, state: string) {
          return amount * 0.08;
        }
      `;
      fs.writeFileSync(filePath, code);

      const ast = parseFileAst(filePath);
      const violations = checkDuplicateSymbols([ast]);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('[DUPLICATE_SYMBOL]');
      expect(violations[0]).toContain('calculateTax');
    });
  });

  describe('Overall evaluateAstInvariants Pipeline', () => {
    it('passes cleanly when code satisfies all architectural rules', () => {
      const filePath = path.join(tmpDir, 'clean.ts');
      const cleanCode = `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `;
      fs.writeFileSync(filePath, cleanCode);

      const config: InvarConfig = {
        project: { name: 'test' },
        vault: { mode: 'strict', locked_paths: [] },
        shadow: { quarantine_on_failure: true, max_retries: 0, windows_junctions: true },
        invariants: {
          max_cyclomatic_complexity: 15,
          max_function_lines: 60,
          ban_duplicate_symbols: true,
          boundaries: [],
        },
      };

      const result = evaluateAstInvariants(tmpDir, [filePath], config);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('collects multiple violations across rules into structured output', () => {
      const filePath = path.join(tmpDir, 'src', 'presentation', 'dirty.ts');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      const dirtyCode = `
        import { rawDb } from '../infrastructure/raw-db.js';

        function compute() {
          return 1;
        }

        function compute() {
          return 2;
        }
      `;
      fs.writeFileSync(filePath, dirtyCode);

      const config: InvarConfig = {
        project: { name: 'test' },
        vault: { mode: 'strict', locked_paths: [] },
        shadow: { quarantine_on_failure: true, max_retries: 0, windows_junctions: true },
        invariants: {
          max_cyclomatic_complexity: 15,
          max_function_lines: 60,
          ban_duplicate_symbols: true,
          boundaries: [
            {
              source: 'src/presentation/**',
              cannot_import: ['src/infrastructure/**'],
            },
          ],
        },
      };

      const result = evaluateAstInvariants(tmpDir, [filePath], config);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
      expect(result.violations.some((v) => v.includes('[BOUNDARY_VIOLATION]'))).toBe(true);
      expect(result.violations.some((v) => v.includes('[DUPLICATE_SYMBOL]'))).toBe(true);
    });
  });
});
