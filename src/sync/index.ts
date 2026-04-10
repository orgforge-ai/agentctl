import type { ResolvedConfig } from "../config/index.js";
import type { Agent } from "../resources/agents/schema.js";
import type { HarnessTarget, SyncResult } from "../adapters/base.js";
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
  target: HarnessTarget,
  config: ResolvedConfig,
  agents: Map<string, Agent>,
  globalAgents: Map<string, Agent>,
  options: SyncOptions,
): Promise<FullSyncResult> {
  const adapter = target.adapter;
  const projectManifest = await loadSyncManifest(config.projectRoot);
  const globalManifest = await loadGlobalSyncManifest();

  const projectManaged = getManagedNames(projectManifest, target.id);
  const globalManaged = target.isProfile
    ? new Set<string>()
    : getManagedNames(globalManifest, target.id);

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
    pathsOverride: target.paths,
    flattenToProject: target.isProfile,
    harnessId: target.id,
  });

  // Update sync manifests for written/unchanged files
  if (!options.dryRun) {
    const context = {
      projectRoot: config.projectRoot,
      globalDir: config.globalDir,
      projectDir: config.projectDir,
      models: config.models,
      harnessId: target.id,
    };

    // Pre-compute: render each agent once, index by target path, track origin.
    // For profile targets the routing always flattens to projectAgentsDir.
    const paths = target.paths;
    const fileIndex = new Map<
      string,
      { agentName: string; content: string; isGlobal: boolean }
    >();
    for (const [name, agent] of agents) {
      const isGlobalOrigin = agent.origin === "global";
      const targetDir = target.isProfile
        ? paths.projectAgentsDir
        : isGlobalOrigin
          ? paths.globalAgentsDir
          : paths.projectAgentsDir;
      if (!targetDir) continue;
      const rendered = await adapter.renderAgent({ agent, context });
      for (const file of rendered) {
        const targetPath = path.join(targetDir, file.relativePath);
        fileIndex.set(targetPath, {
          agentName: name,
          content: file.content,
          // Profile targets always route through projectManifest.
          isGlobal: target.isProfile ? false : isGlobalOrigin,
        });
      }
    }

    for (const action of result.actions) {
      if (
        action.action !== "write" &&
        !(action.action === "skip" && action.reason === "unchanged")
      ) {
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
        harnessId: target.id,
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
    const liveTargetPaths = new Set(fileIndex.keys());
    const manifestsToScan = target.isProfile
      ? [projectManifest]
      : [projectManifest, globalManifest];

    for (const manifest of manifestsToScan) {
      const stale = manifest.entries.filter(
        (e) => e.harnessId === target.id && !liveTargetPaths.has(e.filePath),
      );
      for (const entry of stale) {
        if (await fileExists(entry.filePath)) {
          await fs.unlink(entry.filePath);
          result.actions.push({
            path: entry.filePath,
            action: "delete",
            reason: "agent removed",
          });
        }
        removeManifestEntry(manifest, entry.agentName, target.id);
      }
    }

    await saveSyncManifest(config.projectRoot, projectManifest);
    await saveGlobalSyncManifest(globalManifest);
  }

  return { harnessId: target.id, result };
}
