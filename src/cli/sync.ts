import { loadConfig } from "../config/index.js";
import { loadAgents } from "../resources/agents/index.js";
import { getAdapter, getAllAdapters } from "../adapters/registry.js";
import { syncHarness } from "../sync/index.js";

export interface SyncCommandOptions {
  dryRun: boolean;
  force: boolean;
  projectOnly: boolean;
}

export async function runSync(
  harnessId: string | undefined,
  options: SyncCommandOptions,
): Promise<void> {
  const config = await loadConfig();
  const agents = await loadAgents(config.globalDir, config.projectDir);

  if (agents.size === 0) {
    console.log("No agents found. Run agentctl init to get started.");
    return;
  }

  const adapters = harnessId
    ? [getAdapter(harnessId)].filter(Boolean)
    : getAllAdapters();

  if (harnessId && adapters.length === 0) {
    console.error(`Unknown harness: ${harnessId}`);
    process.exit(1);
  }

  for (const adapter of adapters) {
    if (!adapter) continue;
    console.log(`Syncing to ${adapter.displayName}...`);

    const result = await syncHarness(adapter, config, agents, {
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
