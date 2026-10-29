export type VaultMode = 'strict' | 'append-only';

export interface BoundaryRule {
  source: string;
  cannot_import: string[];
}

export interface InvarConfig {
  project: {
    name: string;
    test_runner?: string;
  };
  vault: {
    mode: VaultMode;
    locked_paths: string[];
  };
  shadow: {
    quarantine_on_failure: boolean;
    max_retries: number;
    windows_junctions: boolean;
  };
  invariants: {
    max_cyclomatic_complexity?: number;
    max_function_lines?: number;
    ban_duplicate_symbols?: boolean;
    boundaries?: BoundaryRule[];
  };
}

export interface FileHashManifest {
  [relativePath: string]: string;
}

export interface VaultState {
  rootHash: string;
  manifest: FileHashManifest;
  lockedAt: string;
  fileCount: number;
}

export type TransactionStatus =
  | 'INIT'
  | 'MOUNTED'
  | 'LOCKED'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMMITTED'
  | 'ROLLED_BACK'
  | 'QUARANTINED';

export interface TestExecutionResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TransactionResult {
  txId: string;
  status: TransactionStatus;
  success: boolean;
  error?: string;
  preVaultRoot: string;
  postVaultRoot?: string;
  testResult?: TestExecutionResult;
  diff?: string;
  quarantinePath?: string;
}
