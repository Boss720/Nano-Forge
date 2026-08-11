/**
 * Policy engine — Module 2, Task 5.
 *
 * Model output is only ever a *proposal*: every tool request must pass
 * `authorize()` before the runner is allowed to spawn anything.
 *
 * Locked-down defaults (see default-policy.json):
 * - cwd must resolve inside `policy.workspaceRoot`, otherwise **deny**;
 * - free-form shells (cmd, powershell, bash, sh, ...) and shell composition
 *   (`|`, `&&`, `;`, backticks, `$(...)`) are **denied**;
 * - whitelisted read-only executables (git status/log/diff..., ls, dir,
 *   node --version) are **allowed**;
 * - writes, network access, installs, termination, redirection (`>`/`<`),
 *   and anything unknown are **ask** (interactive approval).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------------ */
/* Request / decision types                                                 */
/* ------------------------------------------------------------------------ */

/** Terminal execution proposal (structured: no shell interpolation). */
export interface TerminalExecToolRequest {
  kind: "terminal.exec";
  cwd: string;
  executable: string;
  args: string[];
}

/**
 * Extensible union of tool proposals. Later kinds (browser.*, mcp.call) are
 * added here as their modules land; unknown kinds are denied by default.
 */
export type ToolRequest = TerminalExecToolRequest;

export type PolicyDecision = "allow" | "ask" | "deny";

/* ------------------------------------------------------------------------ */
/* Policy document                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Whitelisted read-only invocation. When `firstArgs` is present, only calls
 * whose first argument matches one of the listed subcommands/flags
 * auto-allow (e.g. `git` + `["status","log","diff"]`, `node` +
 * `["--version"]`). Without `firstArgs`, every invocation allows.
 */
export interface ReadOnlyRule {
  executable: string;
  firstArgs?: string[];
}

export interface Policy {
  /** Absolute (or resolvable) root all cwd values must stay within. */
  workspaceRoot: string;
  /** Basenames of free-form shells; always denied. */
  shells: string[];
  /** Basenames that are always denied (privilege escalation etc.). */
  deniedExecutables: string[];
  /** Basenames that always require interactive approval. */
  askExecutables: string[];
  /** Read-only whitelist; matching invocations auto-allow. */
  readOnly: ReadOnlyRule[];
  /** Decision for redirection metacharacters (`>`, `<`). */
  redirectionDecision: "ask" | "deny";
  /** Decision for shell composition (`|`, `&&`, `;`, backticks, `$(`). */
  compositionDecision: "ask" | "deny";
  /** Decision for anything not otherwise classified. */
  defaultDecision: "ask" | "deny";
}

/** Shell composition: pipes, chaining, substitution, embedded newlines. */
const COMPOSITION_RE = /&&|\|\||[;|`&]|\$\(|\$\{|\r|\n/;
/** Output/input redirection (including fd forms like `2>&1`, `>>`, `<`). */
const REDIRECTION_RE = /[<>]/;
/** fd-style redirection tokens stripped before the composition scan. */
const FD_REDIRECT_RE = /\d?>&?\d?|\d?>>|<<?/g;
/** Windows executable extensions stripped before basename comparison. */
const EXECUTABLE_EXT_RE = /\.(exe|bat|cmd|com|ps1|msi)$/i;

/** Normalized basename for comparison: lowercase, extension stripped. */
export function executableBasename(executable: string): string {
  return path.basename(executable.trim()).toLowerCase().replace(EXECUTABLE_EXT_RE, "");
}

const normalizeForCompare = (p: string): string =>
  process.platform === "win32" ? p.toLowerCase() : p;

/**
 * True when `candidate` resolves to `workspaceRoot` itself or a path inside
 * it. Both absolute and root-relative candidates are supported; `..` escapes
 * and absolute paths outside the root return false.
 */
export function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  const rel = path.relative(
    normalizeForCompare(root),
    normalizeForCompare(resolved),
  );
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a job cwd against the workspace root. Returns the absolute,
 * confined path, or null when the cwd escapes the root.
 */
export function resolveWithinWorkspace(
  workspaceRoot: string,
  cwd?: string,
): string | null {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, cwd && cwd.trim() ? cwd : ".");
  return isWithinWorkspace(resolved, root) ? resolved : null;
}

/* ------------------------------------------------------------------------ */
/* authorize                                                                */
/* ------------------------------------------------------------------------ */

export function authorize(req: ToolRequest, policy: Policy): PolicyDecision {
  if (req.kind !== "terminal.exec") return "deny";

  const root = path.resolve(policy.workspaceRoot || ".");

  // 1. Workspace confinement of the working directory.
  if (!isWithinWorkspace(req.cwd && req.cwd.trim() ? req.cwd : ".", root)) {
    return "deny";
  }
  const resolvedCwd = path.resolve(root, req.cwd && req.cwd.trim() ? req.cwd : ".");

  const executable = (req.executable ?? "").trim();
  if (!executable) return "deny";
  const base = executableBasename(executable);
  if (!base) return "deny";

  // 2. Free-form shells and explicitly denied executables.
  const shells = policy.shells.map((s) => s.toLowerCase());
  if (shells.includes(base)) return "deny";
  const denied = policy.deniedExecutables.map((s) => s.toLowerCase());
  if (denied.includes(base)) return "deny";

  // 3. Path-like executables must resolve inside the workspace.
  if (
    executable.includes("/") ||
    executable.includes("\\") ||
    path.isAbsolute(executable)
  ) {
    if (!isWithinWorkspace(path.resolve(resolvedCwd, executable), root)) {
      return "deny";
    }
  }

  // 4. Shell metacharacters: composition (deny) wins over redirection (ask).
  //    fd redirections (`2>&1`, `>>`, `<`) are stripped before the
  //    composition scan so they classify as redirection, not `&` chaining.
  const args = Array.isArray(req.args) ? req.args : [];
  let sawRedirection = false;
  for (const arg of args) {
    const withoutRedirects = arg.replace(FD_REDIRECT_RE, "");
    if (COMPOSITION_RE.test(withoutRedirects)) return policy.compositionDecision;
    if (withoutRedirects.length !== arg.length || REDIRECTION_RE.test(arg)) {
      sawRedirection = true;
    }
  }
  if (sawRedirection) return policy.redirectionDecision;

  // 5. Read-only whitelist.
  for (const rule of policy.readOnly) {
    if (executableBasename(rule.executable) !== base) continue;
    if (!rule.firstArgs || rule.firstArgs.length === 0) return "allow";
    const first = args[0]?.toLowerCase();
    if (first && rule.firstArgs.map((s) => s.toLowerCase()).includes(first)) {
      return "allow";
    }
  }

  // 6. Known write/network/install/termination executables require approval.
  const ask = policy.askExecutables.map((s) => s.toLowerCase());
  if (ask.includes(base)) return "ask";

  // 7. Unknown executables fall back to the policy default.
  return policy.defaultDecision;
}

/* ------------------------------------------------------------------------ */
/* Loading                                                                  */
/* ------------------------------------------------------------------------ */

const DEFAULT_POLICY_URL = new URL("./default-policy.json", import.meta.url);

type RawPolicy = Partial<Omit<Policy, "workspaceRoot">> & { workspaceRoot?: string };

/**
 * Load the locked-down default policy (default-policy.json), optionally
 * pinning `workspaceRoot`. Unknown JSON fields are ignored; missing sections
 * fall back to deny-by-default values.
 */
export function loadPolicy(workspaceRoot?: string): Policy {
  const raw = JSON.parse(readFileSync(DEFAULT_POLICY_URL, "utf8")) as RawPolicy;
  return {
    workspaceRoot: workspaceRoot ?? raw.workspaceRoot ?? ".",
    shells: raw.shells ?? [],
    deniedExecutables: raw.deniedExecutables ?? [],
    askExecutables: raw.askExecutables ?? [],
    readOnly: raw.readOnly ?? [],
    redirectionDecision: raw.redirectionDecision ?? "ask",
    compositionDecision: raw.compositionDecision ?? "deny",
    defaultDecision: raw.defaultDecision ?? "ask",
  };
}

/** Default policy with an unpinned (".") workspace root. */
export const DEFAULT_POLICY: Policy = loadPolicy();
