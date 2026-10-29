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

    const template = `[project]
name = "${projectName}"
test_runner = "${testRunner}"

[vault]
mode = "strict"
locked_paths = [
  "tests/**",
  "test/**",
  "__tests__/**",
  "**/*.spec.*",
  "**/*.test.*"
]

[shadow]
quarantine_on_failure = true
max_retries = 0
windows_junctions = true

[invariants]
max_cyclomatic_complexity = 15
max_function_lines = 60
ban_duplicate_symbols = true
`;

    fs.writeFileSync(tomlPath, template, 'utf8');
    console.log(chalk.green(`✔ Created .invar.toml with auto-detected test runner: "${testRunner}"`));
    console.log(chalk.cyan('You can now run tasks with: npx invar run "<command>"'));
  });

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
        try {
          execSync(cmdString, {
            cwd: shadowDir,
            stdio: 'inherit',
            env: {
              ...process.env,
              INVAR_SHADOW: 'true',
            },
          });
        } catch (err: any) {
          throw new Error(`Command exited with error: ${err.message}`);
        }
      },
      {
        intent: cmdString,
        onLog: (msg) => {
          spinner.text = chalk.blue(msg);
        },
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

    // AST Invariant evaluation across source files
    const sourceFiles = globSync('**/*.{ts,tsx,js,jsx,py}', {
      cwd,
      ignore: [
        'node_modules/**',
        'dist/**',
        'bin/**',
        '.invar/**',
        'tests/**',
        '**/*.spec.*',
        '**/*.test.*',
        '**/*.config.*',
      ],
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

// Command: quarantine
program
  .command('quarantine')
  .description('List and inspect quarantined failure diffs')
  .action(() => {
    const cwd = process.cwd();
    const qDir = path.join(cwd, '.invar', 'quarantine');

    if (!fs.existsSync(qDir)) {
      console.log(chalk.green('No quarantined transactions found. Repository is clean!'));
      return;
    }

    const entries = fs.readdirSync(qDir);
    if (entries.length === 0) {
      console.log(chalk.green('No quarantined transactions found. Repository is clean!'));
      return;
    }

    console.log(chalk.bold.yellow(`\nFound ${entries.length} quarantined transactions:\n`));
    for (const txId of entries) {
      const manifestPath = path.join(qDir, txId, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        console.log(`• ${chalk.bold(txId)} [${chalk.red(manifest.status)}] - ${manifest.reason}`);
        console.log(chalk.gray(`  Path: ${path.join(qDir, txId)}\n`));
      }
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

// Auto-run when executed directly as CLI script
runCli();
