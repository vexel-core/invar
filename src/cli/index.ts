import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
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
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (options.strict) config.vault.mode = 'strict';
    if (options.appendOnly) config.vault.mode = 'append-only';

    const cmdString = commandParts.join(' ');
    console.log(chalk.bold.cyan('\ninvar v0.1.0 — The Invariant Agent Kernel\n'));
    const spinner = ora(chalk.blue(`Initializing transaction for: "${cmdString}"`)).start();

    const result = await executeTransaction(
      cwd,
      config,
      (shadowDir) => {
        spinner.text = chalk.yellow(`Running agent command inside shadow worktree...`);
        runAgentSubprocess(cmdString, shadowDir);
      },
      {
        intent: cmdString,
        onLog: (msg) => { spinner.text = chalk.blue(msg); },
      }
    );

    if (result.success) {
      spinner.succeed(chalk.green(`Transaction ${result.txId} COMMITTED successfully!`));
      if (result.diff) {
        console.log(chalk.gray('\nApplied changes:'));
        console.log(chalk.gray(result.diff.substring(0, 500) + (result.diff.length > 500 ? '\n...' : '')));
      }
    } else {
      spinner.fail(chalk.red(`Transaction ${result.txId} ROLLED BACK!`));
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
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const vault = computeVaultState(cwd, config.vault.locked_paths);

    console.log(chalk.bold.cyan('\ninvar Integrity Check\n'));
    console.log(`Repository:   ${chalk.bold(config.project.name)}`);
    console.log(`Vault Mode:   ${chalk.bold(config.vault.mode)}`);
    console.log(`Locked Files: ${chalk.green(vault.fileCount)}`);
    console.log(`Merkle Root:  ${chalk.gray(vault.rootHash)}\n`);
    console.log(chalk.green('✔ Vault configuration is healthy.'));

    const sourceFiles = globSync('**/*.{ts,tsx,js,jsx,py}', {
      cwd,
      ignore: ['node_modules/**', 'dist/**', 'bin/**', '.invar/**', 'tests/**', '**/*.spec.*', '**/*.test.*', '**/*.config.*'],
      absolute: true,
    });

    const astResult = evaluateAstInvariants(cwd, sourceFiles, config);
    if (!astResult.passed) {
      console.log(chalk.red(`\n✖ AST Architectural Invariant Violations found (${astResult.violations.length}):`));
      for (const v of astResult.violations) {
        console.log(chalk.yellow(`  • ${v}`));
      }
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

// Command: audit
program
  .command('audit [txId]')
  .description('Inspect past transaction proofs and audit logs')
  .action((txId?: string) => {
    const cwd = process.cwd();
    const auditDir = path.join(cwd, '.invar', 'audit');
    if (!fs.existsSync(auditDir)) {
      console.log(chalk.yellow('[invar] No audit logs recorded yet.'));
      return;
    }

    if (txId) {
      const logFile = path.join(auditDir, `${txId}.json`);
      if (!fs.existsSync(logFile)) {
        console.log(chalk.red(`[invar] No audit log found for transaction: ${txId}`));
        return;
      }
      const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      console.log(chalk.bold.cyan(`\ninvar Transaction Audit Proof: ${txId}\n`));
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      console.log(chalk.yellow('[invar] No audit logs recorded yet.'));
      return;
    }

    console.log(chalk.bold.cyan(`\ninvar Past Transactions (${files.length}):\n`));
    for (const file of files.slice(-10).reverse()) {
      try {
        const item = JSON.parse(fs.readFileSync(path.join(auditDir, file), 'utf8'));
        console.log(`• ${chalk.bold(item.txId)} [${chalk.green(item.status)}] - ${item.intent || 'No intent provided'} (${chalk.gray(item.timestamp)})`);
      } catch {}
    }
  });

// Command: quarantine
const quarantineCmd = program.command('quarantine').description('Manage and inspect quarantined failure diffs');

quarantineCmd
  .command('list', { isDefault: true })
  .description('List all quarantined transactions')
  .action(() => {
    const cwd = process.cwd();
    const list = listQuarantinedTransactions(cwd);
    if (list.length === 0) {
      console.log(chalk.green('No quarantined transactions found. Repository is clean!'));
      return;
    }

    console.log(chalk.bold.yellow(`\nFound ${list.length} quarantined transactions:\n`));
    for (const item of list) {
      console.log(`• ${chalk.bold(item.txId)} [${chalk.red(item.status)}] - ${item.reason}`);
      console.log(chalk.gray(`  Timestamp: ${item.timestamp}\n`));
    }
  });

quarantineCmd
  .command('apply <txId>')
  .description('Apply a quarantined diff to the active working tree')
  .option('-x, --exclude-tests', 'Strip test file modifications to salvage implementation code')
  .action((txId: string, options: { excludeTests?: boolean }) => {
    const cwd = process.cwd();
    const result = applyQuarantinedDiff(cwd, txId, { excludeTests: options.excludeTests });
    if (result.success) {
      console.log(chalk.green(`✔ Successfully applied quarantined diff for ${txId}!`));
      if (result.appliedFiles.length > 0) {
        console.log(chalk.cyan(`  Applied files: ${result.appliedFiles.join(', ')}`));
      }
      if (result.excludedFiles.length > 0) {
        console.log(chalk.yellow(`  Excluded test files: ${result.excludedFiles.join(', ')}`));
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
