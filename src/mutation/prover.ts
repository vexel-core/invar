import fs from 'node:fs';
import path from 'node:path';
import type { MicroMutant, MutationProofResult } from '../config/types.js';
import { runLockedSuite } from '../gate/runner.js';
import {
  applyMutant,
  extractModifiedLinesFromDiff,
  findMicroMutants,
} from './operators.js';

export interface ProverOptions {
  maxMutants?: number;
  onLog?: (message: string) => void;
}

function isSourceCodeFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  if (/(^|\/)(tests?|__tests__|spec)\//i.test(normalized)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(normalized)) return false;
  if (/(^|\/)(scripts|\.invar|dist|\.next|node_modules)\//i.test(normalized)) return false;
  if (/\.config\.[cm]?[jt]sx?$/i.test(normalized)) return false;
  if (!normalized.includes('/') && /^(agent|build|setup|test|run)/i.test(normalized)) return false;
  return /\.[cm]?[jt]sx?$/i.test(normalized);
}

function collectCandidateMutants(
  shadowDir: string,
  modifiedLines: Map<string, Set<number>>
): MicroMutant[] {
  const allMutants: MicroMutant[] = [];
  for (const [relPath, lines] of modifiedLines.entries()) {
    if (!isSourceCodeFile(relPath)) continue;
    const fullPath = path.join(shadowDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    const mutants = findMicroMutants(relPath, content, lines);
    allMutants.push(...mutants);
  }
  return allMutants;
}

function runSingleMutantTrial(
  shadowDir: string,
  mutant: MicroMutant,
  testRunnerCmd: string,
  log: (msg: string) => void
): { mutant: MicroMutant; killed: boolean; failureMessage?: string } {
  const fullPath = path.join(shadowDir, mutant.filePath);
  const originalCode = fs.readFileSync(fullPath, 'utf8');
  const mutatedCode = applyMutant(originalCode, mutant);

  try {
    fs.writeFileSync(fullPath, mutatedCode, 'utf8');
    log(`[invar-mutation] Testing mutant ${mutant.id} on ${mutant.filePath}:${mutant.line} (${mutant.originalText} -> ${mutant.mutatedText})...`);
    const testResult = runLockedSuite(shadowDir, testRunnerCmd);

    if (!testResult.passed) {
      log(`[invar-mutation] ✔ Mutant ${mutant.id} killed by test suite.`);
      return { mutant, killed: true };
    }

    log(`[invar-mutation] ✖ Mutant ${mutant.id} survived! Placebo test detected.`);
    return {
      mutant,
      killed: false,
      failureMessage: `Mutant ${mutant.id} survived on ${mutant.filePath}:${mutant.line}`,
    };
  } finally {
    fs.writeFileSync(fullPath, originalCode, 'utf8');
  }
}

export function proveMutationsKilled(
  shadowDir: string,
  diffText: string,
  testRunnerCmd: string,
  options: ProverOptions = {}
): MutationProofResult {
  const log = options.onLog || (() => {});
  const maxMutants = options.maxMutants || 3;
  const modifiedLines = extractModifiedLinesFromDiff(diffText);
  const candidates = collectCandidateMutants(shadowDir, modifiedLines);

  if (candidates.length === 0) {
    return {
      totalMutants: 0,
      killedMutants: 0,
      survivedMutants: 0,
      isLoadBearing: true,
      mutants: [],
      violations: [],
    };
  }

  const selected = candidates.slice(0, maxMutants);
  const results = selected.map((m) => runSingleMutantTrial(shadowDir, m, testRunnerCmd, log));
  const killedCount = results.filter((r) => r.killed).length;
  const survivedCount = results.filter((r) => !r.killed).length;
  const violations = results
    .filter((r) => !r.killed)
    .map(
      (r) =>
        `[PLACEBO_TEST_DETECTED] Mutant ${r.mutant.id} on line ${r.mutant.line} of ${r.mutant.filePath} (${r.mutant.originalText} -> ${r.mutant.mutatedText}) survived all tests.`
    );

  return {
    totalMutants: results.length,
    killedMutants: killedCount,
    survivedMutants: survivedCount,
    isLoadBearing: killedCount > 0 && survivedCount === 0,
    mutants: results,
    violations,
  };
}
