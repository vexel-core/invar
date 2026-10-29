import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parkQuarantine } from '../src/tx/coordinator.js';
import { detectActiveTreeEscape } from '../src/tx/escape.js';
import { saveAuditLog } from '../src/audit/logger.js';
import type { TransactionResult } from '../src/config/types.js';

describe('invar-tx (Transaction Coordinator & Quarantine)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_tx_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('parks failed transaction diffs in quarantine with structured manifest', () => {
    const txId = 'tx_test_001';
    const fakeDiff = 'diff --git a/src/app.ts b/src/app.ts\n+console.log("new");';
    const reason = 'Test suite failed with exit code 1';

    const qPath = parkQuarantine(tmpDir, txId, fakeDiff, 'test_failure', reason);

    expect(fs.existsSync(qPath)).toBe(true);

    const manifestFile = path.join(qPath, 'manifest.json');
    const patchFile = path.join(qPath, 'candidate.patch');

    expect(fs.existsSync(manifestFile)).toBe(true);
    expect(fs.existsSync(patchFile)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.txId).toBe(txId);
    expect(manifest.status).toBe('test_failure');
    expect(manifest.reason).toBe(reason);

    expect(fs.readFileSync(patchFile, 'utf8')).toBe(fakeDiff);
  });

  it('parks AST architectural invariant violations in quarantine with status ast_violation', () => {
    const txId = 'tx_ast_002';
    const fakeDiff = 'diff --git a/src/presentation/view.ts b/src/presentation/view.ts\n+import { db } from "../infrastructure/db.js";';
    const reason = 'AST Invariant Violation: Found 1 boundary violation';

    const qPath = parkQuarantine(tmpDir, txId, fakeDiff, 'ast_violation', reason);

    expect(fs.existsSync(qPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(qPath, 'manifest.json'), 'utf8'));
    expect(manifest.txId).toBe(txId);
    expect(manifest.status).toBe('ast_violation');
    expect(manifest.reason).toBe(reason);
  });

  it('detects when an agent attempts an out-of-bounds escape', () => {
    const initialStatus = [' M src/existing.ts'];

    // No escape
    const check1 = detectActiveTreeEscape(tmpDir, initialStatus);
    expect(check1.escaped).toBe(false);
  });

  it('generates structured audit logs in .invar/audit/ directory', () => {
    const fakeResult: TransactionResult = {
      txId: 'tx_audit_01',
      status: 'COMMITTED',
      success: true,
      preVaultRoot: 'abc123hash',
      postVaultRoot: 'abc123hash',
      diff: 'diff --git a/a.ts b/a.ts',
    };

    const logFile = saveAuditLog(tmpDir, fakeResult, 'Refactor payment service');

    expect(fs.existsSync(logFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    expect(saved.txId).toBe('tx_audit_01');
    expect(saved.status).toBe('COMMITTED');
    expect(saved.intent).toBe('Refactor payment service');
    expect(saved.timestamp).toBeDefined();
  });
});
