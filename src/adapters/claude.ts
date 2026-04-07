import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type HarnessAdapter,
  type AdapterContext,
  type DetectionResult,
  type HarnessCapabilities,
  type HarnessPaths,
  type InstalledResources,
  type InstalledResource,
  type UnmanagedResource,
  type RenderAgentInput,
  type RenderedFile,
  type ImportedAgent,
  type SyncContext,
  type SyncResult,
  type SyncFileAction,
  type RunCommandInput,
  type CommandSpec,
} from "./base.js";
import { fileExists, readTextFile, contentHash } from "../util/index.js";

const execFileAsync = promisify(execFile);

function parseClaudeAgentFrontmatter(
  content: string,
): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return frontmatter;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, "");
}

export class ClaudeAdapter implements HarnessAdapter {
  id = "claude";
  displayName = "Claude Code";

  async detect(_context: AdapterContext): Promise<DetectionResult> {
    try {
      const { stdout } = await execFileAsync("claude", ["--version"]);
      return {
        installed: true,
        version: stdout.trim(),
        binaryPath: "claude",
      };
    } catch {
      return { installed: false };
    }
  }

  capabilities(): HarnessCapabilities {
    return {
      interactiveRun: true,
      headlessRun: true,
      customAgents: true,
      directAgentLaunch: true,
    };
  }

  resolveInstallPaths(context: AdapterContext): HarnessPaths {
    return {
      projectAgentsDir: path.join(context.projectRoot, ".claude", "agents"),
      globalAgentsDir: path.join(
        process.env.HOME ?? "~",
        ".claude",
        "agents",
      ),
    };
  }

  async listInstalled(context: AdapterContext): Promise<InstalledResources> {
    const paths = this.resolveInstallPaths(context);
    const agents: InstalledResource[] = [];

    for (const dir of [paths.projectAgentsDir, paths.globalAgentsDir]) {
      if (!dir || !(await fileExists(dir))) continue;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const name = entry.name.replace(/\.md$/, "");
        agents.push({
          name,
          path: path.join(dir, entry.name),
          managed: context.managedNames?.has(name) ?? false,
        });
      }
    }

    return { agents };
  }

  async listUnmanaged(context: AdapterContext): Promise<UnmanagedResource[]> {
    const installed = await this.listInstalled(context);
    return installed.agents
      .filter((a) => !a.managed)
      .map((a) => ({
        kind: "agent" as const,
        name: a.name,
        path: a.path,
      }));
  }

  async renderAgent(input: RenderAgentInput): Promise<RenderedFile[]> {
    const { agent, context } = input;
    const parts: string[] = [];

    // Build frontmatter
    const fm: Record<string, string> = {};
    if (agent.manifest.name) fm["name"] = `"${agent.manifest.name}"`;
    if (agent.manifest.description)
      fm["description"] = `"${agent.manifest.description}"`;
    if (agent.manifest.defaultModelClass) {
      const modelClass = agent.manifest.defaultModelClass;
      const mapping = context.models.modelClasses[modelClass];
      const claudeModel = mapping?.["claude"];
      if (claudeModel) fm["model"] = claudeModel;
    }

    const overrides = agent.manifest.adapterOverrides?.["claude"] ?? {};
    if (overrides["color"]) fm["color"] = String(overrides["color"]);

    if (Object.keys(fm).length > 0) {
      parts.push("---");
      for (const [k, v] of Object.entries(fm)) {
        parts.push(`${k}: ${v}`);
      }
      parts.push("---");
      parts.push("");
    }

    // Add prompt content
    if (agent.prompt) {
      parts.push(agent.prompt);
    }

    const fileName = `${agent.manifest.name}.md`;
    return [
      {
        relativePath: fileName,
        content: parts.join("\n"),
      },
    ];
  }

  async importAgents(context: AdapterContext): Promise<ImportedAgent[]> {
    const agentsDir = path.join(context.projectRoot, ".claude", "agents");
    if (!(await fileExists(agentsDir))) return [];

    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    const imported: ImportedAgent[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const name = entry.name.replace(/\.md$/, "");
      const content = await readTextFile(path.join(agentsDir, entry.name));
      if (!content) continue;

      const frontmatter = parseClaudeAgentFrontmatter(content);
      const prompt = stripFrontmatter(content);

      imported.push({
        name,
        description:
          typeof frontmatter["description"] === "string"
            ? frontmatter["description"]
            : null,
        prompt: prompt.trim() || null,
        modelClass: undefined, // reverse mapping would need model tables
        metadata: frontmatter,
      });
    }

    return imported;
  }

  async sync(context: SyncContext): Promise<SyncResult> {
    const paths = this.resolveInstallPaths(context);
    const actions: SyncFileAction[] = [];
    const warnings: string[] = [];

    // Render and write each managed agent
    for (const [name, agent] of context.agents) {
      const rendered = await this.renderAgent({ agent, context });
      for (const file of rendered) {
        const targetPath = path.join(paths.projectAgentsDir, file.relativePath);
        const existing = await readTextFile(targetPath);

        if (existing !== null && !context.managedNames.has(name)) {
          if (!context.force) {
            warnings.push(
              `Conflict: "${name}" exists in ${paths.projectAgentsDir} but is not managed by agentctl. Use --force to overwrite.`,
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

    // Detect unmanaged agents in harness directory
    if (await fileExists(paths.projectAgentsDir)) {
      const entries = await fs.readdir(paths.projectAgentsDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const name = entry.name.replace(/\.md$/, "");
        if (!context.agents.has(name)) {
          warnings.push(
            `Unmanaged agent "${name}" found in ${paths.projectAgentsDir}`,
          );
        }
      }
    }

    return { actions, warnings };
  }

  async buildRunCommand(input: RunCommandInput): Promise<CommandSpec> {
    const args: string[] = [];

    if (input.headless) {
      if (input.prompt) {
        args.push("-p", input.prompt);
      } else if (input.promptFile) {
        const content = await readTextFile(input.promptFile);
        if (!content) throw new Error(`Cannot read prompt file: ${input.promptFile}`);
        args.push("-p", content);
      } else {
        throw new Error("Headless mode requires --prompt or --prompt-file");
      }
    }

    if (input.agent) {
      args.push("--agent", input.agent);
    }

    if (input.model) {
      const mapping = input.context.models.modelClasses[input.model];
      const claudeModel = mapping?.["claude"];
      if (claudeModel) {
        args.push("--model", claudeModel);
      } else if (!input.degradedOk) {
        throw new Error(
          `No Claude mapping for model class "${input.model}"`,
        );
      }
    }

    if (input.cwd) {
      args.push("--cwd", input.cwd);
    }

    return {
      command: "claude",
      args,
      env: input.env,
      cwd: input.cwd,
    };
  }
}
