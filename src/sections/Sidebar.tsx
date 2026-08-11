import { FileCode2, FileJson2, FileText, FolderOpen, MessageSquarePlus, Terminal } from "lucide-react";
import type { Session, VirtualFile } from "@/types";

interface Props {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  files: VirtualFile[];
  activeFile: string;
  onFileSelect: (path: string) => void;
}

function fileIcon(path: string) {
  if (path.endsWith(".json")) return <FileJson2 className="h-3.5 w-3.5 text-amber-200/70" />;
  if (path.endsWith(".md")) return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  return <FileCode2 className="h-3.5 w-3.5 text-primary/80" />;
}

export function Sidebar({ sessions, activeId, onSelect, onNew, files, activeFile, onFileSelect }: Props) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card/50">
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
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors ${
              s.id === activeId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            {s.title}
          </button>
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
