import fs from 'node:fs';
import path from 'node:path';
import type { InvarConfig } from './types.js';

export function detectTestRunner(cwd: string): string {
  // Check for Node/TS test frameworks
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.vitest) return 'npx vitest run';
      if (deps.jest) return 'npx jest';
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return 'npm test';
      }
    } catch {
      // Fallback
    }
  }

  // Check for Python pytest
  if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'setup.cfg')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    return 'pytest';
  }

  // Check for Rust cargo
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    return 'cargo test';
  }

  // Check for Go
  if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    return 'go test ./...';
  }

  return '';
}

export function getDefaultConfig(cwd: string): InvarConfig {
  const detectedRunner = detectTestRunner(cwd);
  const projectName = path.basename(path.resolve(cwd)) || 'invar-project';

  return {
    project: {
      name: projectName,
      test_runner: detectedRunner,
    },
    vault: {
      mode: 'strict',
      locked_paths: [
        'tests/**',
        'test/**',
        '__tests__/**',
        '**/*.spec.*',
        '**/*.test.*',
      ],
    },
    shadow: {
      quarantine_on_failure: true,
      max_retries: 0,
      windows_junctions: true,
    },
    invariants: {
      max_cyclomatic_complexity: 15,
      max_function_lines: 60,
      ban_duplicate_symbols: true,
      boundaries: [],
    },
  };
}
