import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentManifestSchema, type Agent } from "./schema.js";
import { fileExists, readJsonFile, readTextFile } from "../../util/index.js";
import { AgentctlError } from "../../errors.js";

async function loadAgentsFromDir(
  agentsDir: string,
  origin: Agent["origin"],
): Promise<Map<string, Agent>> {
  const agents = new Map<string, Agent>();
  if (!(await fileExists(agentsDir))) return agents;

  const entries = await fs.readdir(agentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentDir = path.join(agentsDir, entry.name);
    const manifestPath = path.join(agentDir, "agent.json");
    if (!(await fileExists(manifestPath))) continue;

    const raw = await readJsonFile<unknown>(manifestPath);
    const parsed = AgentManifestSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AgentctlError(
        `Invalid agent manifest at ${manifestPath}: ${issues}`,
      );
    }

    agents.set(parsed.data.name, {
      manifest: parsed.data,
      description: await readTextFile(path.join(agentDir, "description.md")),
      prompt: await readTextFile(path.join(agentDir, "prompt.md")),
      origin,
      sourcePath: agentDir,
    });
  }
  return agents;
}

export async function loadGlobalAgents(
  globalDir: string,
): Promise<Map<string, Agent>> {
  return loadAgentsFromDir(path.join(globalDir, "agents"), "global");
}

export async function loadAgents(
  globalDir: string,
  projectDir: string,
): Promise<Map<string, Agent>> {
  const globalAgents = await loadAgentsFromDir(
    path.join(globalDir, "agents"),
    "global",
  );
  const projectAgents = await loadAgentsFromDir(
    path.join(projectDir, "agents"),
    "project",
  );

  // Project agents shadow global by name
  const merged = new Map(globalAgents);
  for (const [name, agent] of projectAgents) {
    merged.set(name, agent);
  }
  return merged;
}
