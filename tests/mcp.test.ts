import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  handleBeginTransaction,
  handleVerifyAndCommit,
  handleRollback,
  handleGetInvariants,
  createInvarMcpServer,
} from '../src/mcp/server.js';

describe('invar-mcp (Model Context Protocol Server)', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_mcp_test_'));
    // Initialize git repository
    execSync('git init', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git config user.email "test@invar.dev"', { cwd: tmpRepo, stdio: 'ignore' });

    // Initial commit
    fs.mkdirSync(path.join(tmpRepo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpRepo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, 'src', 'index.ts'), 'export const version = "1.0.0";');
    fs.writeFileSync(path.join(tmpRepo, 'tests', 'index.test.ts'), 'test("ok", () => {});');
    fs.writeFileSync(path.join(tmpRepo, '.gitignore'), '.invar/\nnode_modules/\n');
    fs.writeFileSync(
      path.join(tmpRepo, '.invar.toml'),
      '[project]\nname = "test-repo"\n\n[vault]\nmode = "strict"\nlocked_paths = ["tests/**"]\n\n[invariants]\nmax_cyclomatic_complexity = 15\n'
    );

    execSync('git add .', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: tmpRepo, stdio: 'ignore' });
  });

  afterEach(() => {
    try {
      execSync('git worktree prune', { cwd: tmpRepo, stdio: 'ignore' });
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    } catch {}
  });

  it('exposes active project invariants via handleGetInvariants', () => {
    const res = handleGetInvariants({ baseDir: tmpRepo });
    expect(res.content).toHaveLength(1);

    const data = JSON.parse(res.content[0].text);
    expect(data.project.name).toBe('test-repo');
    expect(data.vault.mode).toBe('strict');
    expect(data.invariants.max_cyclomatic_complexity).toBe(15);
  });

  it('begins transaction, isolates execution, and rolls back cleanly', async () => {
    const beginRes = await handleBeginTransaction({
      baseDir: tmpRepo,
      intent: 'Simulated refactor',
    });

    expect(beginRes.isError).toBeFalsy();
    const data = JSON.parse(beginRes.content[0].text);
    expect(data.txId).toBeDefined();
    expect(data.status).toBe('MOUNTED');
    expect(fs.existsSync(data.shadowDirectory)).toBe(true);

    // Rollback
    const rollbackRes = await handleRollback({ txId: data.txId });
    expect(rollbackRes.isError).toBeFalsy();

    const rollbackData = JSON.parse(rollbackRes.content[0].text);
    expect(rollbackData.status).toBe('ROLLED_BACK');
    expect(fs.existsSync(data.shadowDirectory)).toBe(false);
  }, 30000);

  it('commits clean modifications via handleVerifyAndCommit', async () => {
    const beginRes = await handleBeginTransaction({
      baseDir: tmpRepo,
      intent: 'Add helper function',
    });

    const data = JSON.parse(beginRes.content[0].text);
    const shadowFile = path.join(data.shadowDirectory, 'src', 'helper.ts');

    // Agent writes valid implementation inside shadow worktree
    fs.writeFileSync(shadowFile, 'export function add(a: number, b: number) { return a + b; }\n');

    const commitRes = await handleVerifyAndCommit({ txId: data.txId });
    expect(commitRes.isError).toBeFalsy();

    const commitData = JSON.parse(commitRes.content[0].text);
    expect(commitData.status).toBe('COMMITTED');
    expect(commitData.success).toBe(true);

    // Verify change is reflected in parent repository
    expect(fs.existsSync(path.join(tmpRepo, 'src', 'helper.ts'))).toBe(true);
    // Verify shadow worktree was torn down
    expect(fs.existsSync(data.shadowDirectory)).toBe(false);
  }, 30000);

  it('creates an MCP server instance with registered tools', () => {
    const server = createInvarMcpServer(tmpRepo);
    expect(server).toBeDefined();
  });
});
