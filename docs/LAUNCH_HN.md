# Show HN: Invar v2.0 — The Semantic Invariant & Transactional Kernel for AI Agents

**Link:** https://github.com/vexel-core/invar

Hey HN,

We're developers using Claude Code, Cursor, Windsurf, and Aider daily. While code generation cost has dropped to near zero, we ran face-first into what we call the **AI Verification Crisis & The Rigidity Paradox**:

### 1. Goodhart's Law (Agent Cheating)
When you give an autonomous agent a non-trivial prompt ("Fix the authentication token race condition and make tests pass"), models frequently succumb to Goodhart’s Law (*When a measure becomes a target, it ceases to be a good measure*):
- Agents silently weaken test assertions (`expect(val).toBe(true)` -> `expect(val).toBeDefined()`), delete failing test cases, or hollow out fixtures.
- They generate "placebo tests" (`expect(true).toBe(true)`) to claim high test coverage.
- When an agent session fails 1 out of 50 tests at the 10-minute mark, traditional runners execute a nuclear rollback—destroying 10 minutes of valid work over one failing test.

### 2. The Rigidity Paradox
If you solve this with dumb byte-level SHA-256 locking, you break real engineering: agents legitimately need to add new unit tests *inside* existing test files, evolve APIs and database schemas, and output build caches. If a tool flags every legitimate test addition or compiler cache as a malicious attack, developers uninstall it immediately.

---

### Enter Invar v2.0

`invar` transforms your Git repository into an **ACID transactional database** for AI coding agents, pairing cryptographic isolation with **AST-level semantic differentiation**:

1. **Isolation (Copy-on-Write Shadow Worktrees):**  
   Before the agent executes, `invar` calls `git stash create` (capturing your dirty uncommitted edits into a dangling commit SHA without resetting your active workspace) and mounts an ephemeral shadow worktree with NTFS directory junctions for `node_modules`. The agent never touches your active working tree.

2. **Semantic AST Test Fingerprinting:**  
   Instead of raw byte hashes, `invar` parses test files into TypeScript AST block trees (`describe`, `it`, `test`). Agents can freely add new test blocks into existing test files without triggering false-positive lock violations.

3. **Anti-Weakening Assertion Differential:**  
   `invar` computes a semantic assertion differential across a hierarchical matcher lattice. If an agent tries to downgrade an assertion from an Exact Matcher (`toBe`, `toEqual`) to an Existence Matcher (`toBeDefined`), `invar` intercepts the downgrade and aborts the transaction.

4. **Targeted Micro-Mutation Prover (TIMM):**  
   To prove newly added tests are not placebos, `invar` injects in-memory relational/logical mutations (ROR, LCR) into the agent's modified code lines. If the mutant survives (all tests still pass), the test is rejected as a non-assertive placebo.

5. **Task-Aware Invariant Profiles:**  
   Different tasks have different verification contracts:
   - `--profile bugfix`: Strictly freezes all existing tests and public exports.
   - `--profile feature`: Approves additive tests inside existing files and enforces mutation proofing.
   - `--profile refactor`: Freezes public signatures and assertions while allowing internal implementation refactoring.
   - `--profile contract-migration`: Permits intentional breaking changes and emits an Assertion Transition Matrix.

6. **Live Interactive MCP Supervisor (`invar_validate_incremental`):**  
   Cursor, Windsurf, and Claude Code can call the supervisor tool during their turn. Sub-50ms checks return structured diagnostics (`file`, `line`, `message`, `suggestion`) directly into the agent's context, allowing the agent to self-heal AST complexity or boundary violations *before* requesting final commit.

7. **Durability & Quarantine Salvage:**  
   When an agent writes 500 lines of brilliant implementation code but tampers with a test, `invar` aborts the commit and parks the patch in `.invar/quarantine/<txId>/`. With `npx invar quarantine apply <txId> --exclude-tests`, you can salvage all implementation code while stripping out the test tamper automatically.

---

### Tech Stack & Verification
- Written in strict TypeScript (ESM, CJS, `.d.ts`).
- 75 automated tests passing across 12 test files on real Git repositories on Windows, macOS, and Linux.
- 100% self-hosting: `invar` evaluates its own codebase against its own invariants (`max_function_lines <= 60`, `max_cyclomatic_complexity <= 15`, ban duplicate symbols, import boundaries).
- MIT Licensed.

GitHub: https://github.com/vexel-core/invar

We'd love your thoughts, feedback, and edge cases!
