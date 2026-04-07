import type { ResolvedConfig } from "../config/index.js";
import type { Agent } from "../resources/agents/schema.js";
import type { HarnessAdapter, SyncResult } from "../adapters/base.js";
import {
  loadSyncManifest,
  saveSyncManifest,
  getManagedNames,
  updateManifestEntry,
} from "./state.js";
import * as path from "node:path";
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

  // Update sync manifest for written/unchanged files
  if (!options.dryRun) {
    const context = {
      projectRoot: config.projectRoot,
      globalDir: config.globalDir,
      projectDir: config.projectDir,
      models: config.models,
    };

    // Pre-compute: render each agent once, index by target path
    const paths = adapter.resolveInstallPaths(context);
    const fileIndex = new Map<string, { agentName: string; content: string }>();
    for (const [name, agent] of agents) {
      const rendered = await adapter.renderAgent({ agent, context });
      for (const file of rendered) {
        const targetPath = path.join(paths.projectAgentsDir, file.relativePath);
        fileIndex.set(targetPath, { agentName: name, content: file.content });
      }
    }

    for (const action of result.actions) {
      if (action.action !== "write" && !(action.action === "skip" && action.reason === "unchanged")) {
        continue;
      }
      const entry = fileIndex.get(action.path);
      if (!entry) {
        console.warn(
          `Warning: sync produced action for ${action.path} but no matching agent render was found`,
        );
        continue;
      }
      updateManifestEntry(manifest, {
        agentName: entry.agentName,
        harnessId: adapter.id,
        filePath: action.path,
        contentHash: contentHash(entry.content),
        syncedAt: new Date().toISOString(),
      });
    }

    await saveSyncManifest(config.projectRoot, manifest);
  }

  return { harnessId: adapter.id, result };
}
