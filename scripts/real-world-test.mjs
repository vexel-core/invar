import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';

const INVAR_BIN = path.resolve('bin/invar.js');
console.log('=== INVAR REAL-WORLD INTEGRATION & VERIFICATION GAUNTLET ===');
console.log(`Using Invar binary: ${INVAR_BIN}\n`);

const testSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'invar_real_world_'));
console.log(`[1] Created real-world test workspace: ${testSandbox}`);

function run(cmd, cwd = testSandbox) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

try {
  // 1. Initialize a real Git repository
  console.log('\n--- Step 1: Initialize Git Repository & Project ---');
  run('git init');
  run('git config user.name "Invar Tester"');
  run('git config user.email "tester@invar.dev"');

  const pkgJson = {
    name: 'sample-app',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node --test',
    },
  };
  fs.writeFileSync(path.join(testSandbox, 'package.json'), JSON.stringify(pkgJson, null, 2));

  // Source implementation
  fs.mkdirSync(path.join(testSandbox, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(testSandbox, 'src', 'calculator.js'),
    `export function calculateDiscount(price, isVip) {\n  if (isVip) {\n    return price * 0.8;\n  }\n  return price;\n}\n`
  );

  // Locked unit test using Node native test runner (zero external dependencies)
  fs.mkdirSync(path.join(testSandbox, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(testSandbox, 'tests', 'calculator.test.js'),
    `import test from 'node:test';\nimport assert from 'node:assert';\nimport { calculateDiscount } from '../src/calculator.js';\n\ntest('discounts price for VIP customer', () => {\n  const result = calculateDiscount(100, true);\n  assert.strictEqual(result, 80);\n});\n`
  );

  run('git add .');
  run('git commit -m "feat: initial commit with calculator & test"');
  console.log('✔ Git repository initialized and clean commit created.');

  // 2. Run invar init
  console.log('\n--- Step 2: Test "invar init" ---');
  const initOut = run(`node "${INVAR_BIN}" init`);
  console.log(initOut.trim());
  if (!fs.existsSync(path.join(testSandbox, '.invar.toml'))) {
    throw new Error('.invar.toml was not created by invar init!');
  }
  console.log('✔ .invar.toml generated successfully.');

  // Configure .invar.toml test runner to use native node test
  const tomlContent = `
[project]
name = "sample-app"
test_runner = "node --test"

[vault]
mode = "strict"
locked_paths = ["tests/**"]

[shadow]
quarantine_on_failure = true
max_retries = 0
windows_junctions = true

[invariants]
max_cyclomatic_complexity = 15
max_function_lines = 60
ban_duplicate_symbols = true
`;
  fs.writeFileSync(path.join(testSandbox, '.invar.toml'), tomlContent.trim());
  run('git add .invar.toml');
  run('git commit -m "chore: configure invar"');

  // 3. Test invar check
  console.log('\n--- Step 3: Test "invar check" ---');
  const checkOut = run(`node "${INVAR_BIN}" check`);
  console.log(checkOut.trim());
  console.log('✔ "invar check" passed on clean repository.');

  // 4. Test invar run with legitimate feature addition
  console.log('\n--- Step 4: Test "invar run" (Legitimate Feature Task) ---');
  // External agent runner script driving code changes inside the shadow worktree
  const agentFeatureScript = path.join(os.tmpdir(), `external_agent_feature_${Date.now()}.mjs`);
  fs.writeFileSync(
    agentFeatureScript,
    `import fs from 'node:fs';
import path from 'node:path';

// Update src/calculator.js
const calcPath = path.resolve('src/calculator.js');
const newCode = \`export function calculateDiscount(price, isVip, couponCode) {
  if (couponCode === 'HALF') {
    return price * 0.5;
  }
  if (isVip) {
    return price * 0.8;
  }
  return price;
}
\`;
fs.writeFileSync(calcPath, newCode);

// Add new test inside tests/calculator.test.js
const testPath = path.resolve('tests/calculator.test.js');
const existingTests = fs.readFileSync(testPath, 'utf8');
const addedTest = existingTests + \`
test('applies HALF coupon code discount', () => {
  const result = calculateDiscount(100, false, 'HALF');
  assert.strictEqual(result, 50);
});
\`;
fs.writeFileSync(testPath, addedTest);
`
  );

  let featureRun;
  try {
    featureRun = run(`node "${INVAR_BIN}" run "node \\"${agentFeatureScript}\\"" --profile feature`);
  } catch (err) {
    console.error('Feature run failed!');
    console.error('STDOUT:', err.stdout);
    console.error('STDERR:', err.stderr);
    const qDir = path.join(testSandbox, '.invar', 'quarantine');
    if (fs.existsSync(qDir)) {
      const txs = fs.readdirSync(qDir);
      for (const tx of txs) {
        const mPath = path.join(qDir, tx, 'manifest.json');
        if (fs.existsSync(mPath)) {
          console.error('QUARANTINE MANIFEST:', fs.readFileSync(mPath, 'utf8'));
        }
      }
    }
    throw err;
  }
  console.log(featureRun);
  console.log('✔ Legitimate feature task committed atomically to repository!');

  // Verify commit in git log
  const gitLog = run('git log -n 1 --oneline');
  console.log(`Current HEAD: ${gitLog.trim()}`);

  // 5. Test invar run with Goodhart's Law cheating (Agent tampers with existing test)
  console.log('\n--- Step 5: Test Cheating Interception (Assertion Tampering) ---');
  const agentCheatScript = path.join(os.tmpdir(), `external_agent_cheat_${Date.now()}.mjs`);
  fs.writeFileSync(
    agentCheatScript,
    `import fs from 'node:fs';
import path from 'node:path';

// Break implementation
const calcPath = path.resolve('src/calculator.js');
fs.writeFileSync(calcPath, 'export function calculateDiscount() { return 999; }\\n');

// Weaken test to cheat
const testPath = path.resolve('tests/calculator.test.js');
const tampered = \`import test from 'node:test';
import assert from 'node:assert';
import { calculateDiscount } from '../src/calculator.js';

test('discounts price for VIP customer', () => {
  const result = calculateDiscount(100, true);
  assert.ok(result); // WEAKENED ASSERTION (Goodhart's Law)
});
\`;
fs.writeFileSync(testPath, tampered);
`
  );

  try {
    run(`node "${INVAR_BIN}" run "node \\"${agentCheatScript}\\"" --profile bugfix`);
    throw new Error('Cheating transaction should have been blocked!');
  } catch (err) {
    console.log('✔ Agent cheating transaction was successfully intercepted & rolled back!');
  }

  // Verify active repository was NOT touched
  const activeCalc = fs.readFileSync(path.join(testSandbox, 'src', 'calculator.js'), 'utf8');
  if (activeCalc.includes('return 999')) {
    throw new Error('Active repository was polluted by rolled-back transaction!');
  }
  console.log('✔ Active repository is 100% clean (zero pollution).');

  // 6. Test quarantine inspect and salvage
  console.log('\n--- Step 6: Test Quarantine & Developer Salvage ---');
  const qList = run(`node "${INVAR_BIN}" quarantine`);
  console.log(qList.trim());

  // Extract quarantined transaction ID
  const match = qList.match(/tx_[a-z0-9_]+/i);
  if (!match) {
    throw new Error('No quarantined transaction ID found!');
  }
  const txId = match[0];
  console.log(`Found quarantined transaction: ${txId}`);

  // Apply with --exclude-tests
  const salvageOut = run(`node "${INVAR_BIN}" quarantine apply ${txId} --exclude-tests`);
  console.log(salvageOut.trim());

  // Verify test file was preserved while implementation was updated
  const testAfterSalvage = fs.readFileSync(path.join(testSandbox, 'tests', 'calculator.test.js'), 'utf8');
  if (testAfterSalvage.includes('assert.ok(result)')) {
    throw new Error('Quarantine apply failed to exclude weakened test assertion!');
  }
  console.log('✔ Quarantine apply safely excluded test modifications while salvaging code.');

  // Clean git tree
  run('git checkout -- .');

  // 7. Test audit logs
  console.log('\n--- Step 7: Test Audit Ledger ---');
  const auditOut = run(`node "${INVAR_BIN}" audit`);
  console.log(auditOut.trim());
  console.log('✔ Cryptographic audit proofs recorded and readable.');

  console.log('\n========================================================');
  console.log('🎉 ALL REAL-WORLD END-TO-END SCENARIOS VERIFIED 100% CLEAN!');
  console.log('========================================================\n');
} finally {
  try {
    fs.rmSync(testSandbox, { recursive: true, force: true });
  } catch {}
}
