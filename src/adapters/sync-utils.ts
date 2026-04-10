import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  Agent,
} from "../resources/agents/schema.js";
import type {
  SyncContext,
  SyncResult,
  SyncFileAction,
  RenderedFile,
} from "./base.js";
import { fileExists, readTextFile } from "../util/index.js";

export interface RenderAgentInput {
  agent: Agent;
  context: SyncContext;
}

export interface SyncAgentsOptions {
  agents: Map<string, Agent>;
  context: SyncContext;
  projectAgentsDir: string;
  globalAgentsDir: string | undefined;
  renderAgent: (input: RenderAgentInput) => Promise<RenderedFile[]>;
}

export async function syncAgents(options: SyncAgentsOptions): Promise<SyncResult> {
  const { agents, context, projectAgentsDir, globalAgentsDir, renderAgent } = options;
  const actions: SyncFileAction[] = [];
  const warnings: string[] = [];

  for (const [name, agent] of agents) {
    const isGlobal = agent.origin === "global";
    const targetDir = context.flattenToProject
      ? projectAgentsDir
      : isGlobal
        ? globalAgentsDir
        : projectAgentsDir;

    if (!targetDir) {
      warnings.push(
        `Cannot sync global agent "${name}" — adapter has no global agents directory`,
      );
      continue;
    }

    const rendered = await renderAgent({ agent, context });
    for (const file of rendered) {
      const targetPath = path.join(targetDir, file.relativePath);
      const existing = await readTextFile(targetPath);

      if (existing !== null && !context.managedNames.has(name)) {
        if (!context.force) {
          warnings.push(
            `Conflict: "${name}" exists in ${targetDir} but is not managed by agentctl. Use --force to overwrite.`,
          );
          actions.push({
            path: targetPath,
            action: "skip",
            reason: "unmanaged conflict",
          });
          continue;
        }
      }

      if (existing === file.content) {
        actions.push({ path: targetPath, action: "skip", reason: "unchanged" });
        continue;
      }

      if (!context.dryRun) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, file.content, "utf-8");
      }

      actions.push({ path: targetPath, action: "write" });
    }
  }

  // Detect unmanaged agents in directories we wrote to.
  const scanDirs = context.flattenToProject
    ? [projectAgentsDir]
    : [projectAgentsDir, globalAgentsDir];
  for (const dir of scanDirs) {
    if (!dir || !(await fileExists(dir))) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = entry.name.replace(/\.md$/, "");
      if (!agents.has(name)) {
        warnings.push(
          `Unmanaged agent "${name}" found in ${dir}`,
        );
      }
    }
  }

  return { actions, warnings };
}
