import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hashFileContent, computeVaultState } from '../src/vault/hasher.js';
import { verifyVaultIntegrity } from '../src/vault/locker.js';

describe('invar-vault (Anti-Cheat & Merkle Locker)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_vault_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('normalizes CRLF to LF so line endings never cause false-positive mismatches', () => {
    const unixStr = 'describe("suite", () => {\n  it("works", () => {});\n});\n';
    const winStr = 'describe("suite", () => {\r\n  it("works", () => {});\r\n});\r\n';

    const hash1 = hashFileContent(unixStr);
    const hash2 = hashFileContent(winStr);

    expect(hash1).toBe(hash2);
  });

  it('computes stable deterministic Merkle root for test files', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'tests', 'a.test.ts'), 'test a content');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'b.test.ts'), 'test b content');

    const vault1 = computeVaultState(tmpDir, ['tests/**']);
    const vault2 = computeVaultState(tmpDir, ['tests/**']);

    expect(vault1.fileCount).toBe(2);
    expect(vault1.rootHash).toBe(vault2.rootHash);
    expect(vault1.manifest['tests/a.test.ts']).toBeDefined();
    expect(vault1.manifest['tests/b.test.ts']).toBeDefined();
  });

  it('detects tampering when an agent modifies a locked test assertion', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    const testFile = path.join(tmpDir, 'tests', 'checkout.test.ts');
    fs.writeFileSync(testFile, 'expect(total).toBe(100);');

    const preVault = computeVaultState(tmpDir, ['tests/**']);

    // Agent attempts Goodhart's Law: weakens assertion to pass broken code
    fs.writeFileSync(testFile, 'expect(total).toBe(80); // Cheated!');

    const check = verifyVaultIntegrity(tmpDir, preVault, ['tests/**'], 'strict');

    expect(check.verified).toBe(false);
    expect(check.tamperDetected).toBe(true);
    expect(check.violations.some((v) => v.includes('[MODIFIED]'))).toBe(true);
  });

  it('detects tampering when an agent deletes a failing test file', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    const testFile = path.join(tmpDir, 'tests', 'failing.test.ts');
    fs.writeFileSync(testFile, 'test("failing", () => { throw new Error(); });');

    const preVault = computeVaultState(tmpDir, ['tests/**']);

    // Agent deletes the failing test
    fs.unlinkSync(testFile);

    const check = verifyVaultIntegrity(tmpDir, preVault, ['tests/**'], 'strict');

    expect(check.verified).toBe(false);
    expect(check.tamperDetected).toBe(true);
    expect(check.violations.some((v) => v.includes('[DELETED]'))).toBe(true);
  });

  it('strict mode rejects newly added test files to prevent masking failures', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'tests', 'existing.test.ts'), 'content');

    const preVault = computeVaultState(tmpDir, ['tests/**']);

    // Agent adds a new test file under strict mode
    fs.writeFileSync(path.join(tmpDir, 'tests', 'new.test.ts'), 'trivial test');

    const check = verifyVaultIntegrity(tmpDir, preVault, ['tests/**'], 'strict');

    expect(check.verified).toBe(false);
    expect(check.violations.some((v) => v.includes('[ADDED]'))).toBe(true);
  });

  it('append-only mode allows new test files as long as existing tests remain identical', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'tests', 'existing.test.ts'), 'content');

    const preVault = computeVaultState(tmpDir, ['tests/**']);

    // Agent writes a new feature test in TDD mode
    fs.writeFileSync(path.join(tmpDir, 'tests', 'feature.test.ts'), 'new feature test');

    const check = verifyVaultIntegrity(tmpDir, preVault, ['tests/**'], 'append-only');

    expect(check.verified).toBe(true);
    expect(check.tamperDetected).toBe(false);
    expect(check.violations).toHaveLength(0);
  });
});
