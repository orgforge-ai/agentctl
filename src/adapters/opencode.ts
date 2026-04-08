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
import { fileExists, readTextFile } from "../util/index.js";

const execFileAsync = promisify(execFile);

function parseYamlFrontmatter(content: string): Record<string, unknown> {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentMap: Record<string, unknown> | null = null;

  for (const line of match[1].split("\n")) {
    // Nested key (indented)
    if (currentKey && /^\s+/.test(line)) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = parseYamlValue(line.slice(colonIdx + 1).trim());
      if (!currentMap) currentMap = {};
      currentMap[key] = value;
      frontmatter[currentKey] = currentMap;
      continue;
    }

    // Flush previous nested map
    currentKey = null;
    currentMap = null;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === "") {
      // Start of a nested map
      currentKey = key;
      currentMap = {};
      frontmatter[key] = currentMap;
    } else {
      frontmatter[key] = parseYamlValue(rest);
    }
  }
  return frontmatter;
}

function parseYamlValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

function stripFrontmatter(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n*/, "");
}

function globalConfigDir(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "~", ".config"),
    "opencode",
  );
}

export class OpenCodeAdapter implements HarnessAdapter {
  id = "opencode";
  displayName = "OpenCode";

  async detect(_context: AdapterContext): Promise<DetectionResult> {
    try {
      const { stdout } = await execFileAsync("opencode", ["--version"]);
      return {
        installed: true,
        version: stdout.trim(),
        binaryPath: "opencode",
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
      projectAgentsDir: path.join(context.projectRoot, ".opencode", "agents"),
      globalAgentsDir: path.join(globalConfigDir(), "agents"),
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

    // Build YAML frontmatter
    const fmLines: string[] = [];
    if (agent.manifest.description)
      fmLines.push(`description: "${agent.manifest.description}"`);

    // Resolve model class to opencode-specific model
    if (agent.manifest.defaultModelClass) {
      const modelClass = agent.manifest.defaultModelClass;
      const mapping = context.models.modelClasses[modelClass];
      const opencodeModel = mapping?.["opencode"];
      if (opencodeModel) fmLines.push(`model: ${opencodeModel}`);
    }

    // Apply adapter overrides
    const overrides = agent.manifest.adapterOverrides?.["opencode"] ?? {};
    if (overrides["color"]) fmLines.push(`color: "${overrides["color"]}"`);
    if (overrides["mode"]) fmLines.push(`mode: ${overrides["mode"]}`);
    if (overrides["temperature"] !== undefined)
      fmLines.push(`temperature: ${overrides["temperature"]}`);

    // Tools block
    const tools = overrides["tools"] as Record<string, boolean> | undefined;
    if (tools && Object.keys(tools).length > 0) {
      fmLines.push("tools:");
      for (const [tool, enabled] of Object.entries(tools)) {
        fmLines.push(`  ${tool}: ${enabled}`);
      }
    }

    if (fmLines.length > 0) {
      parts.push("---");
      parts.push(...fmLines);
      parts.push("---");
      parts.push("");
    }

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
    const agentsDir = path.join(context.projectRoot, ".opencode", "agents");
    if (!(await fileExists(agentsDir))) return [];

    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    const imported: ImportedAgent[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const name = entry.name.replace(/\.md$/, "");
      const content = await readTextFile(path.join(agentsDir, entry.name));
      if (!content) continue;

      const frontmatter = parseYamlFrontmatter(content);
      const prompt = stripFrontmatter(content);

      imported.push({
        name,
        description:
          typeof frontmatter["description"] === "string"
            ? frontmatter["description"]
            : null,
        prompt: prompt.trim() || null,
        modelClass: undefined,
        metadata: frontmatter,
      });
    }

    return imported;
  }

  async sync(context: SyncContext): Promise<SyncResult> {
    const paths = this.resolveInstallPaths(context);
    const actions: SyncFileAction[] = [];
    const warnings: string[] = [];

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
      args.push("run");
      if (input.prompt) {
        args.push(input.prompt);
      } else if (input.promptFile) {
        const content = await readTextFile(input.promptFile);
        if (!content) throw new Error(`Cannot read prompt file: ${input.promptFile}`);
        args.push(content);
      } else {
        throw new Error("Headless mode requires --prompt or --prompt-file");
      }
    }

    if (input.agent) {
      args.push("--agent", input.agent);
    }

    if (input.model) {
      const mapping = input.context.models.modelClasses[input.model];
      const opencodeModel = mapping?.["opencode"];
      if (opencodeModel) {
        args.push("-m", opencodeModel);
      } else if (!input.degradedOk) {
        throw new Error(
          `No OpenCode mapping for model class "${input.model}"`,
        );
      }
    }

    return {
      command: "opencode",
      args,
      env: input.env,
      cwd: input.cwd ?? input.context.projectRoot,
    };
  }
}
