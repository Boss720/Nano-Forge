import React, { useState, useEffect } from 'react';
import {
  FileCode2,
  FileJson2,
  FileText,
  File as FileIconDefault,
  Folder,
  FolderOpen,
  Image as FileImageIcon,
  Settings,
  Search,
  RefreshCw,
  X,
  ChevronRight,
  ChevronDown,
  Loader2
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { FileTreeNode, SearchMatch } from '@/types/workspace';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export interface WorkspaceExplorerProps {
  tree: FileTreeNode[];
  activeFile?: string;
  onFileSelect: (path: string) => void;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onLoadDirectory?: (path: string) => Promise<void> | void;
  searchResults?: SearchMatch[];
  isConnected: boolean;
  className?: string;
}

function getFileIcon(filename: string, isDir: boolean, isOpen: boolean) {
  if (isDir) {
    return isOpen ? <FolderOpen className="h-4 w-4 text-blue-400" /> : <Folder className="h-4 w-4 text-blue-400" />;
  }
  
  const ext = filename.split('.').pop()?.toLowerCase();
  
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) return <FileCode2 className="h-4 w-4 text-blue-400" />;
  if (['json'].includes(ext || '')) return <FileJson2 className="h-4 w-4 text-yellow-400" />;
  if (['md', 'txt'].includes(ext || '')) return <FileText className="h-4 w-4 text-gray-400" />;
  if (['png', 'jpg', 'jpeg', 'svg', 'gif'].includes(ext || '')) return <FileImageIcon className="h-4 w-4 text-purple-400" />;
  if (['config', 'env', 'yml', 'yaml'].some(sub => filename.includes(sub))) return <Settings className="h-4 w-4 text-gray-500" />;
  
  return <FileIconDefault className="h-4 w-4 text-gray-400" />;
}

function getGitBadge(status?: string) {
  if (!status) return null;
  const colors: Record<string, string> = {
    'M': 'text-orange-400',
    'A': 'text-green-400',
    'D': 'text-red-400',
    '?': 'text-gray-400',
    '!': 'text-gray-400',
  };
  const colorClass = colors[status] || 'text-gray-400';
  return <span className={cn("ml-auto font-mono text-[10.5px] font-bold px-1", colorClass)}>{status}</span>;
}

function formatSize(bytes?: number) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TreeNode: React.FC<{
  node: FileTreeNode;
  depth: number;
  activeFile?: string;
  onSelect: (path: string) => void;
  onLoadDirectory?: (path: string) => Promise<void> | void;
}> = ({ node, depth, activeFile, onSelect, onLoadDirectory }) => {
  const [isExpanded, setIsExpanded] = useState(node.expanded ?? false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (node.expanded !== undefined) {
      setIsExpanded(node.expanded);
    }
  }, [node.expanded]);

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node.isDir) return;
    
    if (!isExpanded && !node.children) {
      setIsLoading(true);
      Promise.resolve(onLoadDirectory?.(node.path)).finally(() => {
        setIsLoading(false);
        setIsExpanded(true);
      });
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDir) {
      toggleExpand(e);
    } else {
      onSelect(node.path);
    }
  };

  const isSelected = activeFile === node.path;
  const childCount = node.children ? node.children.length : 0;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            onClick={handleSelect}
            className={cn(
              "group flex cursor-pointer items-center gap-1.5 py-1 pr-2 transition-colors hover:bg-accent/50",
              isSelected && "bg-accent text-accent-foreground"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            title={`${node.path}${node.size ? ` - ${formatSize(node.size)}` : ''}`}
          >
            <div className="flex h-4 w-4 shrink-0 items-center justify-center">
              {node.isDir && (
                isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform" />
                )
              )}
            </div>

            <div className="flex h-4 w-4 shrink-0 items-center justify-center">
              {getFileIcon(node.name, node.isDir, isExpanded)}
            </div>

            <span className={cn(
              "truncate font-mono text-[11.5px] transition-colors",
              !isSelected && "text-muted-foreground group-hover:text-foreground"
            )}>
              {node.name}
            </span>

            {node.isDir && childCount > 0 && !isExpanded && (
              <span className="ml-1 text-[10.5px] text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100">
                ({childCount})
              </span>
            )}

            {getGitBadge(node.gitStatus)}

            {!node.isDir && node.size && (
              <span className="ml-auto hidden text-[10.5px] text-muted-foreground/50 group-hover:inline-block">
                {formatSize(node.size)}
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => node.isDir ? null : onSelect(node.path)}>
            Open
          </ContextMenuItem>
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(node.path)}>
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(`/${node.path}`)}>
            Copy Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem>
            Reveal in Explorer
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {node.isDir && isExpanded && node.children && (
        <div className="relative overflow-hidden transition-all duration-300 ease-in-out">
          <div 
            className="absolute bottom-0 left-[calc(1.5rem-1px)] top-0 w-px bg-border/50" 
            style={{ left: `${depth * 12 + 16}px` }} 
          />
          {node.children.map((child) => (
            <TreeNode 
              key={child.path} 
              node={child} 
              depth={depth + 1} 
              activeFile={activeFile} 
              onSelect={onSelect}
              onLoadDirectory={onLoadDirectory}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function WorkspaceExplorer({
  tree,
  activeFile,
  onFileSelect,
  onRefresh,
  onSearch,
  onLoadDirectory,
  searchResults,
  isConnected,
  className
}: WorkspaceExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, onSearch]);

  const clearSearch = () => {
    setSearchQuery('');
  };

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className={cn("flex flex-col h-full bg-card/30 border-r border-border w-64", className)}>
      <div className="p-3 border-b border-border flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="micro-label">Workspace</span>
          <button 
            onClick={onRefresh}
            disabled={!isConnected}
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh Explorer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="h-7 text-xs pl-7 pr-7 bg-background/50 focus-visible:ring-1"
          />
          {searchQuery && (
            <button 
              onClick={clearSearch}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-2">
          {isSearching ? (
            <div className="px-2">
              <div className="text-[10px] text-muted-foreground mb-2 px-1 font-mono uppercase tracking-wider">
                Search Results {searchResults ? `(${searchResults.length})` : ''}
              </div>
              {searchResults?.map((match, i) => (
                <div 
                  key={`${match.file}-${i}`}
                  onClick={() => onFileSelect(match.file)}
                  className="group cursor-pointer rounded px-2 py-1.5 hover:bg-accent/50 mb-1"
                >
                  <div className="flex items-center gap-1.5 text-[11.5px] font-mono text-foreground mb-0.5">
                    {getFileIcon(match.file, false, false)}
                    <span className="truncate">{match.file.split('/').pop()}</span>
                    <span className="ml-auto text-[10.5px] text-muted-foreground">:{match.line}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate pl-5">
                    {match.file}
                  </div>
                </div>
              ))}
              {searchResults?.length === 0 && (
                <div className="text-[11.5px] text-muted-foreground px-1 py-2 text-center font-mono">
                  No files found.
                </div>
              )}
            </div>
          ) : (
            <div>
              {tree.map(node => (
                <TreeNode 
                  key={node.path} 
                  node={node} 
                  depth={0} 
                  activeFile={activeFile} 
                  onSelect={onFileSelect}
                  onLoadDirectory={onLoadDirectory}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
