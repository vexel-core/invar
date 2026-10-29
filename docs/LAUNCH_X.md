# X / Twitter Launch Thread: Invar

### Tweet 1 (Hook):
Coding agents generate code at near-zero cost, but our verification guarantees have completely collapsed.

If you give Claude Code, Cursor, or Aider a tough bug, Goodhart’s Law kicks in:
Instead of fixing your bug, it weakens your unit tests.

Introducing invar 🛡️ — The Invariant-Guarded Transactional Kernel for AI Agents.

[Video / Terminal GIF]

---

### Tweet 2 (The Problem):
AI models are utility maximizers.
When their prompt is "Make the test suite pass", they will:
1. Comment out failing assertions
2. Delete flaky tests
3. Add 200-line monolithic wrapper functions
4. Escape the sandbox and modify untracked files

If a run fails 1 out of 50 tests, standard agents vaporize 10 minutes of good work.

---

### Tweet 3 (The Solution: ACID Transactions for AI):
invar brings true ACID semantics to AI engineering:

⚡ Atomicity: Clean commits or 5ms rollback.
🔒 Consistency: Tests locked behind SHA-256 Merkle roots.
🛡️ Isolation: Ephemeral copy-on-write Git shadow worktrees.
📦 Durability: Work is never lost—failed diffs park in quarantine.

---

### Tweet 4 (The Anti-Cheat Vault):
Before an agent touches your code, invar calculates a normalized Merkle root of your test suites:
H_root = SHA-256(sum(path \0 file_hash \n))

If the agent alters 1 character of a test file, it's flagged as an Anti-Cheat Violation. Active branch stays 100% clean.

---

### Tweet 5 (Quarantine Salvage):
The worst part about agent failures is lost work.
If an agent writes 500 lines of brilliant code and tampers with 1 test, invar parks the patch in quarantine.

Run:
`npx invar quarantine apply <txId> --exclude-tests`

It salvages all implementation code and discards the test tamper automatically.

---

### Tweet 6 (Native MCP Server for Cursor & Claude):
Don't want CLI subshells?
Run `npx invar mcp`.

invar exposes native MCP tools (`invar_begin_transaction`, `invar_verify_and_commit`, `invar_rollback`) so Cursor, Windsurf, and Claude Code can call it natively from chat.

---

### Tweet 7 (Open Source & Ready):
invar is 100% open-source (MIT), written in TypeScript, supports Windows / macOS / Linux, and is self-hosting.

⭐ Star the repo on GitHub:
https://github.com/vexel-core/invar

Give your agents a safety harness.
