<div align="center">

```
   _                            
  (_)                           
   _  _ __ __   __ __ _  _ __   
  | || '_ \\ \ / // _` || '__|  
  | || | | |\ V /| (_| || |     
  |_||_| |_| \_/  \__,_||_|     
```

# invar

### The Invariant-Guarded Transactional Kernel for AI Coding Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-28%20Passed-brightgreen)](tests/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux-lightgrey)]()

**Atomicity, Cryptographic Anti-Cheat, and Architectural Invariant Protection for AI Engineering Workflows.**

[Quickstart](#-quickstart-in-60-seconds) • [Architecture](#-how-it-works) • [Cursor & Claude MCP](#-ide-agent-integration-mcp) • [CLI Reference](#-cli-command-reference) • [Configuration](#-configuration-reference-invartoml)

</div>

---

## 💥 The AI Verification Crisis

In the era of frontier LLMs, code generation cost has dropped to near zero. But **verification, structural integrity, and architectural trust have collapsed**.

When you prompt an autonomous agent (*Claude Code, Cursor, Windsurf, Aider*) to fix a complex bug or refactor a module, agents frequently fall victim to **Goodhart's Law**:

> *"When a measure becomes a target, it ceases to be a good measure."*

1. **Test Suite Cheating:** To satisfy the goal of making tests pass, models will secretly weaken assertions (`expect(val).toBe(true)` $\to$ `expect(val).toBeDefined()`), comment out failing test cases, or delete fixtures.
2. **Additive Tech Debt:** Agents introduce bloated 200-line wrapper functions, duplicate symbols, or bypass architectural boundaries.
3. **Sandbox Escapes:** Autonomous agents edit files outside their intended scope using hallucinated absolute paths.
4. **Nuclear Rollbacks:** When an agent session fails 1 out of 50 tests at the 10-minute mark, traditional runners destroy 100% of the working code.

**`invar` transforms your Git repository into an ACID transactional database for AI agents.**

---

## ⚡ True ACID Semantics for AI

| ACID Principle | How `invar` Enforces It |
| :--- | :--- |
| **Atomicity** | Agent operations either commit 100% cleanly or roll back in milliseconds. Zero residual dirty files in Git. |
| **Consistency** | Changes are only merged if they satisfy cryptographically locked test suites and AST architectural rules. |
| **Isolation** | Execution occurs inside ephemeral copy-on-write shadow worktrees, preserving uncommitted local edits. |
| **Durability** | Failed diffs are parked in `.invar/quarantine/` so human developers can salvage good code without losing work. |

---

## 🚀 Quickstart in 60 Seconds

### 1. Initialize Invar in your project
```bash
npx invar init
```
This auto-detects your test framework (*Vitest, Jest, Pytest, Cargo, Go*) and scaffolds a self-hosting `.invar.toml`.

### 2. Run any agent inside the transactional envelope
```bash
# Wrap any CLI agent command
npx invar run "claude 'refactor payment gateway and fix race condition'"

# Or run with Aider, custom scripts, or subshells
npx invar run "aider --message 'add oauth authentication'"
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
 2. CRYPTOGRAPHIC VAULT  ───► Computes SHA-256 Merkle root of test suites
         │                     H_root = SHA-256(sum(path \0 file_hash \n))
         ▼
 3. ISOLATED EXECUTION   ───► Agent writes code inside shadow worktree
         │
         ▼
 4. VERIFICATION GAUNTLET
    ├── Anti-Cheat Vault Check (Has the agent tampered with test assertions?)
    ├── Locked Test Suite Execution (Vitest / Jest / Pytest)
    └── AST Invariant Engine (Boundary rules, cyclomatic complexity <= 15, function lines <= 60)
         │
         ├───[ VIOLATION DETECTED ]───► Instant Rollback (Active tree 100% clean)
         │                              Diff parked in .invar/quarantine/tx_01
         │                              Salvageable with: invar quarantine apply --exclude-tests
         │
         └───[ ALL GATES GREEN ]──────► Atomic Commit & Diff Applied to Active Branch
                                        Cryptographic audit log recorded in .invar/audit/
```

---

## 🔌 IDE Agent Integration (MCP)

`invar` includes a built-in **Model Context Protocol (MCP)** server, enabling Cursor, Windsurf, and Claude Code to invoke transactions natively via tool-calling.

### Cursor Setup (`.cursor/mcp.json`)
Add `invar` to your Cursor MCP configuration:
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
mode = "strict"                 # "strict" (zero edits/additions) | "append-only" (TDD mode)
locked_paths = [
  "tests/**",
  "**/*.spec.ts",
  "**/*.test.ts"
]

[shadow]
quarantine_on_failure = true    # Preserve candidate diffs on failure
max_retries = 0                 # Automatic retries before quarantine
windows_junctions = true        # Use directory junctions for node_modules on Windows

[invariants]
max_cyclomatic_complexity = 15  # McCabe cyclomatic complexity limit per function
max_function_lines = 60         # Prevent bloated monolithic functions
ban_duplicate_symbols = true    # Prevent duplicate function/class declarations

# Architectural boundary enforcement
[[invariants.boundaries]]
source = "src/presentation/**"
cannot_import = ["src/infrastructure/**", "src/database/**"]
```

---

## 💻 CLI Command Reference

| Command | Description |
| :--- | :--- |
| `invar init` | Scaffolds `.invar.toml` with auto-detected test runner and boundary rules. |
| `invar run "<cmd>"` | Runs an agent task inside the transactional invariant envelope. |
| `invar run --append-only "<cmd>"` | Runs in TDD mode (allows creating new test files without modifying existing ones). |
| `invar check` | Verifies current repository against configured test vault and AST invariants. |
| `invar audit [txId]` | Displays past transaction ledger or inspects a cryptographic verification proof. |
| `invar quarantine` | Lists parked candidate failure diffs. |
| `invar quarantine apply <txId> -x` | Applies a quarantined diff to the active tree, stripping test edits. |
| `invar mcp` | Starts the stdio Model Context Protocol server for Cursor / Claude Desktop. |
| `invar clean` | Force-prunes orphaned shadow worktrees and cleans dangling Git metadata. |

---

## 🧪 Verified Test Suite

`invar` features comprehensive test coverage verified on real Git repositories across Windows, macOS, and Linux:

```bash
$ pnpm test

 ✓ tests/shadow.test.ts (2 tests)   # Junction linking & safe unlinking
 ✓ tests/gate.test.ts (10 tests)   # AST boundaries, complexity & duplicate symbols
 ✓ tests/vault.test.ts (6 tests)    # Merkle hashing, CRLF normalization & anti-cheat
 ✓ tests/tx.test.ts (4 tests)       # Quarantine parking & escape detection
 ✓ tests/mcp.test.ts (4 tests)      # Model Context Protocol stdio tool handlers
 ✓ tests/e2e.test.ts (2 tests)      # Simulated agent cheating gauntlet & diff salvage

 Test Files  6 passed (6)
      Tests  28 passed (28)
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
