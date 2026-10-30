import type { ActiveMcpSession } from './server.js';
import { getModifiedFiles } from '../tx/coordinator.js';
import { evaluateAstInvariants } from '../gate/rules.js';
import { verifyVaultIntegrity } from '../vault/locker.js';
import { detectActiveTreeEscape } from '../tx/escape.js';

export interface SupervisorIssue {
  type: 'complexity' | 'line_count' | 'boundary' | 'duplicate_symbol' | 'test_preservation' | 'escape';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface IncrementalValidationResult {
  valid: boolean;
  txId: string;
  modifiedFilesCount: number;
  summary: string;
  issues: SupervisorIssue[];
}

function parseAstViolation(raw: string): SupervisorIssue {
  if (raw.includes('[COMPLEXITY_EXCEEDED]')) {
    const match = raw.match(/Function "([^"]+)" at ([^:]+):(\d+) has cyclomatic complexity (\d+) \(limit: (\d+)\)/);
    return {
      type: 'complexity',
      file: match ? match[2] : undefined,
      line: match ? Number.parseInt(match[3], 10) : undefined,
      message: raw,
      suggestion: 'Refactor complex branching, nested loops, or ternary expressions into smaller functions.',
    };
  }
  if (raw.includes('[LINE_COUNT_EXCEEDED]')) {
    const match = raw.match(/Function "([^"]+)" at ([^:]+):(\d+) is (\d+) lines long \(limit: (\d+)\)/);
    return {
      type: 'line_count',
      file: match ? match[2] : undefined,
      line: match ? Number.parseInt(match[3], 10) : undefined,
      message: raw,
      suggestion: 'Split long function into smaller sub-routines (limit: 60 lines).',
    };
  }
  if (raw.includes('[BOUNDARY_VIOLATION]')) {
    return {
      type: 'boundary',
      message: raw,
      suggestion: 'Remove disallowed architectural imports to respect modular boundaries.',
    };
  }
  return {
    type: 'duplicate_symbol',
    message: raw,
    suggestion: 'Rename duplicate symbol or scope it locally to avoid namespace collision.',
  };
}

function collectIncrementalIssues(session: ActiveMcpSession, modified: string[]): SupervisorIssue[] {
  const issues: SupervisorIssue[] = [];
  const { baseDir, shadow, initialActiveStatus, config, preVault } = session;

  const escapeCheck = detectActiveTreeEscape(baseDir, initialActiveStatus);
  if (escapeCheck.escaped) {
    issues.push({
      type: 'escape',
      message: `Active tree escape: modifications detected in parent repo: ${escapeCheck.unauthorizedModifications.join(', ')}`,
      suggestion: 'Ensure all file writes are strictly targeted inside shadowDirectory.',
    });
  }

  if (modified.length > 0) {
    const ast = evaluateAstInvariants(shadow.shadowDir, modified, config);
    for (const v of ast.violations) {
      issues.push(parseAstViolation(v));
    }
  }

  const vault = verifyVaultIntegrity(shadow.shadowDir, preVault, config.vault.locked_paths, config.vault.mode);
  if (vault.tamperDetected) {
    for (const v of vault.violations) {
      issues.push({
        type: 'test_preservation',
        message: v,
        suggestion: 'Preserve all existing test blocks and assertions without tampering or deletion.',
      });
    }
  }

  return issues;
}

export function validateIncrementalSession(session: ActiveMcpSession): IncrementalValidationResult {
  const modified = getModifiedFiles(session.shadow.shadowDir, session.shadow.baseCommit);
  const issues = collectIncrementalIssues(session, modified);
  const valid = issues.length === 0;
  const summary = valid
    ? `✔ All incremental invariants satisfied (${modified.length} modified files checked). Ready to commit.`
    : `✖ Found ${issues.length} architectural invariant violations. Resolve these before committing.`;

  return {
    valid,
    txId: session.txId,
    modifiedFilesCount: modified.length,
    summary,
    issues,
  };
}

export async function handleValidateIncremental(
  session: ActiveMcpSession
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const result = validateIncrementalSession(session);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: !result.valid,
  };
}
