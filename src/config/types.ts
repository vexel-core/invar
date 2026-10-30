export type VaultMode = 'strict' | 'append-only' | 'semantic';

export interface SemanticAssertion {
  matcher: string;
  line: number;
  targetExpr: string;
  expectedExpr?: string;
}

export interface SemanticTestBlock {
  id: string;
  name: string;
  kind: 'it' | 'test';
  suiteHierarchy: string[];
  line: number;
  assertions: SemanticAssertion[];
  bodyText?: string;
}

export interface SemanticFileAnalysis {
  filePath: string;
  blocks: SemanticTestBlock[];
}

export interface SemanticDiffResult {
  filePath: string;
  preservedBlocks: SemanticTestBlock[];
  addedBlocks: SemanticTestBlock[];
  removedBlocks: SemanticTestBlock[];
  modifiedBlocks: {
    blockId: string;
    pre: SemanticTestBlock;
    post: SemanticTestBlock;
    reason: string;
  }[];
  isValidAdditive: boolean;
  violations: string[];
}

export type MutationOperatorKind = 'ROR' | 'LCR' | 'RVM' | 'AOR';

export interface MicroMutant {
  id: string;
  filePath: string;
  line: number;
  operator: MutationOperatorKind;
  originalText: string;
  mutatedText: string;
  startPos: number;
  endPos: number;
}

export interface MutationProofResult {
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  isLoadBearing: boolean;
  mutants: {
    mutant: MicroMutant;
    killed: boolean;
    failureMessage?: string;
  }[];
  violations: string[];
}

export type TaskProfileName = 'bugfix' | 'feature' | 'refactor' | 'contract-migration';

export interface TaskProfileConfig {
  name: TaskProfileName;
  vault_mode: VaultMode;
  allow_test_additions: boolean;
  allow_test_modifications: boolean;
  enforce_mutation_proof: boolean;
  freeze_public_exports?: boolean;
  require_assertion_diff_review?: boolean;
}

export type TransitionEntryType =
  | 'UPGRADED'
  | 'DOWNGRADED'
  | 'VALUE_MODIFIED'
  | 'TARGET_MODIFIED'
  | 'DELETED'
  | 'ADDED';

export interface TransitionMatrixEntry {
  filePath: string;
  blockId: string;
  preAssertion: string;
  postAssertion: string;
  preStrength: number;
  postStrength: number;
  type: TransitionEntryType;
}

export interface AssertionTransitionMatrix {
  entries: TransitionMatrixEntry[];
  hasBreakingChanges: boolean;
  summary: string;
}

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
  profiles?: Partial<Record<TaskProfileName, Partial<TaskProfileConfig>>>;
}

export interface FileHashManifest {
  [relativePath: string]: string;
}

export interface VaultState {
  rootHash: string;
  manifest: FileHashManifest;
  lockedAt: string;
  fileCount: number;
  semanticSnapshots?: Record<string, SemanticTestBlock[]>;
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
  astViolations?: string[];
  diff?: string;
  quarantinePath?: string;
  activeProfile?: TaskProfileName;
  mutationProof?: MutationProofResult;
  transitionMatrix?: AssertionTransitionMatrix;
}
