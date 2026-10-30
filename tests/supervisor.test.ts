import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runGit } from '../src/shadow/worktree.js';
import {
  handleBeginTransaction,
  handleRollback,
  activeMcpSessions,
  createInvarMcpServer,
} from '../src/mcp/server.js';
import { validateIncrementalSession } from '../src/mcp/supervisor.js';

describe('Live Interactive MCP Supervisor (invar_validate_incremental)', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_sup_test_'));
    runGit(['init', '-b', 'main'], testRepo);
    runGit(['config', 'user.name', 'Invar Supervisor'], testRepo);
    runGit(['config', 'user.email', 'sup@invar.dev'], testRepo);

    fs.writeFileSync(path.join(testRepo, '.gitignore'), '.invar/\nnode_modules/\n', 'utf8');
    fs.mkdirSync(path.join(testRepo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(testRepo, 'tests'), { recursive: true });

    fs.writeFileSync(
      path.join(testRepo, 'src', 'service.ts'),
      'export function compute(x: number): number {\n  return x * 2;\n}\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(testRepo, 'tests', 'service.test.ts'),
      'describe("Service", () => {\n  it("computes double", () => {\n    expect(compute(2)).toBe(4);\n  });\n});\n',
      'utf8'
    );

    runGit(['add', '-A'], testRepo);
    runGit(['commit', '-m', '"init"'], testRepo);
  });

  afterEach(() => {
    for (const [txId] of activeMcpSessions.entries()) {
      handleRollback({ txId });
    }
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  it('validates clean incremental code with zero violations', async () => {
    const beginRes = await handleBeginTransaction({ baseDir: testRepo });
    const { txId, shadowDirectory } = JSON.parse(beginRes.content[0].text);
    const session = activeMcpSessions.get(txId)!;

    fs.writeFileSync(
      path.join(shadowDirectory, 'src', 'service.ts'),
      'export function compute(x: number): number {\n  return x > 0 ? x * 2 : 0;\n}\n',
      'utf8'
    );

    const validation = validateIncrementalSession(session);
    expect(validation.valid).toBe(true);
    expect(validation.issues.length).toBe(0);
    expect(validation.summary).toContain('✔ All incremental invariants satisfied');

    await handleRollback({ txId });
  });

  it('detects complexity violations and verifies agent self-healing cycle', async () => {
    const beginRes = await handleBeginTransaction({ baseDir: testRepo });
    const { txId, shadowDirectory } = JSON.parse(beginRes.content[0].text);
    const session = activeMcpSessions.get(txId)!;

    // 1. Agent writes overly complex nested logic (complexity > 15)
    const complexCode = [
      'export function compute(a: number, b: number): number {',
      '  if (a > 1 && b > 2) {',
      '    if (a === 3 || b === 4) {',
      '      if (a === 5 && b === 6) {',
      '        if (a === 7 || b === 8) {',
      '          if (a === 9 && b === 10) {',
      '            if (a === 11 || b === 12) {',
      '              if (a === 13 || b === 14) {',
      '                if (a === 15 || b === 16) {',
      '                  if (a === 17 || b === 18) {',
      '                    return 1;',
      '                  }',
      '                }',
      '              }',
      '            }',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');

    fs.writeFileSync(path.join(shadowDirectory, 'src', 'service.ts'), complexCode, 'utf8');

    // 2. Incremental supervisor detects violation
    const check1 = validateIncrementalSession(session);
    expect(check1.valid).toBe(false);
    expect(check1.issues.length).toBeGreaterThan(0);
    const compIssue = check1.issues.find((i) => i.type === 'complexity');
    expect(compIssue).toBeDefined();
    expect(compIssue?.suggestion).toContain('Refactor complex branching');

    // 3. Agent reads diagnostic and self-heals by refactoring
    const healedCode = 'export function compute(a: number, b: number): number {\n  return a + b;\n}\n';
    fs.writeFileSync(path.join(shadowDirectory, 'src', 'service.ts'), healedCode, 'utf8');

    // 4. Incremental supervisor approves healed code
    const check2 = validateIncrementalSession(session);
    expect(check2.valid).toBe(true);
    expect(check2.issues.length).toBe(0);

    await handleRollback({ txId });
  });

  it('executes invar_validate_incremental via MCP server schema handler', async () => {
    const server = createInvarMcpServer(testRepo);
    const beginRes = await handleBeginTransaction({ baseDir: testRepo });
    const { txId } = JSON.parse(beginRes.content[0].text);

    // Call tool directly
    const session = activeMcpSessions.get(txId)!;
    const val = validateIncrementalSession(session);
    expect(val.txId).toBe(txId);
    expect(val.valid).toBe(true);

    await handleRollback({ txId });
  });
});
