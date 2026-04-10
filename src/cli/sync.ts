import { loadConfig } from "../config/index.js";
import { loadAgents, loadGlobalAgents } from "../resources/agents/index.js";
import { resolveTargets } from "../adapters/registry.js";
import { syncHarness } from "../sync/index.js";
import { AgentctlError } from "../errors.js";

export interface SyncCommandOptions {
  dryRun: boolean;
  force: boolean;
}

export async function runSync(
  harnessId: string | undefined,
  options: SyncCommandOptions,
): Promise<void> {
  const config = await loadConfig();
  const agents = await loadAgents(config.globalDir, config.projectDir);
  const globalAgents = await loadGlobalAgents(config.globalDir);

  if (agents.size === 0) {
    console.log("No agents found. Run agentctl init to get started.");
    return;
  }

  const allTargets = resolveTargets(config);
  const targets = harnessId
    ? allTargets.filter((t) => t.id === harnessId)
    : allTargets;

  if (harnessId && targets.length === 0) {
    throw new AgentctlError(`Unknown harness: ${harnessId}`);
  }

  for (const target of targets) {
    const kind = target.isProfile ? "profile" : "built-in";
    console.log(
      `Syncing to ${target.displayName} (${kind}) → ${target.paths.projectAgentsDir}`,
    );

    const result = await syncHarness(target, config, agents, globalAgents, {
      dryRun: options.dryRun,
      force: options.force,
    });

    for (const action of result.result.actions) {
      const prefix =
        action.action === "write"
          ? options.dryRun
            ? "  [dry-run] would write"
            : "  wrote"
          : action.action === "skip"
            ? "  skipped"
            : "  deleted";
      const suffix = action.reason ? ` (${action.reason})` : "";
      console.log(`${prefix}: ${action.path}${suffix}`);
    }

    for (const warning of result.result.warnings) {
      console.log(`  Warning: ${warning}`);
    }
  }
}
