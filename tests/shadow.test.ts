import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDirectoryJunction, removeDirectoryJunction } from '../src/shadow/junction.js';

describe('invar-shadow (Junction & Isolation Utilities)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_shadow_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates directory junctions and links target directory contents seamlessly', () => {
    const targetDir = path.join(tmpDir, 'real_node_modules');
    const junctionDir = path.join(tmpDir, 'shadow', 'node_modules');

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'package.json'), '{"name":"dummy"}');

    const created = createDirectoryJunction(targetDir, junctionDir);
    expect(created).toBe(true);

    // Verify junction can read file from target
    const linkedFile = path.join(junctionDir, 'package.json');
    expect(fs.existsSync(linkedFile)).toBe(true);
    expect(fs.readFileSync(linkedFile, 'utf8')).toBe('{"name":"dummy"}');
  });

  it('safely unlinks directory junction without deleting the original target files', () => {
    const targetDir = path.join(tmpDir, 'real_node_modules');
    const junctionDir = path.join(tmpDir, 'shadow', 'node_modules');

    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, 'important.js');
    fs.writeFileSync(targetFile, 'console.log("preserve me");');

    createDirectoryJunction(targetDir, junctionDir);

    // Teardown: Unlink junction
    removeDirectoryJunction(junctionDir);

    // Junction must be gone, but real target files MUST be intact
    expect(fs.existsSync(junctionDir)).toBe(false);
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, 'utf8')).toBe('console.log("preserve me");');
  });
});
