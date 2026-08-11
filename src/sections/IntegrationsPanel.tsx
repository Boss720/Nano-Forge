import { useState } from "react";
import {
  BookOpen,
  Boxes,
  FileText,
  Hash,
  KeyRound,
  ScrollText,
  Server,
  Wrench,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Agent platform — Module 4, Task 14 (UI half).
 *
 * Settings surface for the three integration kinds the local agent host
 * manages: rules packs, skills, and MCP servers. Fully controlled: plain data
 * arrays in, toggle callbacks out; nothing here talks to the host directly.
 *
 * Two safety behaviors live IN this component by design:
 *  - A skill cannot be enabled until its instructions have been expanded and
 *    viewed (mirrors the host registry flow of Task 12), and never while its
 *    content hash is invalid.
 *  - Secrets exist only as opaque references (`env:GITHUB_TOKEN`). The row
 *    types have NO field that could carry a secret value, so nothing
 *    secret-looking can reach the DOM from here.
 */

export type IntegrationHealth = "ok" | "error" | "checking" | "unknown";

export interface RulesPackRow {
  id: string;
  name: string;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
  /** Precedence scope, e.g. "global" | "project" | "run". */
  source: string;
  /** Context digest as reported by the host (shown truncated). */
  digest: string;
  priority?: number;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  /** Narrow tool allow-list from the skill manifest. */
  allowedTools: string[];
  /** Full instructions — rendered in the expandable "view instructions" panel. */
  instructions: string;
  /** false when the host reports a contentHash mismatch; enabling is blocked. */
  hashValid: boolean;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
}

export interface McpServerRow {
  id: string;
  name: string;
  /** Approved executable, e.g. "npx". */
  command: string;
  args?: string[];
  /** Declared tools, namespaced as mcp.<server>.<tool>. */
  tools: string[];
  /** Opaque secret REFERENCE names only (e.g. "env:GITHUB_TOKEN") — never values. */
  secretRefs?: string[];
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
}

export type IntegrationKind = "rules" | "skill" | "mcp";

export interface IntegrationsPanelProps {
  rulesPacks: RulesPackRow[];
  skills: SkillRow[];
  mcpServers: McpServerRow[];
  onToggleRulesPack: (id: string, enabled: boolean) => void;
  onToggleSkill: (id: string, enabled: boolean) => void;
  onToggleMcpServer: (id: string, enabled: boolean) => void;
  /** Optional manual health re-check trigger per row. */
  onCheckHealth?: (kind: IntegrationKind, id: string) => void;
  className?: string;
}

export function IntegrationsPanel({
  rulesPacks,
  skills,
  mcpServers,
  onToggleRulesPack,
  onToggleSkill,
  onToggleMcpServer,
  onCheckHealth,
  className,
}: IntegrationsPanelProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="integrations-panel">
      <Section icon={ScrollText} title="Rules packs" count={rulesPacks.length}>
        {rulesPacks.map((r) => (
          <RulesPackRowView key={r.id} row={r} onToggle={onToggleRulesPack} onCheck={onCheckHealth} />
        ))}
      </Section>
      <Section icon={BookOpen} title="Skills" count={skills.length}>
        {skills.map((s) => (
          <SkillRowView key={s.id} row={s} onToggle={onToggleSkill} onCheck={onCheckHealth} />
        ))}
      </Section>
      <Section icon={Server} title="MCP servers" count={mcpServers.length}>
        {mcpServers.map((m) => (
          <McpServerRowView key={m.id} row={m} onToggle={onToggleMcpServer} onCheck={onCheckHealth} />
        ))}
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Server;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground">{title}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
      </div>
      {count === 0 ? (
        <p className="px-3 py-3 font-mono text-[11px] text-muted-foreground">none configured</p>
      ) : (
        <ul className="divide-y divide-border/60">{children}</ul>
      )}
    </section>
  );
}

function HealthDot({ health }: { health: IntegrationHealth }) {
  const color =
    health === "ok"
      ? "text-emerald-400"
      : health === "error"
        ? "text-red-400"
        : health === "checking"
          ? "animate-pulse text-amber-400"
          : "text-muted-foreground";
  return (
    <span className={cn("font-mono text-[10px]", color)} title={`health: ${health}`}>
      ● {health}
    </span>
  );
}

function LastError({ lastError }: { lastError?: string | null }) {
  if (!lastError) return null;
  return (
    <p className="mt-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 font-mono text-[10px] leading-relaxed text-red-300">
      {lastError}
    </p>
  );
}

function RowShell({
  name,
  sub,
  enabled,
  onToggle,
  toggleDisabled,
  toggleTitle,
  health,
  lastError,
  kind,
  id,
  onCheck,
  children,
}: {
  name: string;
  sub: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  toggleDisabled?: boolean;
  toggleTitle?: string;
  health: IntegrationHealth;
  lastError?: string | null;
  kind: IntegrationKind;
  id: string;
  onCheck?: (kind: IntegrationKind, id: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <li className="px-3 py-2.5" data-integration-id={id}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12px] text-foreground">{name}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">{sub}</span>
          </div>
        </div>
        <HealthDot health={health} />
        {onCheck && (
          <button
            onClick={() => onCheck(kind, id)}
            className="rounded border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground hover:text-foreground"
          >
            re-check
          </button>
        )}
        <span title={toggleTitle}>
          <Switch
            checked={enabled}
            disabled={toggleDisabled}
            onCheckedChange={onToggle}
            aria-label={`enable ${name}`}
          />
        </span>
      </div>
      {children}
      <LastError lastError={lastError} />
    </li>
  );
}

function RulesPackRowView({
  row,
  onToggle,
  onCheck,
}: {
  row: RulesPackRow;
  onToggle: (id: string, enabled: boolean) => void;
  onCheck?: (kind: IntegrationKind, id: string) => void;
}) {
  return (
    <RowShell
      name={row.name}
      sub={row.id}
      enabled={row.enabled}
      onToggle={(v) => onToggle(row.id, v)}
      health={row.health}
      lastError={row.lastError}
      kind="rules"
      id={row.id}
      onCheck={onCheck}
    >
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
          {row.source}
        </span>
        {row.priority !== undefined && (
          <span className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
            priority {row.priority}
          </span>
        )}
        <span
          className="flex items-center gap-1 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground"
          title={`context digest ${row.digest}`}
        >
          <Hash className="h-2.5 w-2.5" />
          {row.digest.slice(0, 12)}
        </span>
      </div>
    </RowShell>
  );
}

function SkillRowView({
  row,
  onToggle,
  onCheck,
}: {
  row: SkillRow;
  onToggle: (id: string, enabled: boolean) => void;
  onCheck?: (kind: IntegrationKind, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Enable gate: instructions must have been expanded at least once AND the
  // content hash must be valid. Both conditions mirror the host registry.
  const canEnable = expanded && row.hashValid;
  const toggleDisabled = !row.enabled && !canEnable;
  const toggleTitle = !row.hashValid
    ? "content hash mismatch — enabling blocked"
    : !expanded && !row.enabled
      ? "view instructions before enabling"
      : undefined;

  return (
    <RowShell
      name={row.name}
      sub={row.id}
      enabled={row.enabled}
      onToggle={(v) => onToggle(row.id, v)}
      toggleDisabled={toggleDisabled}
      toggleTitle={toggleTitle}
      health={row.health}
      lastError={row.lastError}
      kind="skill"
      id={row.id}
      onCheck={onCheck}
    >
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{row.description}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {row.allowedTools.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground"
          >
            <Wrench className="h-2.5 w-2.5" />
            {t}
          </span>
        ))}
        <span
          className={cn(
            "rounded px-1 py-px font-mono text-[9.5px]",
            row.hashValid ? "bg-secondary text-muted-foreground" : "bg-red-500/15 text-red-300",
          )}
        >
          {row.hashValid ? "hash ok" : "hash mismatch"}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          <FileText className="h-2.5 w-2.5" />
          {expanded ? "hide instructions" : "view instructions"}
        </button>
      </div>
      {expanded && (
        <pre className="scrollbar-thin mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/30 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-foreground">
          {row.instructions}
        </pre>
      )}
    </RowShell>
  );
}

function McpServerRowView({
  row,
  onToggle,
  onCheck,
}: {
  row: McpServerRow;
  onToggle: (id: string, enabled: boolean) => void;
  onCheck?: (kind: IntegrationKind, id: string) => void;
}) {
  return (
    <RowShell
      name={row.name}
      sub={row.id}
      enabled={row.enabled}
      onToggle={(v) => onToggle(row.id, v)}
      health={row.health}
      lastError={row.lastError}
      kind="mcp"
      id={row.id}
      onCheck={onCheck}
    >
      <div className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
        <Boxes className="h-3 w-3 shrink-0" />
        <span className="break-all">
          {row.command}
          {row.args && row.args.length > 0 ? ` ${row.args.join(" ")}` : ""}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {row.tools.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground"
          >
            <Wrench className="h-2.5 w-2.5" />
            {t}
          </span>
        ))}
        {row.secretRefs?.map((ref) => (
          // Opaque reference names ONLY. Values resolve on the host from OS
          // secure storage / process env and never enter the browser.
          <span
            key={ref}
            className="flex items-center gap-1 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground"
            title="secret reference — value resolves on the local host only"
          >
            <KeyRound className="h-2.5 w-2.5" />
            {ref}
          </span>
        ))}
      </div>
    </RowShell>
  );
}
