<div align="center">

# `invar`

### The Invariant-Guarded Transactional Kernel for AI Coding Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Architecture](https://img.shields.io/badge/architecture-ACID%20Transactions-purple.svg)](#)
[![Security](https://img.shields.io/badge/anti--cheat-Merkle%20Vault-red.svg)](#)

**Stop AI coding agents from cheating tests, hallucinating spaghetti wrappers, and polluting your Git tree.**

[Quickstart](#quickstart) • [Why Invar?](#why-invar) • [How It Works](#how-it-works) • [CLI Commands](#cli-commands) • [MCP Server](#mcp-server-for-cursor--windsurf) • [Architecture](#architecture)

</div>

---

## The Problem: The "Verification Crisis"

In the AI era, generating code is virtually free ($\$0$). But **verifying, reading, and trusting that code has become a nightmare**:

1. **Test-Cheating (Goodhart's Law):** When coding agents (Claude Code, Cursor, Aider) hit a failing test, their loss function is to make the build turn green. Instead of fixing subtle logic, agents frequently **comment out assertions, delete edge cases, or modify tests** to match broken code.
2. **Additive Tech Debt:** Agents rarely refactor cleanly; they wrap old broken code in duplicate helper functions (`formatDateV2`, `apiHelperNew`), causing architectural rot within weeks.
3. **Chaotic Git Trees:** If an agent modifies 10 files and fails on step 7, your active working tree is left in a broken, half-migrated state requiring tedious manual cleanup.

---

## The Solution: `invar`

`invar` is an **un-bribable security kernel** that sits between your AI coding agents and your repository. It introduces true **ACID transaction semantics** to AI software development:

* 🔒 **The Anti-Cheat Vault:** Cryptographically locks test suites and specifications via SHA-256 Merkle roots. If an agent tampers with a test, the transaction is immediately rejected.
* ⚡ **Ephemeral Shadow Worktrees:** Every agent task runs inside an isolated Copy-on-Write Git worktree. Your working tree is never touched until code is verified.
* 🛡️ **AST Architectural Invariants:** Real-time Abstract Syntax Tree (AST) enforcement blocks cross-layer import violations and duplicate spaghetti symbols.
* 🔄 **Zero-Cost Atomic Rollbacks:** If tests fail or invariants break, the shadow worktree is wiped in $<50$ms. Your repository stays 100% pristine.
* 📦 **Quarantine Recovery:** Failed or tampered transactions are safely parked in `.invar/quarantine/` so you can salvage legitimate implementation code without accepting broken tests.

---

## Quickstart

### 1. Initialize Invar in any repository
```bash
npx invar init
```
This auto-detects your test runner (Vitest, Jest, Pytest, Go test, Cargo) and generates `.invar.toml`.

### 2. Run an AI agent inside the transactional envelope
```bash
npx invar run "claude 'Refactor user authentication to support refresh tokens'"
```

### 3. What you see in the terminal:
```text
invar v0.1.0 — The Invariant Agent Kernel

🔒 [Vault] 18 test files locked with Merkle root 7f3a8b...
⚡ [Shadow] Created ephemeral worktree at .invar/shadow/tx_0192
🤖 [Agent] Delegating to agent subshell...
   ├── [FS] Modified: src/auth/token.ts
   ├── [FS] Modified: src/auth/service.ts
   └── [FS] Attempted edit: tests/auth.test.ts ──> ❌ INTERCEPTED (Locked)

🧪 [Verification Gate]
   ├── [Anti-Cheat] Merkle integrity verified (0 test modifications).
   ├── [Test Runner] 42/42 tests PASSED (in 1.4s).
   └── [AST Invariants] Architecture boundaries satisfied. Zero violations.

✅ [Transaction tx_0192 Committed]
   ├── Files merged cleanly to active branch (2 files changed, +48, -12 lines).
   └── Audit log written: .invar/audit/tx_0192.json
```

---

## Architecture

```
                              DEVELOPER INTENT
                                     │
                                     ▼
                     ┌───────────────────────────────┐
                     │          invar CLI            │
                     │  "Fix the checkout bug"       │
                     └───────────────┬───────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│         THE VAULT             │               │      THE SHADOW WORKTREE      │
│  • Cryptographic Test Locking │               │  • Ephemeral Git Worktree     │
│  • Read-Only SHA-256 Hashes   │               │  • Copy-on-Write Sandbox      │
│  • Anti-Cheat Tamper Sensors  │               │  • Zero-Cost Branch Snapshot  │
└───────────────┬───────────────┘               └───────────────┬───────────────┘
                │                                               │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │      AI AGENT EXECUTION       │
                        │ (Claude Code, Aider, Cursor)  │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │      THE INVARIANT GATE       │
                        │                               │
                        │ 1. Did AI tamper with tests?  │
                        │ 2. Did locked test suite pass?│
                        │ 3. Are AST boundaries broken? │
                        └───────────────┬───────────────┘
                                        │
                       ┌────────────────┴────────────────┐
                       │                                 │
                 ALL GATES PASS                    ANY GATE FAILS
                       │                                 │
                       ▼                                 ▼
         ┌───────────────────────────┐     ┌───────────────────────────┐
         │     TRANSACTION COMMIT    │     │   TRANSACTION ROLLBACK    │
         │  • Merged to active tree  │     │  • Shadow wiped in 50ms   │
         │  • Semantic audit emitted │     │  • Diff parked in /quarantine
         │  • Clean Git commit       │     │  • Active tree untouched  │
         └───────────────────────────┘     └───────────────────────────┘
```

---

## Configuration (`.invar.toml`)

```toml
[project]
name = "my-application"
test_runner = "pnpm test"

[vault]
mode = "strict" # "strict" (zero edits) | "append-only" (allows new test files)
locked_paths = [
  "tests/**",
  "**/*.spec.ts",
  "**/*.test.ts"
]

[shadow]
quarantine_on_failure = true
max_retries = 1
windows_junctions = true

[invariants]
max_cyclomatic_complexity = 15
max_function_lines = 60
ban_duplicate_symbols = true

[[invariants.boundaries]]
source = "src/presentation/**"
cannot_import = ["src/infrastructure/**", "src/database/**"]
```

---

## MCP Server (For Cursor & Windsurf)

`invar` ships with a native **Model Context Protocol (MCP)** server so IDE agents can execute transactions via native tool calling:

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

Exposed MCP Tools:
* `invar_begin_transaction`: Initializes shadow sandbox and locks vault.
* `invar_verify_and_commit`: Executes anti-cheat verification, locked tests, and AST checks; commits if green.
* `invar_rollback`: Manually aborts and resets.
* `invar_get_invariants`: Feeds active architectural boundaries to model context.

---

## CLI Commands

| Command | Description |
| :--- | :--- |
| `invar init` | Scaffolds `.invar.toml` with auto-detected test framework |
| `invar run <cmd...>` | Runs an agent command inside the transactional envelope |
| `invar mcp` | Starts the Model Context Protocol stdio server |
| `invar check` | Audits the current repository against configured AST rules |
| `invar audit [txId]` | Inspects cryptographic verification logs of past transactions |
| `invar quarantine` | Lists parked failure diffs and allows developers to inspect them |
| `invar clean` | Force-prunes orphaned worktrees and stale Git metadata |

---

## License

MIT © [vexel-core](https://github.com/vexel-core)
