import { spawnSync } from 'node:child_process';
import type { TestExecutionResult } from '../config/types.js';

export function runLockedSuite(shadowDir: string, testRunnerCmd: string): TestExecutionResult {
  const startTime = Date.now();

  try {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const flag = isWindows ? '/c' : '-c';

    const child = spawnSync(shell, [flag, testRunnerCmd], {
      cwd: shadowDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        INVAR_SHADOW: 'true',
        CI: 'true',
      },
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024, // 20 MB buffer
    });

    const durationMs = Date.now() - startTime;
    const exitCode = child.status ?? (child.signal ? 1 : 0);
    const stdout = child.stdout || '';
    const stderr = child.stderr || '';

    return {
      passed: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      durationMs,
    };
  } catch (err: any) {
    return {
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: `Failed to execute test runner: ${err.message}`,
      durationMs: Date.now() - startTime,
    };
  }
}
