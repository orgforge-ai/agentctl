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
  type RunCommandInput,
  type CommandSpec,
} from "./base.js";
import { fileExists, readTextFile, getHome } from "../util/index.js";
import { syncAgents } from "./sync-utils.js";

const execFileAsync = promisify(execFile);

function formatYamlScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `"${value}"`;
  return null;
}

function buildFrontmatterLines(
  canonical: Record<string, string>,
  overrides: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  const consumed = new Set<string>();

  for (const [k, canonicalVal] of Object.entries(canonical)) {
    consumed.add(k);
    if (k in overrides) {
      const ov = overrides[k];
      if (ov === null || ov === undefined) continue;
      if (typeof ov === "object" && !Array.isArray(ov)) {
        lines.push(`${k}:`);
        for (const [sk, sv] of Object.entries(ov as Record<string, unknown>)) {
          const fv = formatYamlScalar(sv);
          if (fv !== null) lines.push(`  ${sk}: ${fv}`);
        }
      } else {
        const fv = formatYamlScalar(ov);
        if (fv !== null) lines.push(`${k}: ${fv}`);
      }
    } else {
      lines.push(`${k}: ${canonicalVal}`);
    }
  }

  for (const [k, v] of Object.entries(overrides)) {
    if (consumed.has(k) || v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        const fv = formatYamlScalar(sv);
        if (fv !== null) lines.push(`  ${sk}: ${fv}`);
      }
    } else {
      const fv = formatYamlScalar(v);
      if (fv !== null) lines.push(`${k}: ${fv}`);
    }
  }

  return lines;
}

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
    process.env.XDG_CONFIG_HOME ?? path.join(getHome(), ".config"),
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

    const canonical: Record<string, string> = {};
    if (agent.manifest.description)
      canonical["description"] = `"${agent.manifest.description}"`;
    if (agent.manifest.defaultModelClass) {
      const mapping = context.models.modelClasses[agent.manifest.defaultModelClass];
      const opencodeModel = mapping?.["opencode"];
      if (opencodeModel) canonical["model"] = opencodeModel;
    }

    const overrides = (agent.manifest.adapterOverrides?.["opencode"] ?? {}) as Record<string, unknown>;
    const fmLines = buildFrontmatterLines(canonical, overrides);

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
    return [{ relativePath: fileName, content: parts.join("\n") }];
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
    return syncAgents({
      agents: context.agents,
      context,
      projectAgentsDir: paths.projectAgentsDir,
      globalAgentsDir: paths.globalAgentsDir,
      renderAgent: (input) => this.renderAgent(input),
    });
  }

  async buildRunCommand(input: RunCommandInput): Promise<CommandSpec> {
    const args: string[] = [];
    let promptFile: string | undefined;

    if (input.headless) {
      args.push("run");
      if (input.prompt) {
        args.push(input.prompt);
      } else if (input.promptFile) {
        promptFile = input.promptFile;
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
      promptFile,
    };
  }
}
