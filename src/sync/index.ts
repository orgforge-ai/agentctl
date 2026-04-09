import type { ResolvedConfig } from "../config/index.js";
import type { Agent } from "../resources/agents/schema.js";
import type { HarnessAdapter, SyncResult } from "../adapters/base.js";
import {
  loadSyncManifest,
  saveSyncManifest,
  loadGlobalSyncManifest,
  saveGlobalSyncManifest,
  getManagedNames,
  updateManifestEntry,
  removeManifestEntry,
} from "./state.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { contentHash, fileExists } from "../util/index.js";

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
  globalAgents: Map<string, Agent>,
  options: SyncOptions,
): Promise<FullSyncResult> {
  const projectManifest = await loadSyncManifest(config.projectRoot);
  const globalManifest = await loadGlobalSyncManifest();

  const projectManaged = getManagedNames(projectManifest, adapter.id);
  const globalManaged = getManagedNames(globalManifest, adapter.id);

  const result = await adapter.sync({
    projectRoot: config.projectRoot,
    globalDir: config.globalDir,
    projectDir: config.projectDir,
    models: config.models,
    agents,
    globalAgents,
    managedNames: new Set([...projectManaged, ...globalManaged]),
    dryRun: options.dryRun,
    force: options.force,
  });

  // Update sync manifests for written/unchanged files
  if (!options.dryRun) {
    const context = {
      projectRoot: config.projectRoot,
      globalDir: config.globalDir,
      projectDir: config.projectDir,
      models: config.models,
    };

    // Pre-compute: render each agent once, index by target path, track origin
    const paths = adapter.resolveInstallPaths(context);
    const fileIndex = new Map<string, { agentName: string; content: string; isGlobal: boolean }>();
    for (const [name, agent] of agents) {
      const isGlobal = agent.origin === "global";
      const targetDir = isGlobal ? paths.globalAgentsDir : paths.projectAgentsDir;
      if (!targetDir) continue;
      const rendered = await adapter.renderAgent({ agent, context });
      for (const file of rendered) {
        const targetPath = path.join(targetDir, file.relativePath);
        fileIndex.set(targetPath, { agentName: name, content: file.content, isGlobal });
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
      const manifestEntry = {
        agentName: entry.agentName,
        harnessId: adapter.id,
        filePath: action.path,
        contentHash: contentHash(entry.content),
        syncedAt: new Date().toISOString(),
      };
      if (entry.isGlobal) {
        updateManifestEntry(globalManifest, manifestEntry);
      } else {
        updateManifestEntry(projectManifest, manifestEntry);
      }
    }

    // Delete stale managed files: agents removed or origin changed
    // Build a set of target paths that the current sync wrote/skipped to.
    // Any manifest entry pointing elsewhere is stale.
    const liveTargetPaths = new Set(fileIndex.keys());

    for (const manifest of [projectManifest, globalManifest]) {
      const stale = manifest.entries.filter(
        (e) => e.harnessId === adapter.id && !liveTargetPaths.has(e.filePath),
      );
      for (const entry of stale) {
        if (await fileExists(entry.filePath)) {
          await fs.unlink(entry.filePath);
          result.actions.push({ path: entry.filePath, action: "delete", reason: "agent removed" });
        }
        removeManifestEntry(manifest, entry.agentName, adapter.id);
      }
    }

    await saveSyncManifest(config.projectRoot, projectManifest);
    await saveGlobalSyncManifest(globalManifest);
  }

  return { harnessId: adapter.id, result };
}
