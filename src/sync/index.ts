import type { ResolvedConfig } from "../config/index.js";
import type { Agent } from "../resources/agents/schema.js";
import type { HarnessAdapter, SyncResult } from "../adapters/base.js";
import {
  loadSyncManifest,
  saveSyncManifest,
  getManagedNames,
  updateManifestEntry,
} from "./state.js";
import { contentHash } from "../util/index.js";

export interface SyncOptions {
  dryRun: boolean;
  force: boolean;
  harnessIds?: string[];
}

export interface FullSyncResult {
  harnessId: string;
  result: SyncResult;
}

export async function syncHarness(
  adapter: HarnessAdapter,
  config: ResolvedConfig,
  agents: Map<string, Agent>,
  options: SyncOptions,
): Promise<FullSyncResult> {
  const manifest = await loadSyncManifest(config.projectRoot);
  const managedNames = getManagedNames(manifest, adapter.id);

  const result = await adapter.sync({
    projectRoot: config.projectRoot,
    globalDir: config.globalDir,
    projectDir: config.projectDir,
    models: config.models,
    agents,
    managedNames,
    dryRun: options.dryRun,
    force: options.force,
  });

  // Update sync manifest for written files
  if (!options.dryRun) {
    for (const action of result.actions) {
      if (action.action === "write" || (action.action === "skip" && action.reason === "unchanged")) {
        const agentName = result.actions.find(
          (a) => a.path === action.path,
        )?.path;
        // Find the agent name from the file path
        for (const [name] of agents) {
          const rendered = await adapter.renderAgent({
            agent: agents.get(name)!,
            context: {
              projectRoot: config.projectRoot,
              globalDir: config.globalDir,
              projectDir: config.projectDir,
              models: config.models,
            },
          });
          for (const file of rendered) {
            if (action.path.endsWith(file.relativePath)) {
              updateManifestEntry(manifest, {
                agentName: name,
                harnessId: adapter.id,
                filePath: action.path,
                contentHash: contentHash(file.content),
                syncedAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    }
    await saveSyncManifest(config.projectRoot, manifest);
  }

  return { harnessId: adapter.id, result };
}
