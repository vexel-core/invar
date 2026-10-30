<div align="center">

```
   _                            
  (_)                           
   _  _ __ __   __ __ _  _ __   
  | || '_ \\ \ / // _` || '__|  
  | || | | |\ V /| (_| || |     
  |_||_| |_| \_/  \__,_||_|     
```

# invar (v2.0)

### The Invariant-Guarded Transactional Kernel for AI Coding Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-75%20Passed-brightgreen)](tests/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux-lightgrey)]()

**Atomicity, Semantic AST Anti-Cheat, Micro-Mutation Proving, and Architectural Invariant Protection for AI Engineering Workflows.**

[Quickstart](#-quickstart-in-60-seconds) • [Architecture](#-how-it-works) • [v2.0 Breakthroughs](#-v20-core-innovations) • [IDE MCP Supervisor](#-ide-agent-integration-mcp) • [CLI Reference](#-cli-command-reference) • [Configuration](#-configuration-reference-invartoml)

</div>

---

## 💥 The AI Verification Crisis & The Rigidity Paradox

In the era of frontier LLMs, code generation cost has dropped to near zero. But **verification, structural integrity, and architectural trust have collapsed**.

When autonomous agents (*Claude Code, Cursor, Windsurf, Aider*) are tasked with solving non-trivial problems, two fundamental failure modes emerge:

### 1. Goodhart's Law (Agent Cheating)
> *"When a measure becomes a target, it ceases to be a good measure."*
* **Assertion Downgrading:** To make a test suite pass, agents silently weaken assertions (`expect(val).toBe(true)` $\to$ `expect(val).toBeDefined()`), delete failing test cases, or hollow out test fixtures.
* **Placebo Tests:** Agents generate hollow tests (`expect(true).toBe(true)`) that pass trivially without testing actual runtime logic.
* **Additive Tech Debt:** Agents introduce monolithic 200-line wrapper functions, duplicate symbol definitions, or violate modular boundary rules.
* **Nuclear Rollbacks:** When an agent session fails 1 out of 50 tests at the 10-minute mark, traditional tools destroy 100% of the working code.

### 2. The Rigidity Paradox (The False-Positive Trap)
If verification tooling is too blunt—relying on dumb file-level SHA-256 byte hashing—it suffocates real engineering. In real projects, developers and agents *must* legitimately add new test cases into existing test files, intentionally evolve APIs and contracts, and generate database migrations. If a safety tool flags every legitimate test addition or API change as malicious cheating, developers will uninstall it immediately.

**`invar` transforms your Git repository into an ACID transactional database for AI agents, pairing cryptographic isolation with semantic AST differentiation.**

---

## ⚡ True ACID Semantics for AI

| ACID Principle | How `invar` Enforces It |
| :--- | :--- |
| **Atomicity** | Agent operations either commit 100% cleanly or roll back in milliseconds. Zero residual dirty files in Git. |
| **Semantic Consistency** | Distinguishes between malicious cheating (weakening assertions) and legitimate evolution (adding tests, intentional contract evolution). |
| **Isolation** | Execution occurs inside ephemeral copy-on-write shadow worktrees, preserving uncommitted local edits via `git stash create`. |
| **Durability** | Failed diffs are parked in `.invar/quarantine/` with a manifest so human developers can salvage good code without losing work. |

---

## 🚀 Quickstart in 60 Seconds

### 1. Initialize Invar in your project
```bash
npx invar init
```
This auto-detects your test framework (*Vitest, Jest, Pytest, Cargo, Go*) and scaffolds a self-hosting `.invar.toml`.

### 2. Run any agent inside the transactional envelope
```bash
# Feature task: allows adding new tests inside existing files, proves tests with mutation testing
npx invar run "claude 'add coupon validation and unit tests'" --profile feature

# Bugfix task: strictly locks all existing tests and exports
npx invar run "cursor-agent 'fix payment race condition'" --profile bugfix

# Contract migration task: permits breaking changes and produces an assertion transition matrix
npx invar run "aider 'migrate auth tokens to jwt'" --profile contract-migration
```

### 3. Check repository integrity anytime
```bash
npx invar check
```

---

## 🧠 How It Works

```
Developer / Agent Prompt
         │
         ▼
 1. SNAPSHOT & ISOLATION ───► git stash create (captures dirty uncommitted state)
         │                     Mounts ephemeral shadow worktree (.invar/shadow/tx_01)
         │                     Links node_modules with directory junctions (no admin needed)
         ▼
 2. SEMANTIC AST BASELINE ──► Parses test files into AST test block trees
         │                     Records pre-run test blocks and assertion graphs
         ▼
 3. INTERACTIVE EXECUTION ──► Agent writes code inside shadow worktree
         │                     (Calls invar_validate_incremental for <50ms live self-healing)
         ▼
 4. MULTI-TIER VERIFICATION GAUNTLET
    ├── Semantic Assertion Diff Check (Detects assertion weakening or deletions)
    ├── Locked Test Runner (Vitest / Jest / Pytest)
    ├── Targeted Micro-Mutation Prover (TIMM) (Proves new tests kill code mutants)
    ├── Active Tree Sandbox Escape Monitor (Ignores dist/, .next/, compiler caches)
    └── AST Invariant Engine (Boundary rules, complexity <= 15, function lines <= 60)
         │
         ├───[ VIOLATION DETECTED ]───► Instant Rollback (Active tree 100% clean)
         │                              Diff parked in .invar/quarantine/tx_01
         │                              Salvageable with: invar quarantine apply --exclude-tests
         │
         └───[ ALL GATES GREEN ]──────► Atomic Commit & Diff Applied to Active Branch
                                        Cryptographic audit log recorded in .invar/audit/
```

---

## 🛡️ v2.0 Core Innovations

### 1. Semantic AST Test Fingerprinting & Anti-Weakening Differential
Instead of dumb byte-level hashing, `invar` parses test files into TypeScript AST block trees (`describe`, `it`, `test`).
* **Additive Test Cases Approved:** Agents can freely append new `it()` / `test()` blocks into existing test files under the `feature` profile.
* **Assertion Downgrade Interception:** If an agent attempts to change `expect(res.status).toBe(200)` into `expect(res.status).toBeDefined()`, `invar` calculates the semantic assertion differential, catches the downgrade in the matcher lattice, and aborts the transaction immediately.
* **Tautological Placebo Rejection:** Traps hollow assertions like `expect(true).toBe(true)` or `expect(1).toBe(1)`.

### 2. Targeted In-Memory Micro-Mutation Prover (TIMM)
How do you know an agent's newly written test isn't a placebo that passes regardless of bugs?
`invar` introduces **TIMM**:
1. Analyzes the unified diff of the agent's code modifications.
2. Injects targeted in-memory micro-mutations on modified lines:
   * **ROR (Relational Operator Replacement):** `===` $\to$ `!==`, `>` $\to$ `<=`, `<` $\to$ `>=`
   * **LCR (Logical Connector Replacement):** `&&` $\to$ `||`, `||` $\to$ `&&`
3. Runs the test suite against the mutant in memory.
4. If the mutant survives (all tests still pass), the test is rejected as a **placebo test** and quarantined.

### 3. Task-Aware Invariant Profiles
Not all agent tasks have the same verification contract:

| Profile | Test Additions | Test Modifications | Mutation Prover | Use Case |
| :--- | :---: | :---: | :---: | :--- |
| `bugfix` | ❌ Disallowed | ❌ Disallowed | ❌ Skipped | Fixing bugs without touching test suites or public APIs. |
| `feature` | ✅ Allowed | ❌ Disallowed | ✅ Enforced | Adding new functionality & load-bearing tests. |
| `refactor` | ❌ Disallowed | ❌ Disallowed | ❌ Skipped | Internal cleanup; freezes public exports and assertions. |
| `contract-migration` | ✅ Allowed | ✅ Allowed | ❌ Skipped | Intentional breaking changes with Assertion Transition Matrix. |

### 4. Live Interactive MCP Supervisor (`invar_validate_incremental`)
Traditional transaction runners are post-mortem: an agent finishes a 15-minute multi-step edit, commits, and gets completely rolled back because it wrote a function with cyclomatic complexity 16.
With `invar_validate_incremental`:
* Cursor and Claude Code call the supervisor tool **during** their turn.
* Sub-50ms incremental checks analyze complexity, line counts, boundary rules, symbol collisions, and test preservation on the fly.
* Returns structured diagnostics (`file`, `line`, `message`, `suggestion`) directly in the agent's context window, allowing the agent to refactor and self-heal before requesting final commit.

### 5. Monorepo & Artifact Path Classification
Fullstack apps and monorepos generate compiler caches, build artifacts, and client code (`dist/`, `.next/`, `coverage/`, `.turbo/`, Prisma client).
`invar` incorporates configurable `[artifacts]` path rules with `dot: true` minimatch resolution, allowing compiler caches to build freely while strictly intercepting real active-tree sandbox escapes.

---

## 🔌 IDE Agent Integration (MCP)

`invar` includes a built-in **Model Context Protocol (MCP)** server, enabling Cursor, Windsurf, and Claude Code to invoke transactions natively via tool-calling.

### Cursor Setup (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "invar": {
      "command": "npx",
      "args": ["invar", "mcp"]
    }
  }
}
```

### Claude Desktop Setup (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "invar": {
      "command": "npx",
      "args": ["invar", "mcp"]
    }
  }
}
```

### Exposed Native Tools:
* `invar_begin_transaction`: Mounts shadow worktree, locks test suites, returns isolated working directory.
* `invar_validate_incremental`: Fast ($<50\text{ms}$) incremental AST, boundary, and test preservation check for interactive self-healing.
* `invar_verify_and_commit`: Executes anti-cheat verification, locked tests, and AST checks; commits if green.
* `invar_rollback`: Manually aborts the transaction and tears down the shadow worktree.
* `invar_get_invariants`: Returns the project's active architectural constraints in structured JSON.

---

## 📦 Developer Quarantine & Salvage

When an agent writes 500 lines of brilliant implementation code but modifies 1 line of a test assertion, `invar` flags the cheat, aborts the commit, and parks the candidate patch in `.invar/quarantine/<txId>/`.

You can inspect and salvage the good code with one command:

```bash
# List all quarantined transactions
npx invar quarantine

# Salvage implementation code while stripping out any test file modifications:
npx invar quarantine apply <txId> --exclude-tests
```

Your implementation files are updated, while your original locked test assertions remain 100% untouched.

---

## 🛠️ Configuration Reference (`.invar.toml`)

```toml
[project]
name = "my-application"
test_runner = "pnpm test"       # Auto-detected (Vitest, Jest, Pytest, Cargo, Go)

[vault]
mode = "strict"                 # "strict" (zero edits) | "append-only" | "semantic"
locked_paths = [
  "tests/**",
  "**/*.spec.ts",
  "**/*.test.ts"
]

[shadow]
quarantine_on_failure = true    # Preserve candidate diffs on failure
max_retries = 0                 # Automatic retries before quarantine
windows_junctions = true        # Use directory junctions for node_modules on Windows

[artifacts]
ignore_escape = [
  "dist/**",
  ".next/**",
  "coverage/**",
  "generated/**",
  "build/**",
  ".turbo/**"
]

[invariants]
max_cyclomatic_complexity = 15  # McCabe cyclomatic complexity limit per function
max_function_lines = 60         # Prevent bloated monolithic functions
ban_duplicate_symbols = true    # Prevent duplicate function/class declarations

# Architectural boundary enforcement
[[invariants.boundaries]]
source = "src/presentation/**"
cannot_import = ["src/infrastructure/**", "src/database/**"]

# Task-Aware Invariant Profiles
[profiles.bugfix]
allow_test_additions = false
allow_test_modifications = false
enforce_mutation_proof = false

[profiles.feature]
allow_test_additions = true
allow_test_modifications = false
enforce_mutation_proof = true

[profiles.refactor]
freeze_public_exports = true
allow_test_modifications = false

[profiles.contract-migration]
allow_test_modifications = true
require_assertion_diff_review = true
```

---

## 💻 CLI Command Reference

| Command | Description |
| :--- | :--- |
| `invar init` | Scaffolds `.invar.toml` with auto-detected test runner and boundary rules. |
| `invar run "<cmd>" [-p <profile>]` | Runs an agent task inside the transactional envelope (`bugfix`, `feature`, `refactor`, `contract-migration`). |
| `invar run -s "<cmd>"` | Forces strict vault mode (zero test modifications or additions permitted). |
| `invar run -a "<cmd>"` | Runs in append-only mode (allows creating new test files without modifying existing ones). |
| `invar check` | Verifies current repository against test vault, boundary rules, and AST invariants. |
| `invar audit [txId]` | Displays past transaction ledger or inspects a cryptographic verification proof. |
| `invar quarantine` | Lists parked candidate failure diffs. |
| `invar quarantine apply <txId> -x` | Applies a quarantined diff to the active tree, stripping test edits. |
| `invar mcp` | Starts the stdio Model Context Protocol server for Cursor / Claude Desktop. |
| `invar clean` | Force-prunes orphaned shadow worktrees and cleans dangling Git metadata. |

---

## 🧪 Verified Test Suite (75 / 75 Tests Passing)

`invar` features comprehensive test coverage verified on real Git repositories across Windows, macOS, and Linux:

```bash
$ pnpm test

 ✓ tests/tx.test.ts (4 tests)              # Quarantine parking, manifest integrity, escape checks
 ✓ tests/mutation-prover.test.ts (6 tests) # Micro-mutation generation, mutant killing, placebo rejection
 ✓ tests/vault.test.ts (6 tests)           # Merkle root hashing, CRLF normalization, strict locking
 ✓ tests/escape.test.ts (13 tests)         # Monorepo artifacts (.next, dist, coverage), sandbox escape
 ✓ tests/gate.test.ts (10 tests)           # AST boundaries, complexity ceilings, duplicate symbols
 ✓ tests/semantic-test.test.ts (7 tests)   # Semantic AST test block parsing & same-file test additions
 ✓ tests/shadow.test.ts (2 tests)          # Directory junction linking & safe unlinking
 ✓ tests/assertion-diff.test.ts (10 tests) # Assertion lattice, weakening downgrade interception
 ✓ tests/e2e.test.ts (2 tests)             # Full agent cheating gauntlet & diff salvaging
 ✓ tests/mcp.test.ts (4 tests)             # MCP tools (begin, verify, rollback, get_invariants)
 ✓ tests/supervisor.test.ts (3 tests)      # Live incremental MCP supervisor & agent self-healing
 ✓ tests/profiles.test.ts (8 tests)        # Profiles (bugfix, feature, contract-migration) & transition matrix

 Test Files  12 passed (12)
      Tests  75 passed (75)
```

---

## 🤝 Contributing

Contributions are welcome!
1. Fork the repository
2. Create your feature branch (`git checkout -b feat/new-invariant`)
3. Ensure all tests and self-hosting checks pass (`pnpm test && npx invar check`)
4. Commit your changes (`git commit -m "feat: add invariant check"`)
5. Push to the branch (`git push origin feat/new-invariant`)
6. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
