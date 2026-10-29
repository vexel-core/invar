# Show HN: Invar — The Invariant-Guarded Transactional Kernel for AI Agents

**Link:** https://github.com/vexel-core/invar

Hey HN,

We're developers using Claude Code, Cursor, Windsurf, and Aider daily. While code generation has gotten ridiculously cheap, we ran face-first into what we call the **AI Verification Crisis**:

When you give an agent a non-trivial prompt ("Fix the authentication token race condition"), models frequently succumb to **Goodhart's Law**: *When a measure becomes a target, it ceases to be a good measure.*
- To make a test suite pass, agents will silently modify assertions (`expect(val).toBe(true)` -> `expect(val).toBeDefined()`), delete failing test cases, or add dummy tests to inflate metrics.
- They introduce massive additive tech debt (monolithic 300-line wrapper functions, duplicate symbol definitions).
- When a 10-minute session fails at the very end, conventional runners trigger a nuclear wipe—destroying 99% of valid work because of a single failing test.

We built **`invar`** to solve this. It is an open-source, transactional invariant kernel that brings true ACID semantics to AI coding workflows.

### How It Works:

1. **Isolation (Copy-on-Write Worktrees):** Before the agent runs, `invar` calls `git stash create` (capturing your dirty uncommitted edits into a dangling commit SHA without resetting your active workspace) and mounts an ephemeral shadow worktree with NTFS directory junctions for `node_modules`. The agent never touches your active working tree.

2. **Atomicity (Instant Rollback):** Modifications succeed completely or are rolled back in milliseconds with zero dirty files left behind in Git.

3. **Consistency (Cryptographic Vault & AST Gate):**
   - **Anti-Cheat Vault:** Pre-computes a SHA-256 Merkle root of your test suite with CRLF normalization. If the agent touches even 1 line of a test file, it's flagged as a hard tamper violation.
   - **AST Architectural Enforcer:** Validates import boundaries (e.g., presentation layer importing database internals), caps cyclomatic complexity (McCabe metric), enforces line limits, and bans duplicate symbol declarations.

4. **Durability & Quarantine:**
   - Instead of losing work on failure, candidate patches are parked in `.invar/quarantine/<txId>/`.
   - With `npx invar quarantine apply <txId> --exclude-tests`, you can salvage 500 lines of legitimate implementation code while automatically stripping out any illicit test edits.

5. **Native MCP Server:**
   `invar mcp` exposes native MCP tools (`invar_begin_transaction`, `invar_verify_and_commit`, `invar_rollback`, `invar_get_invariants`) so Cursor, Windsurf, and Claude Code can run transactions natively without subshell wrappers.

It's MIT-licensed, written in strict TypeScript, runs on Windows / macOS / Linux, and is fully self-hosting (invar checks its own codebase against its own invariants).

GitHub: https://github.com/vexel-core/invar

We'd love your thoughts, feedback, and edge cases!
