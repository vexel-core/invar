import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { InvarConfig, VaultState } from '../config/types.js';
import { loadConfig } from '../config/loader.js';
import { computeVaultState } from '../vault/hasher.js';
import { verifyVaultIntegrity } from '../vault/locker.js';
import {
  createShadowWorktree,
  destroyShadowWorktree,
  type ShadowWorktreeInstance,
} from '../shadow/worktree.js';
import { extractShadowDiff, applyShadowDiffToActiveTree } from '../shadow/merger.js';
import { runLockedSuite } from '../gate/runner.js';
import { evaluateAstInvariants } from '../gate/rules.js';
import { captureActiveTreeStatus, detectActiveTreeEscape } from '../tx/escape.js';
import { parkQuarantine } from '../tx/quarantine.js';
import { saveAuditLog } from '../audit/logger.js';
import { getModifiedFiles } from '../tx/coordinator.js';
import { handleValidateIncremental } from './supervisor.js';

export interface ActiveMcpSession {
  txId: string;
  baseDir: string;
  shadow: ShadowWorktreeInstance;
  preVault: VaultState;
  initialActiveStatus: string[];
  config: InvarConfig;
  intent?: string;
}

export const activeMcpSessions = new Map<string, ActiveMcpSession>();

export async function handleBeginTransaction(args: {
  baseDir?: string;
  intent?: string;
  mode?: 'strict' | 'append-only';
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const baseDir = args.baseDir || process.cwd();
  const config = loadConfig(baseDir);
  if (args.mode) config.vault.mode = args.mode;

  const txId = `tx_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const initialActiveStatus = captureActiveTreeStatus(baseDir);

  try {
    const shadow = createShadowWorktree(baseDir, txId);
    const preVault = computeVaultState(shadow.shadowDir, config.vault.locked_paths);

    activeMcpSessions.set(txId, {
      txId,
      baseDir,
      shadow,
      preVault,
      initialActiveStatus,
      config,
      intent: args.intent,
    });

    const result = {
      txId,
      shadowDirectory: shadow.shadowDir,
      baseCommit: shadow.baseCommit,
      lockedFilesCount: preVault.fileCount,
      merkleRoot: preVault.rootHash,
      status: 'MOUNTED',
      instructions:
        'All code modifications must be performed inside shadowDirectory. When complete, invoke invar_verify_and_commit to verify anti-cheat integrity, run tests, validate AST invariants, and merge.',
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `Failed to begin transaction: ${err.message}` }],
      isError: true,
    };
  }
}

async function verifyAndCommitChecks(
  session: ActiveMcpSession
): Promise<{ passed: boolean; error?: string; status?: 'tampered' | 'test_failure' | 'ast_violation'; postVault?: VaultState }> {
  const { baseDir, shadow, preVault, initialActiveStatus, config } = session;

  const escapeCheck = detectActiveTreeEscape(
    baseDir,
    initialActiveStatus,
    config.artifacts?.ignore_escape
  );
  if (escapeCheck.escaped) {
    return {
      passed: false,
      status: 'tampered',
      error: `Agent escaped shadow sandbox: ${escapeCheck.unauthorizedModifications.join(', ')}`,
    };
  }

  const vaultCheck = verifyVaultIntegrity(shadow.shadowDir, preVault, config.vault.locked_paths, config.vault.mode);
  if (vaultCheck.tamperDetected) {
    return { passed: false, status: 'tampered', error: vaultCheck.error, postVault: vaultCheck.postVault };
  }

  if (config.project.test_runner) {
    const testResult = runLockedSuite(shadow.shadowDir, config.project.test_runner);
    if (!testResult.passed) {
      return {
        passed: false,
        status: 'test_failure',
        error: `Tests failed (exit code ${testResult.exitCode}):\n${testResult.stderr || testResult.stdout}`,
        postVault: vaultCheck.postVault,
      };
    }
  }

  const modified = getModifiedFiles(shadow.shadowDir, shadow.baseCommit);
  if (modified.length > 0) {
    const ast = evaluateAstInvariants(shadow.shadowDir, modified, config);
    if (!ast.passed) {
      return {
        passed: false,
        status: 'ast_violation',
        error: `AST violations:\n${ast.violations.join('\n')}`,
        postVault: vaultCheck.postVault,
      };
    }
  }

  return { passed: true, postVault: vaultCheck.postVault };
}

export async function handleVerifyAndCommit(args: {
  txId: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const session = activeMcpSessions.get(args.txId);
  if (!session) {
    return { content: [{ type: 'text', text: `No active transaction found with ID: ${args.txId}` }], isError: true };
  }

  const { baseDir, shadow, txId } = session;
  const check = await verifyAndCommitChecks(session);

  if (!check.passed) {
    const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
    const qPath = parkQuarantine(baseDir, txId, diff, check.status || 'tampered', check.error || 'Verification failed');
    destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
    activeMcpSessions.delete(txId);

    const failResult = { txId, status: 'QUARANTINED', success: false, error: check.error, quarantinePath: qPath };
    return { content: [{ type: 'text', text: JSON.stringify(failResult, null, 2) }], isError: true };
  }

  const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
  const merge = applyShadowDiffToActiveTree(baseDir, shadow.shadowDir, shadow.baseCommit, diff);
  destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
  activeMcpSessions.delete(txId);

  if (!merge.success) {
    return { content: [{ type: 'text', text: `Failed to commit diff: ${merge.error}` }], isError: true };
  }

  const commitResult = {
    txId,
    status: 'COMMITTED',
    success: true,
    diff: merge.diff,
    preVaultRoot: session.preVault.rootHash,
    postVaultRoot: check.postVault?.rootHash,
  };
  saveAuditLog(baseDir, commitResult as any, session.intent);

  return { content: [{ type: 'text', text: JSON.stringify(commitResult, null, 2) }] };
}

export async function handleRollback(args: {
  txId: string;
  parkDiff?: boolean;
  reason?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const session = activeMcpSessions.get(args.txId);
  if (!session) {
    return { content: [{ type: 'text', text: `No active transaction found with ID: ${args.txId}` }], isError: true };
  }

  const { baseDir, shadow, txId } = session;
  let qPath: string | undefined;

  if (args.parkDiff) {
    const diff = extractShadowDiff(baseDir, shadow.shadowDir, shadow.baseCommit);
    qPath = parkQuarantine(baseDir, txId, diff, 'user_aborted', args.reason || 'Manually rolled back by user/agent');
  }

  destroyShadowWorktree(baseDir, shadow.shadowDir, shadow.linkedJunctions);
  activeMcpSessions.delete(txId);

  const res = { txId, status: 'ROLLED_BACK', success: true, quarantinePath: qPath };
  return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
}

export function handleGetInvariants(args: {
  baseDir?: string;
}): { content: Array<{ type: 'text'; text: string }> } {
  const baseDir = args.baseDir || process.cwd();
  const config = loadConfig(baseDir);

  const res = {
    project: config.project,
    vault: config.vault,
    invariants: config.invariants,
  };

  return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
}

const INVAR_MCP_TOOLS = [
  {
    name: 'invar_begin_transaction',
    description: 'Mounts an isolated shadow worktree and cryptographically locks test suites. Returns shadow directory.',
    inputSchema: {
      type: 'object',
      properties: {
        baseDir: { type: 'string', description: 'Root directory of the Git repo.' },
        intent: { type: 'string', description: 'Brief description of the intended change.' },
        mode: { type: 'string', enum: ['strict', 'append-only'], description: 'Vault mode.' },
      },
    },
  },
  {
    name: 'invar_verify_and_commit',
    description: 'Verifies anti-cheat Merkle root, runs locked tests, checks AST rules, and commits atomically.',
    inputSchema: {
      type: 'object',
      properties: {
        txId: { type: 'string', description: 'Transaction ID to verify and commit.' },
      },
      required: ['txId'],
    },
  },
  {
    name: 'invar_rollback',
    description: 'Aborts a transaction and cleanly tears down the shadow worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        txId: { type: 'string', description: 'Transaction ID to abort.' },
        parkDiff: { type: 'boolean', description: 'Whether to preserve changes in quarantine.' },
        reason: { type: 'string', description: 'Reason for aborting.' },
      },
      required: ['txId'],
    },
  },
  {
    name: 'invar_get_invariants',
    description: 'Retrieves active project architectural invariants, boundary rules, and complexity limits.',
    inputSchema: {
      type: 'object',
      properties: {
        baseDir: { type: 'string', description: 'Root directory of the Git repo.' },
      },
    },
  },
  {
    name: 'invar_validate_incremental',
    description: 'Performs fast (<50ms) incremental validation of AST complexity, boundary rules, and test preservation on the active shadow worktree. Returns structured diagnostics to self-heal code before requesting final commit.',
    inputSchema: {
      type: 'object',
      properties: {
        txId: { type: 'string', description: 'Active transaction ID to incrementally validate.' },
      },
      required: ['txId'],
    },
  },
];

export function createInvarMcpServer(defaultBaseDir?: string): Server {
  const server = new Server(
    { name: 'invar', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: INVAR_MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const normalizedArgs = { baseDir: defaultBaseDir, ...(args || {}) };

    if (name === 'invar_begin_transaction') return handleBeginTransaction(normalizedArgs);
    if (name === 'invar_verify_and_commit') return handleVerifyAndCommit(normalizedArgs as any);
    if (name === 'invar_rollback') return handleRollback(normalizedArgs as any);
    if (name === 'invar_get_invariants') return handleGetInvariants(normalizedArgs);
    if (name === 'invar_validate_incremental') {
      const txId = (normalizedArgs as any).txId;
      const session = activeMcpSessions.get(txId);
      if (!session) {
        return { content: [{ type: 'text', text: `No active transaction found with ID: ${txId}` }], isError: true };
      }
      return handleValidateIncremental(session);
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  });

  return server;
}

export async function startMcpServer(baseDir?: string): Promise<void> {
  const server = createInvarMcpServer(baseDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
