import { loadConfig } from "../config/index.js";
import { loadAgents } from "../resources/agents/index.js";
import { getAdapter } from "../adapters/registry.js";

export async function runList(
  resourceKind: string,
  options: { global: boolean },
): Promise<void> {
  if (resourceKind !== "agents") {
    console.error(`Unknown resource kind: ${resourceKind}`);
    console.error("Available: agents");
    process.exit(1);
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
    console.error(`Unknown resource kind: ${resourceKind}`);
    console.error("Available: agents");
    process.exit(1);
  }

  const adapter = getAdapter(harnessId);
  if (!adapter) {
    console.error(`Unknown harness: ${harnessId}`);
    process.exit(1);
  }

  const config = await loadConfig();
  const context = {
    projectRoot: config.projectRoot,
    globalDir: config.globalDir,
    projectDir: config.projectDir,
    models: config.models,
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
