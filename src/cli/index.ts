import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { globSync } from 'glob';
import { loadConfig } from '../config/loader.js';
import { detectTestRunner } from '../config/defaults.js';
import { executeTransaction } from '../tx/coordinator.js';
import { computeVaultState } from '../vault/hasher.js';
import { evaluateAstInvariants } from '../gate/rules.js';
import { runGit } from '../shadow/worktree.js';
import { listQuarantinedTransactions, applyQuarantinedDiff } from '../tx/quarantine.js';
import { startMcpServer } from '../mcp/server.js';
import { printBanner, formatBadge } from '../ui/banner.js';
import {
  formatAuditTable,
  formatQuarantineTable,
  formatDiffPreview,
  formatAstViolations,
} from '../ui/formatters.js';
import { createSpinner } from '../ui/spinner.js';

const program = new Command();

program
  .name('invar')
  .description('The Invariant-Guarded Transactional Kernel for AI Coding Agents')
  .version('0.1.0');

// Command: init
program
  .command('init')
  .description('Initialize Invar in the current repository and generate .invar.toml')
  .action(() => {
    printBanner();
    const cwd = process.cwd();
    const tomlPath = path.join(cwd, '.invar.toml');
    if (fs.existsSync(tomlPath)) {
      console.log(chalk.yellow('[invar] .invar.toml already exists in this directory.'));
      return;
    }

    const testRunner = detectTestRunner(cwd);
    const projectName = path.basename(cwd);
    const template = `[project]\nname = "${projectName}"\ntest_runner = "${testRunner}"\n\n[vault]\nmode = "strict"\nlocked_paths = [\n  "tests/**",\n  "test/**",\n  "__tests__/**",\n  "**/*.spec.*",\n  "**/*.test.*"\n]\n\n[shadow]\nquarantine_on_failure = true\nmax_retries = 0\nwindows_junctions = true\n\n[invariants]\nmax_cyclomatic_complexity = 15\nmax_function_lines = 60\nban_duplicate_symbols = true\n`;

    fs.writeFileSync(tomlPath, template, 'utf8');
    console.log(chalk.green(`✔ Created .invar.toml with auto-detected test runner: "${testRunner}"`));
    console.log(chalk.cyan('You can now run tasks with: npx invar run "<command>"'));
  });

function runAgentSubprocess(cmdString: string, shadowDir: string): void {
  try {
    execSync(cmdString, {
      cwd: shadowDir,
      stdio: 'inherit',
      env: { ...process.env, INVAR_SHADOW: 'true' },
    });
  } catch (err: any) {
    throw new Error(`Command exited with error: ${err.message}`);
  }
}

// Command: run
program
  .command('run <command...>')
  .description('Execute an agent task inside the transactional invariant envelope')
  .option('-s, --strict', 'Force strict vault mode (no test additions allowed)')
  .option('-a, --append-only', 'Allow new test files to be created (TDD mode)')
  .action(async (commandParts: string[], options: { strict?: boolean; appendOnly?: boolean }) => {
    printBanner();
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (options.strict) config.vault.mode = 'strict';
    if (options.appendOnly) config.vault.mode = 'append-only';

    const cmdString = commandParts.join(' ');
    const spinner = createSpinner(`Initializing transaction for: "${cmdString}"`);

    const result = await executeTransaction(
      cwd,
      config,
      (shadowDir) => {
        spinner.setText(`Running agent command inside shadow worktree...`);
        runAgentSubprocess(cmdString, shadowDir);
      },
      {
        intent: cmdString,
        onLog: (msg) => { spinner.setText(msg); },
      }
    );

    if (result.success) {
      spinner.succeed(`Transaction ${result.txId} COMMITTED successfully!`);
      if (result.diff) {
        console.log(chalk.bold.white('\nApplied Changes:'));
        console.log(formatDiffPreview(result.diff));
      }
    } else {
      spinner.fail(`Transaction ${result.txId} ROLLED BACK!`);
      console.log(chalk.red(`\nReason: ${result.error}`));
      if (result.quarantinePath) {
        console.log(chalk.yellow(`\n📦 Candidate diff has been preserved in quarantine:`));
        console.log(chalk.yellow(`   ${result.quarantinePath}`));
      }
      process.exit(1);
    }
  });

// Command: check
program
  .command('check')
  .description('Verify the current repository against configured test vault and invariants')
  .action(() => {
    printBanner();
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const vault = computeVaultState(cwd, config.vault.locked_paths);

    console.log(chalk.bold.white('Repository:   ') + chalk.cyan.bold(config.project.name));
    console.log(chalk.bold.white('Vault Mode:   ') + formatBadge(config.vault.mode));
    console.log(chalk.bold.white('Locked Files: ') + chalk.green.bold(vault.fileCount));
    console.log(chalk.bold.white('Merkle Root:  ') + chalk.gray(vault.rootHash) + '\n');
    console.log(chalk.green('✔ Test vault integrity is healthy.'));

    const sourceFiles = globSync('**/*.{ts,tsx,js,jsx,py}', {
      cwd,
      ignore: ['node_modules/**', 'dist/**', 'bin/**', '.invar/**', 'tests/**', '**/*.spec.*', '**/*.test.*', '**/*.config.*'],
      absolute: true,
    });

    const astResult = evaluateAstInvariants(cwd, sourceFiles, config);
    if (!astResult.passed) {
      console.log(chalk.red.bold(`\n✖ AST Architectural Invariant Violations found (${astResult.violations.length}):\n`));
      console.log(formatAstViolations(astResult.violations));
      process.exit(1);
    } else {
      console.log(chalk.green(`✔ All AST architectural invariants satisfied (${sourceFiles.length} source files checked).\n`));
    }
  });

// Command: mcp
program
  .command('mcp')
  .description('Launch the Model Context Protocol stdio server for IDE agents (Cursor, Claude Code, Windsurf)')
  .action(async () => {
    await startMcpServer(process.cwd());
  });

function inspectAuditLog(auditDir: string, txId: string): void {
  const logFile = path.join(auditDir, `${txId}.json`);
  if (!fs.existsSync(logFile)) {
    console.log(chalk.red(`[invar] No audit log found for transaction: ${txId}`));
    return;
  }
  const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  console.log(chalk.bold.cyan(`\ninvar Transaction Audit Proof: ${txId}\n`));
  console.log(JSON.stringify(data, null, 2));
}

// Command: audit
program
  .command('audit [txId]')
  .description('Inspect past transaction proofs and audit logs')
  .action((txId?: string) => {
    printBanner();
    const cwd = process.cwd();
    const auditDir = path.join(cwd, '.invar', 'audit');
    if (!fs.existsSync(auditDir)) {
      console.log(chalk.yellow('[invar] No audit logs recorded yet.'));
      return;
    }
    if (txId) {
      inspectAuditLog(auditDir, txId);
      return;
    }

    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      console.log(chalk.yellow('[invar] No audit logs recorded yet.'));
      return;
    }

    const logs = files.slice(-10).reverse().map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(auditDir, f), 'utf8'));
      } catch {
        return null;
      }
    }).filter(Boolean);

    console.log(chalk.bold.white('Recent Transaction Ledger:\n'));
    console.log(formatAuditTable(logs) + '\n');
  });

// Command: quarantine
const quarantineCmd = program.command('quarantine').description('Manage and inspect quarantined failure diffs');

quarantineCmd
  .command('list', { isDefault: true })
  .description('List all quarantined transactions')
  .action(() => {
    printBanner();
    const cwd = process.cwd();
    const list = listQuarantinedTransactions(cwd);
    if (list.length === 0) {
      console.log(chalk.green('✔ No quarantined transactions found. Repository is 100% clean!'));
      return;
    }

    console.log(chalk.bold.yellow(`Quarantined Transactions (${list.length}):\n`));
    console.log(formatQuarantineTable(list) + '\n');
    console.log(chalk.dim('To salvage implementation code: npx invar quarantine apply <txId> --exclude-tests\n'));
  });

quarantineCmd
  .command('apply <txId>')
  .description('Apply a quarantined diff to the active working tree')
  .option('-x, --exclude-tests', 'Strip test file modifications to salvage implementation code')
  .action((txId: string, options: { excludeTests?: boolean }) => {
    printBanner();
    const cwd = process.cwd();
    const result = applyQuarantinedDiff(cwd, txId, { excludeTests: options.excludeTests });
    if (result.success) {
      console.log(chalk.green.bold(`✔ Successfully applied quarantined diff for ${txId}!`));
      if (result.appliedFiles.length > 0) {
        console.log(chalk.cyan(`  Applied files: ${result.appliedFiles.join(', ')}`));
      }
      if (result.excludedFiles.length > 0) {
        console.log(chalk.yellow(`  Excluded test files (anti-cheat safe): ${result.excludedFiles.join(', ')}`));
      }
    } else {
      console.log(chalk.red(`✖ Failed to apply quarantined diff: ${result.error}`));
      process.exit(1);
    }
  });

// Command: clean
program
  .command('clean')
  .description('Clean orphaned shadow worktrees and prune Git references')
  .action(() => {
    printBanner();
    const cwd = process.cwd();
    const shadowParent = path.join(cwd, '.invar', 'shadow');
    if (fs.existsSync(shadowParent)) {
      fs.rmSync(shadowParent, { recursive: true, force: true });
    }
    try {
      runGit(['worktree', 'prune'], cwd);
      console.log(chalk.green('✔ Pruned shadow worktrees and cleaned Git metadata.'));
    } catch (err: any) {
      console.log(chalk.yellow(`Pruned worktrees with warning: ${err.message}`));
    }
  });

export function runCli(): void {
  program.parse(process.argv);
}

runCli();
