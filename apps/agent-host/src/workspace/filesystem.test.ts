import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleReadDir, handleReadFile, handleWriteFile, handleStat, handleSearch, handleGitStatus } from './filesystem.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';

vi.mock('execa');

describe('workspace filesystem', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoforge-test-'));
    // Setup some test files
    await fs.mkdir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'console.log("hello");', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Hello', 'utf8');
    await fs.mkdir(path.join(tmpDir, 'node_modules'));
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'test.js'), 'bad', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('handleReadDir', () => {
    it('returns sorted entries with directories first and ignores node_modules', async () => {
      const entries = await handleReadDir(tmpDir, '.');
      
      expect(entries).toHaveLength(2); // src (dir), README.md (file). node_modules ignored.
      expect(entries[0].name).toBe('src');
      expect(entries[0].isDir).toBe(true);
      expect(entries[1].name).toBe('README.md');
      expect(entries[1].isDir).toBe(false);
      expect(entries[1].size).toBeGreaterThan(0);
      expect(entries[1].modified).toBeDefined();
    });

    it('blocks path traversal', async () => {
      await expect(handleReadDir(tmpDir, '../')).rejects.toThrow();
    });
  });

  describe('handleReadFile', () => {
    it('returns content with correct language detection', async () => {
      const file = await handleReadFile(tmpDir, 'src/index.ts');
      expect(file.content).toBe('console.log("hello");');
      expect(file.language).toBe('typescript');
      expect(file.size).toBeGreaterThan(0);
    });

    it('blocks files outside workspace', async () => {
      await expect(handleReadFile(tmpDir, '../etc/passwd')).rejects.toThrow();
    });

    it('rejects files over 1MB', async () => {
      const _largeFile = path.join(tmpDir, 'large.txt');
      // Mock stat for this file to avoid actually creating a 1MB+ file
      const originalStat = fs.stat;
      vi.spyOn(fs, 'stat').mockImplementation(async (p: import('node:fs').PathLike) => {
        if (p.toString().endsWith('large.txt')) {
          return { size: 2 * 1024 * 1024 } as unknown as import('node:fs').Stats;
        }
        return originalStat(p);
      });

      await expect(handleReadFile(tmpDir, 'large.txt')).rejects.toThrow('File too large (exceeds 1MB limit)');
    });
  });

  describe('handleWriteFile', () => {
    it('creates parent directories and writes file', async () => {
      const result = await handleWriteFile(tmpDir, 'nested/dir/new.js', 'const x = 1;');
      expect(result.success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'nested/dir/new.js'), 'utf8');
      expect(content).toBe('const x = 1;');
    });

    it('blocks writes outside workspace', async () => {
      await expect(handleWriteFile(tmpDir, '../../system.txt', 'hack')).rejects.toThrow();
    });
  });

  describe('handleStat', () => {
    it('returns correct metadata', async () => {
      const stat = await handleStat(tmpDir, 'src/index.ts');
      expect(stat.isFile).toBe(true);
      expect(stat.isDir).toBe(false);
      expect(stat.size).toBeGreaterThan(0);
      expect(stat.modified).toBeDefined();
    });
  });

  describe('handleSearch', () => {
    it('returns matches using ripgrep', async () => {
      const mockExeca = vi.mocked(execa).mockResolvedValue({
        stdout: `{"type":"match","data":{"path":{"text":"src/index.ts"},"line_number":1,"submatches":[{"match":{"text":"hello"},"start":13,"end":18}],"lines":{"text":"console.log(\\"hello\\");\\n"}}}`,
      } as never);

      const matches = await handleSearch(tmpDir, 'hello');
      
      expect(mockExeca).toHaveBeenCalled();
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        file: 'src/index.ts',
        line: 1,
        column: 13,
        text: 'console.log("hello");',
        matchText: 'hello',
      });
    });
  });

  describe('handleGitStatus', () => {
    it('parses porcelain output correctly', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: ` M src/index.ts\n?? new-file.txt\nD  deleted.js`,
      } as never);

      const status = await handleGitStatus(tmpDir);
      expect(status).toHaveLength(3);
      expect(status[0]).toEqual({ path: 'src/index.ts', status: 'M' });
      expect(status[1]).toEqual({ path: 'new-file.txt', status: '?' });
      expect(status[2]).toEqual({ path: 'deleted.js', status: 'D' });
    });
  });
});
