import { useState, useCallback } from 'react';
import type { FileTreeNode, SearchMatch, GitFileStatus, DirEntry } from '@/types/workspace';

export interface WorkspaceClient {
  readDir(path?: string): Promise<DirEntry[]>;
  search(query: string, options?: { maxResults?: number }): Promise<SearchMatch[]>;
  gitStatus(): Promise<GitFileStatus[]>;
}

const toNodes = (entries: DirEntry[], parent = ''): FileTreeNode[] => entries
  .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  .map((entry) => ({ name: entry.name, path: parent ? `${parent}/${entry.name}` : entry.name, isDir: entry.isDir, size: entry.size, modified: entry.modified }));

function replaceChildren(nodes: FileTreeNode[], path: string, children: FileTreeNode[]): FileTreeNode[] {
  return nodes.map((node) => node.path === path ? { ...node, children, expanded: true } : node.children ? { ...node, children: replaceChildren(node.children, path, children) } : node);
}

export function useWorkspace(client?: WorkspaceClient) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [activeFile, setActiveFile] = useState<string>();
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitFileStatus[]>([]);

  const loadDirectory = useCallback(async (path: string) => {
    if (!client) return;
    setIsLoading(true);
    try {
      const entries = await client.readDir(path);
      const children = toNodes(entries, path);
      setTree((prev) => path ? replaceChildren(prev, path, children) : children);
    } finally { setIsLoading(false); }
  }, [client]);

  const selectFile = useCallback((path: string) => setActiveFile(path), []);
  const searchFiles = useCallback(async (query: string) => {
    if (!client || !query.trim()) { setSearchResults([]); return; }
    setIsLoading(true);
    try { setSearchResults(await client.search(query, { maxResults: 200 })); }
    finally { setIsLoading(false); }
  }, [client]);
  const refreshTree = useCallback(() => loadDirectory(''), [loadDirectory]);
  const refreshGitStatus = useCallback(async () => { if (client) setGitStatus(await client.gitStatus()); }, [client]);

  return { tree, activeFile, searchResults, isLoading, gitStatus, loadDirectory, selectFile, searchFiles, refreshTree, refreshGitStatus };
}
