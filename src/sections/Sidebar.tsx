import { useState } from "react";
import { FileCode2, FileJson2, FileText, FolderOpen, MessageSquarePlus, Terminal, X } from "lucide-react";
import type { Session, VirtualFile } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  files: VirtualFile[];
  activeFile: string;
  onFileSelect: (path: string) => void;
  /** Task 3.3: session mutations, always addressed by explicit session id. */
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  /** Layout overrides — e.g. `hidden lg:flex` inline, `h-full w-full border-r-0` in a drawer. */
  className?: string;
}

function fileIcon(path: string) {
  if (path.endsWith(".json")) return <FileJson2 className="h-3.5 w-3.5 text-amber-200/70" />;
  if (path.endsWith(".md")) return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  return <FileCode2 className="h-3.5 w-3.5 text-primary/80" />;
}

export function Sidebar({ sessions, activeId, onSelect, onNew, files, activeFile, onFileSelect, onRename, onDelete, className }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = (s: Session) => {
    setRenamingId(s.id);
    setRenameDraft(s.title);
  };
  const commitRename = () => {
    const title = renameDraft.trim();
    if (renamingId && title) onRename(renamingId, title);
    setRenamingId(null);
  };

  return (
    <aside className={cn("flex w-56 shrink-0 flex-col border-r border-border bg-card/50", className)}>
      {/* sessions */}
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <span className="micro-label">Agent runs</span>
        <button
          onClick={onNew}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
          aria-label="New run"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="scrollbar-thin max-h-48 space-y-0.5 overflow-y-auto px-2 pb-2">
        {sessions.map((s) => (
          <div key={s.id} className="group relative">
            {renamingId === s.id ? (
              <input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                aria-label="Rename session"
                className="w-full rounded-md bg-secondary px-2 py-1.5 font-mono text-[11.5px] text-foreground outline-none ring-1 ring-primary/50"
              />
            ) : (
              <button
                onClick={() => onSelect(s.id)}
                onDoubleClick={() => startRename(s)}
                title={`${s.title} — double-click to rename`}
                className={`w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors ${
                  s.id === activeId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                {s.title}
              </button>
            )}
            {/* Task 3.3: hover-× delete; the last remaining session is never deletable. */}
            {sessions.length > 1 && renamingId !== s.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                aria-label={`Delete "${s.title}"`}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mx-3 my-1 h-px bg-border" />

      {/* virtual workspace */}
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="micro-label">Workspace · edge-api</span>
      </div>
      <div className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => onFileSelect(f.path)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors ${
              f.path === activeFile ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            {fileIcon(f.path)}
            <span className="truncate">{f.path}</span>
          </button>
        ))}
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          <span className="font-mono text-[10.5px]">sandbox · local preview</span>
        </div>
      </div>
    </aside>
  );
}
