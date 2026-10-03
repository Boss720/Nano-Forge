/**
 * Lightweight Repository Map Generator.
 *
 * Constructs a dense structural overview of the project workspace
 * (< 300 tokens) providing LLM models with instant topological awareness
 * without flooding the prompt with raw directory trees or unneeded file contents.
 */

export interface WorkspacePackageInfo {
  name: string;
  path: string;
  description?: string;
  entryPoint?: string;
}

export interface WorkspaceMetadata {
  projectName: string;
  runtime: string;
  framework?: string;
  branch?: string;
  packages: WorkspacePackageInfo[];
  keyFiles?: string[];
  testSuites?: string[];
}

export class RepositoryMapGenerator {
  /**
   * Generates a compact markdown repository map block.
   */
  generate(metadata: WorkspaceMetadata): string {
    const lines: string[] = ["## REPOSITORY MAP", ""];

    lines.push(`- **Project**: ${metadata.projectName}`);
    lines.push(`- **Runtime / Framework**: ${metadata.runtime}${metadata.framework ? ` (${metadata.framework})` : ""}`);
    if (metadata.branch) {
      lines.push(`- **Git Branch**: \`${metadata.branch}\``);
    }
    lines.push("");

    if (metadata.packages && metadata.packages.length > 0) {
      lines.push("### Monorepo Workspaces & Packages:");
      for (const pkg of metadata.packages) {
        const desc = pkg.description ? ` — ${pkg.description}` : "";
        const entry = pkg.entryPoint ? ` (entry: \`${pkg.entryPoint}\`)` : "";
        lines.push(`- \`${pkg.name}\` (\`${pkg.path}\`)${entry}${desc}`);
      }
      lines.push("");
    }

    if (metadata.keyFiles && metadata.keyFiles.length > 0) {
      lines.push("### Key Entry Points & Configs:");
      for (const file of metadata.keyFiles) {
        lines.push(`- \`${file}\``);
      }
      lines.push("");
    }

    if (metadata.testSuites && metadata.testSuites.length > 0) {
      lines.push("### Test Infrastructure:");
      for (const suite of metadata.testSuites) {
        lines.push(`- ${suite}`);
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  }
}
