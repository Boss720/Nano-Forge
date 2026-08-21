# Handoff Report: Security & Headless Execution Adversarial Challenge

**Document Version:** 1.0.0  
**Agent:** Challenger 2 (Security & Headless Execution Specialist)  
**Target Repository:** `nano-forge`  
**Review Target Documents:**
1. `docs/AUDIT_AND_GAP_ANALYSIS.md`
2. `docs/PRD_HEADLESS_CLI_TERMINAL.md`
3. `docs/E2E_VERIFICATION_PLAN.md`
4. `docs/PHASED_ROADMAP_AND_VERIFICATION.md`

---

## 1. Observation

Direct empirical observations, code citations, and test outputs gathered across the repository:

### Observation 1.1: PTY Child Process Leaks Full Host Environment Secrets
- **Location:** `docs/PRD_HEADLESS_CLI_TERMINAL.md:548`
- **Code Spec:**
  ```typescript
  const ptyProcess = pty.spawn(shell, options.args || [], {
    name: "xterm-256color",
    cols: options.cols || 80,
    rows: options.rows || 24,
    cwd,
    env: { ...process.env, ...options.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  ```
- **Contrast with Existing Backend:** In `apps/agent-host/src/terminal/runner.ts:165-175`, environment variables are scrubbed against `DEFAULT_ENV_ALLOWLIST` (`PATH`, `SystemRoot`, `TEMP`, `HOME`, `USERPROFILE`) to block secret exfiltration. In `apps/agent-host/src/mcp/client.ts:235`, `getDefaultEnvironment()` is used. The PTY specification in PRD Section 7.1 violates this core security invariant by spreading `...process.env` directly into child PTY sessions.

### Observation 1.2: Path Argument Traversal & Destructive Execution Under `--auto-approve=all`
- **Location:** `apps/agent-host/src/policy/policy.ts:127-167` and `docs/PRD_HEADLESS_CLI_TERMINAL.md:148, 624-627`
- **Code Invariant:**
  In `policy.ts:128`, `isWithinWorkspace` is ONLY evaluated against `req.cwd`.
  In `policy.ts:158-166`, `req.args` is evaluated strictly for shell metacharacters (`COMPOSITION_RE` and `REDIRECTION_RE`). There is **zero path validation on arguments**.
- **Execution Rule:** In `default-policy.json:27-75`, destructive tools (`rm`, `del`, `rmdir`, `curl`, `node`, `python`) are placed in `askExecutables`.
- **Flag Definition:** `PRD_HEADLESS_CLI_TERMINAL.md:148` defines `--auto-approve all` as: *"Auto-approves all non-denied tools up to configured token/cost budgets."*
- **Flawed Test Scenario:** `PRD_HEADLESS_CLI_TERMINAL.md:624-627` claims running `nanoforge run "rm -rf /" --auto-approve=safe` tests policy violation, but does not address what happens when an attacker passes `--auto-approve=all` or specifies paths in `args` (e.g. `rm -rf C:\Windows` or `git log ../../outside_repo`). Because `rm` is an `ask` executable, `--auto-approve=all` approves it blindly.

### Observation 1.3: In-Memory Volatility of SQLite Audit Hash Chain and Unchained Artifacts
- **Location:** `apps/agent-host/src/audit/store.ts:124, 181, 192-193, 223-234, 246`
- **Code State:**
  - Running digest is held purely in an in-memory Map: `private readonly digests = new Map<string, string>();`
  - In `startRun`: `this.digests.set(input.id, this.genesisDigest(input.id));`
  - In `recordEvent`: `this.digests.set(runId, sha256Hex(prev + sha256));`
  - In `endRun`: `UPDATE runs SET digest = ?` persists `this.digests.get(input.runId)` ONLY when `endRun()` is called cleanly.
  - In `recordArtifact`: Writes artifact files to disk and DB, but **never folds artifact sha256 into `this.digests`**.
  - `AuditStore` contains no `verifyRun()` / `verifyIntegrity()` method.

### Observation 1.4: Non-Interactive Headless Deadlock on Policy "Ask"
- **Location:** `docs/PRD_HEADLESS_CLI_TERMINAL.md:148`
- **Specification:** For `--auto-approve=none`, the PRD states: *"Requires manual socket confirmation for any ask tool."*
- **Headless Context:** In non-interactive CI/CD pipelines (e.g. GitHub Actions), standard input is not a TTY and no WebSocket client exists to respond to `tool.approval_required`. The specification does not mandate an immediate fail-closed exit (`EXIT_POLICY_VIOLATION` or `EXIT_AGENT_FAILURE`), causing headless tasks to stall until `--timeout` triggers (Exit Code 4), burning compute and CI execution minutes.

### Observation 1.5: CLI Flag Schema Inconsistency Across Documents
- `docs/PRD_HEADLESS_CLI_TERMINAL.md:148`: `-a, --auto-approve <none|safe|all>`
- `docs/PHASED_ROADMAP_AND_VERIFICATION.md:298`: `nanoforge run ... --yes --json`
- `docs/PHASED_ROADMAP_AND_VERIFICATION.md:533`: `Headless non-interactive policy validation (--yes)`
- `docs/E2E_VERIFICATION_PLAN.md:150`: `nanoforge run "<prompt>" --yes`

### Observation 1.6: Symlink & NTFS Junction Directory Traversal Gap
- **Location:** `apps/agent-host/src/policy/policy.ts:95-103`
- **Code:**
  ```typescript
  export function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
    const root = path.resolve(workspaceRoot);
    const resolved = path.resolve(root, candidate);
    const rel = path.relative(
      normalizeForCompare(root),
      normalizeForCompare(resolved),
    );
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }
  ```
- **Vulnerability:** `path.resolve()` performs lexical path resolution only. If a workspace contains a symlink or NTFS junction pointing to `C:\Windows` or `/etc`, `isWithinWorkspace` evaluates to `true` because it does not resolve the real filesystem path via `fs.realpathSync()`.

### Observation 1.7: Existing Test Baseline Failures
- **Command:** `npm test` (Frontend)
- **Result:** 18 test files passed (193 tests), 2 test files failed (7 tests failed):
  - `src/lib/__tests__/hostClient.test.ts`: 4 failures where client approval/control promises received full wire event payloads instead of expected `undefined`.
  - `src/sections/__tests__/IntegrationsPanel.test.tsx`: 3 failures (skill switch state, tampered hash button query, and secret reference text rendering).
- **Command:** `npm run test:host` (Backend)
- **Result:** 16 test files passed (158 tests).

---

## 2. Logic Chain

1. **Premise 1 (PTY Secret Leakage):** Based on Observation 1.1, `PtyManager` in `PRD_HEADLESS_CLI_TERMINAL.md:548` spawns the user/agent shell with `env: { ...process.env, ...options.env }`. Because host API keys (`OPENAI_API_KEY`, `NANOGPT_API_KEY`, `GITHUB_TOKEN`, cloud credentials) exist in `process.env`, any command executed in the terminal dock or via headless PTY has immediate read access to all host secrets. This directly contradicts the security claims in `AUDIT_AND_GAP_ANALYSIS.md` and breaks the isolation model.
2. **Premise 2 (Destructive Execution via Auto-Approve):** Based on Observation 1.2, `policy.ts` validates only `cwd` and command names, not target arguments. Because destructive tools (`rm`, `del`, `curl`) return `ask`, invoking `nanoforge run` with `--auto-approve=all` converts all `ask` decisions to `allow`. Consequently, an agent executing `rm -rf C:\` or `del /s /q /` under `--auto-approve=all` will wipe host directories without being blocked.
3. **Premise 3 (Audit Ledger Fragility):** Based on Observation 1.3, maintaining the SHA-256 digest chain in an in-memory `Map` means any process crash, kill signal, or power outage leaves `runs.digest` as `NULL`. When restarted, the ledger cannot resume the chain without recalculating from historical events. Furthermore, because artifacts are not folded into the digest chain, artifact payloads on disk can be modified without detecting tampering.
4. **Premise 4 (Headless Deadlock):** Based on Observation 1.4, when headless execution encounters an `ask` decision without `--auto-approve`, the absence of a headless fail-closed specification causes the process to hang waiting for an interactive socket message that will never arrive, leading to resource exhaustion.
5. **Premise 5 (Symlink Traversal):** Based on Observation 1.6, lexical path normalization in `isWithinWorkspace` permits symlink/junction breakout from the workspace root.
6. **Premise 6 (Specification Divergence):** Based on Observation 1.5, having conflicting CLI flag definitions (`--auto-approve <tier>` vs `--yes`) across the PRD, Roadmap, and E2E Plan creates integration defects and ambiguous security guarantees.

---

## 3. Caveats

- Hardware-accelerated WebGL rendering and ConPTY behaviors on legacy Windows operating systems (Windows 7/8 without OpenConsole/ConPTY) were evaluated architecturally, not on physical legacy hardware.
- The existing test failures in `npm test` reflect frontend UI/client mock regressions in the current branch and do not invalidate backend security logic in `apps/agent-host`.
- No caveats regarding the validity of the reported security findings.

---

## 4. Conclusion

### **VERDICT: REQUEST_CHANGES**

The documentation set (`AUDIT_AND_GAP_ANALYSIS.md`, `PRD_HEADLESS_CLI_TERMINAL.md`, `E2E_VERIFICATION_PLAN.md`, `PHASED_ROADMAP_AND_VERIFICATION.md`) presents a strong high-level vision, but contains **two CRITICAL and four HIGH-SEVERITY security and invariant flaws** that must be remediated before engineering execution begins.

### Required Changes:

1. **PTY Environment Sanitization (`PRD_HEADLESS_CLI_TERMINAL.md`):**
   - Update `PtyManager.createSession` (Section 7.1) to scrub `process.env` against `DEFAULT_ENV_ALLOWLIST` (or an explicit user-approved whitelist) instead of spreading `...process.env`.
   - Add secret redaction to the PTY ring buffer before streaming data over `terminal.data` frames.
2. **Headless Auto-Approve & Argument Policy Boundary (`PRD_HEADLESS_CLI_TERMINAL.md` & `policy.ts`):**
   - Explicitly define the behavior of `--auto-approve=safe`: it must ONLY auto-approve tools in `policy.readOnly` and verified workspace-confined file writes. Any tool in `askExecutables` (such as `rm`, `del`, `curl`, `kill`) MUST remain gated or require explicit flag escalation (`--allow-destructive`).
   - Mandate that `policy.ts` perform realpath argument scanning to verify that file arguments do not point outside `workspaceRoot`.
   - Mandate fail-closed non-interactive behavior: if a tool requires approval in headless mode and is not covered by the auto-approve policy, `nanoforge run` MUST terminate immediately with `EXIT_POLICY_VIOLATION` (Exit Code 2) or `EXIT_AGENT_FAILURE` (Exit Code 1) instead of hanging.
3. **CLI Flag Alignment across PRDs, Roadmap, and E2E Plan:**
   - Standardize CLI flags across all documents to use `--auto-approve <none|safe|all>` (with `--yes` documented as a deprecated alias for `--auto-approve=safe`).
4. **Tamper-Evident Audit Store Hardening (`audit/store.ts`):**
   - Persist the cumulative digest in the SQLite `events` table (e.g. `chain_digest TEXT`) with every event insert, eliminating reliance on volatile memory (`this.digests: Map`).
   - Fold artifact SHA-256 hashes into the cumulative digest chain upon creation.
   - Add an explicit `verifyRun(runId): boolean` verification method to `AuditStore`.
5. **Symlink Resolution in Policy Confinement (`policy.ts`):**
   - Update `isWithinWorkspace` to resolve symlinks and NTFS junctions using `fs.realpathSync` where the target path exists.
6. **E2E Verification Plan Additions (`E2E_VERIFICATION_PLAN.md`):**
   - Add negative test fixtures for argument path traversal (`git log ../../`, `rm -rf /`), symlink escapes, headless non-interactive timeout/fail-closed tests, and cross-subagent metadata isolation violations.

---

## 5. Verification Method

Independent verification of the observations and findings can be performed using the following steps:

1. **Verify PTY Environment Leakage in Spec:**
   Inspect `docs/PRD_HEADLESS_CLI_TERMINAL.md` at line 548. Confirm that `env: { ...process.env, ...options.env }` is specified.
2. **Verify Policy Argument Bypass:**
   Inspect `apps/agent-host/src/policy/policy.ts` at lines 128-167. Confirm that `isWithinWorkspace` is never invoked on elements of `req.args`.
3. **Verify SQLite Audit Memory Dependency:**
   Inspect `apps/agent-host/src/audit/store.ts` at lines 124, 181, 192, and 246. Confirm `this.digests` is an in-memory Map and is not stored per-event in the `events` table.
4. **Execute Current Test Baseline:**
   ```powershell
   # 1. Run protocol contract tests
   npm run test:protocol

   # 2. Run agent-host integration and policy tests
   npm run test:host

   # 3. Run frontend unit tests
   npm test
   ```
5. **Verify CLI Flag Inconsistencies:**
   Run grep across the `docs/` directory:
   ```powershell
   grep -rn "\-\-auto-approve" docs/
   grep -rn "\-\-yes" docs/
   ```

---
*End of Handoff Report.*
