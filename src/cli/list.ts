import * as path from "node:path";
import { loadConfig } from "../config/index.js";
import { loadAgents } from "../resources/agents/index.js";
import { resolveTarget } from "../adapters/registry.js";
import { loadSyncManifest, loadGlobalSyncManifest, getManagedNames } from "../sync/state.js";
import { listSkills } from "../skillshare/index.js";
import { AgentctlError } from "../errors.js";

export async function runList(
  resourceKind: string,
  options: { global: boolean },
): Promise<void> {
  if (resourceKind === "skills") {
    await runListSkills(options);
    return;
  }

  if (resourceKind !== "agents") {
    throw new AgentctlError(
      `Unknown resource kind: ${resourceKind}. Available: agents, skills`,
    );
  }

  const config = await loadConfig();
  const agents = await loadAgents(config.globalDir, config.projectDir);

  if (agents.size === 0) {
    console.log("No agents found.");
    return;
  }

  // Calculate column widths
  const entries = Array.from(agents.values());
  if (options.global) {
    const filtered = entries.filter((a) => a.origin === "global");
    if (filtered.length === 0) {
      console.log("No global agents found.");
      return;
    }
    printAgentTable(filtered);
  } else {
    printAgentTable(entries);
  }
}

export async function runHarnessList(
  harnessId: string,
  resourceKind: string,
): Promise<void> {
  if (resourceKind !== "agents") {
    throw new AgentctlError(
      `Unknown resource kind: ${resourceKind}. Available: agents`,
    );
  }

  const config = await loadConfig();
  const target = resolveTarget(harnessId, config);
  if (!target) {
    throw new AgentctlError(`Unknown harness: ${harnessId}`);
  }
  const adapter = target.adapter;

  const projectManifest = await loadSyncManifest(config.projectRoot);
  const globalManifest = await loadGlobalSyncManifest();
  const managedNames = new Set([
    ...getManagedNames(projectManifest, target.id),
    ...(target.isProfile ? [] : getManagedNames(globalManifest, target.id)),
  ]);
  const context = {
    projectRoot: config.projectRoot,
    globalDir: config.globalDir,
    projectDir: config.projectDir,
    models: config.models,
    managedNames,
    pathsOverride: target.paths,
    flattenToProject: target.isProfile,
    harnessId: target.id,
  };

  const installed = await adapter.listInstalled(context);

  if (installed.agents.length === 0) {
    console.log(`No agents installed for ${adapter.displayName}.`);
    return;
  }

  const nameWidth = Math.max(
    4,
    ...installed.agents.map((a) => a.name.length),
  );

  console.log(
    `${"NAME".padEnd(nameWidth)}  ${"MANAGED".padEnd(7)}  PATH`,
  );
  for (const agent of installed.agents) {
    console.log(
      `${agent.name.padEnd(nameWidth)}  ${(agent.managed ? "yes" : "no").padEnd(7)}  ${agent.path}`,
    );
  }
}

async function runListSkills(options: { global: boolean }): Promise<void> {
  const config = await loadConfig();

  const projectSkills = await listSkills(
    path.join(config.projectDir, "skills"),
  );
  const globalSkills = await listSkills(
    path.join(config.globalDir, "skills"),
  );

  // Project skills shadow global by name
  const merged = new Map<string, { name: string; description: string | null; origin: string; sourcePath: string }>();
  for (const s of globalSkills) {
    merged.set(s.name, { ...s, origin: "global" });
  }
  if (!options.global) {
    for (const s of projectSkills) {
      merged.set(s.name, { ...s, origin: "project" });
    }
  }

  const entries = Array.from(merged.values());
  if (options.global) {
    const filtered = entries.filter((s) => s.origin === "global");
    if (filtered.length === 0) {
      console.log("No global skills found.");
      return;
    }
    printSkillTable(filtered);
  } else {
    if (entries.length === 0) {
      console.log("No skills found.");
      return;
    }
    printSkillTable(entries);
  }
}

function printSkillTable(skills: { name: string; description: string | null; origin: string; sourcePath: string }[]): void {
  const nameWidth = Math.max(4, ...skills.map((s) => s.name.length));
  const originWidth = Math.max(6, ...skills.map((s) => s.origin.length));

  console.log(
    `${"NAME".padEnd(nameWidth)}  ${"ORIGIN".padEnd(originWidth)}  PATH`,
  );
  for (const skill of skills) {
    console.log(
      `${skill.name.padEnd(nameWidth)}  ${skill.origin.padEnd(originWidth)}  ${skill.sourcePath}`,
    );
  }
}

function printAgentTable(agents: { manifest: { name: string }; origin: string; sourcePath: string }[]): void {
  const nameWidth = Math.max(4, ...agents.map((a) => a.manifest.name.length));
  const originWidth = Math.max(6, ...agents.map((a) => a.origin.length));

  console.log(
    `${"NAME".padEnd(nameWidth)}  ${"ORIGIN".padEnd(originWidth)}  PATH`,
  );
  for (const agent of agents) {
    console.log(
      `${agent.manifest.name.padEnd(nameWidth)}  ${agent.origin.padEnd(originWidth)}  ${agent.sourcePath}`,
    );
  }
}
