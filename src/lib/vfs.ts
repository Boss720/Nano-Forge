import type { DiffLine, Patch, VirtualFile } from "@/types";

/**
 * Virtual filesystem patch engine (roadmap Task 1.1).
 *
 * A `Patch` carries the full target file as annotated diff lines:
 *   - "ctx" — unchanged lines (present in both versions)
 *   - "add" — lines introduced by the patch
 *   - "del" — lines removed by the patch
 *
 * Applying reconstructs the new file content by keeping ctx + add lines;
 * reverting reconstructs the original content by keeping ctx + del lines.
 */

const APPLY_KEEPS: ReadonlySet<DiffLine["type"]> = new Set(["ctx", "add"]);
const REVERT_KEEPS: ReadonlySet<DiffLine["type"]> = new Set(["ctx", "del"]);

function reconstruct(files: VirtualFile[], patch: Patch, keep: ReadonlySet<DiffLine["type"]>): VirtualFile[] {
  const index = files.findIndex((f) => f.path === patch.file);
  if (index === -1) return files; // unknown target — no-op, never throw

  const target = files[index];
  const lines = patch.lines.filter((l) => keep.has(l.type)).map((l) => l.text);
  let content = lines.join("\n");
  // Preserve the original file's trailing-newline convention.
  if (target.content.endsWith("\n") && !content.endsWith("\n")) {
    content += "\n";
  }

  const next = files.slice();
  next[index] = { ...target, content };
  return next;
}

/**
 * Returns a new array with the patch's target file rebuilt from ctx + add
 * lines. Files not touched by the patch keep object identity. If the target
 * path does not exist, the input array is returned unchanged.
 */
export function applyPatch(files: VirtualFile[], patch: Patch): VirtualFile[] {
  return reconstruct(files, patch, APPLY_KEEPS);
}

/**
 * Inverse of {@link applyPatch}: rebuilds the target file from ctx + del
 * lines (the original content of the diffed region), dropping added lines.
 */
export function revertPatch(files: VirtualFile[], patch: Patch): VirtualFile[] {
  return reconstruct(files, patch, REVERT_KEEPS);
}
