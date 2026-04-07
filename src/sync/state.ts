import * as path from "node:path";
import { contentHash, readJsonFile, writeJsonFile, globalConfigDir } from "../util/index.js";

export interface SyncManifestEntry {
  agentName: string;
  harnessId: string;
  filePath: string;
  contentHash: string;
  syncedAt: string;
}

export interface SyncManifest {
  version: 1;
  projectId: string;
  entries: SyncManifestEntry[];
}

function stateDir(): string {
  return path.join(globalConfigDir(), "state");
}

function projectKey(projectRoot: string): string {
  return contentHash(projectRoot).slice(0, 16);
}

function manifestPath(projectRoot: string): string {
  return path.join(stateDir(), `${projectKey(projectRoot)}.json`);
}

export async function loadSyncManifest(
  projectRoot: string,
): Promise<SyncManifest> {
  const existing = await readJsonFile<SyncManifest>(manifestPath(projectRoot));
  if (existing && existing.version === 1) return existing;
  return {
    version: 1,
    projectId: projectKey(projectRoot),
    entries: [],
  };
}

export async function saveSyncManifest(
  projectRoot: string,
  manifest: SyncManifest,
): Promise<void> {
  await writeJsonFile(manifestPath(projectRoot), manifest);
}

export function getManagedNames(
  manifest: SyncManifest,
  harnessId: string,
): Set<string> {
  return new Set(
    manifest.entries
      .filter((e) => e.harnessId === harnessId)
      .map((e) => e.agentName),
  );
}

export function updateManifestEntry(
  manifest: SyncManifest,
  entry: SyncManifestEntry,
): void {
  const idx = manifest.entries.findIndex(
    (e) =>
      e.agentName === entry.agentName && e.harnessId === entry.harnessId,
  );
  if (idx >= 0) {
    manifest.entries[idx] = entry;
  } else {
    manifest.entries.push(entry);
  }
}

export function removeManifestEntry(
  manifest: SyncManifest,
  agentName: string,
  harnessId: string,
): void {
  manifest.entries = manifest.entries.filter(
    (e) => !(e.agentName === agentName && e.harnessId === harnessId),
  );
}
