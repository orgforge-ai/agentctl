import * as path from "node:path";
import { loadConfig } from "../config/index.js";
import { loadAgents } from "../resources/agents/index.js";
import { getAllAdapters } from "../adapters/registry.js";
import { loadSyncManifest, getManagedNames } from "../sync/state.js";
import { fileExists, readTextFile, contentHash } from "../util/index.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function runDoctor(): Promise<void> {
  const results: CheckResult[] = [];
  const config = await loadConfig();

  // Check 1: config validity
  results.push({
    name: "Config",
    status: "ok",
    message: `Loaded from ${config.projectDir}`,
  });

  // Check 2: project .agentctl exists
  if (await fileExists(config.projectDir)) {
    results.push({
      name: "Project dir",
      status: "ok",
      message: config.projectDir,
    });
  } else {
    results.push({
      name: "Project dir",
      status: "warn",
      message: `No .agentctl/ found at ${config.projectRoot}. Run agentctl init.`,
    });
  }

  // Check 3: agents
  const agents = await loadAgents(config.globalDir, config.projectDir);
  results.push({
    name: "Agents",
    status: agents.size > 0 ? "ok" : "warn",
    message: `${agents.size} agent(s) found`,
  });

  // Check 4: model classes
  const classCount = Object.keys(config.models.modelClasses).length;
  results.push({
    name: "Model classes",
    status: classCount > 0 ? "ok" : "warn",
    message: `${classCount} class(es) defined`,
  });

  // Check 5: harness detection
  const manifest = await loadSyncManifest(config.projectRoot);
  const adapters = getAllAdapters();
  for (const adapter of adapters) {
    const context = {
      projectRoot: config.projectRoot,
      globalDir: config.globalDir,
      projectDir: config.projectDir,
      models: config.models,
      managedNames: getManagedNames(manifest, adapter.id),
    };

    const detection = await adapter.detect(context);
    results.push({
      name: `Harness: ${adapter.displayName}`,
      status: detection.installed ? "ok" : "warn",
      message: detection.installed
        ? `Installed${detection.version ? ` (${detection.version})` : ""}`
        : "Not found",
    });

    // Check for unmanaged agents
    if (detection.installed) {
      const unmanaged = await adapter.listUnmanaged(context);
      if (unmanaged.length > 0) {
        results.push({
          name: `  Unmanaged (${adapter.id})`,
          status: "warn",
          message: `${unmanaged.length} unmanaged agent(s): ${unmanaged.map((u) => u.name).join(", ")}`,
        });
      }
    }
  }

  // Check 6: sync drift
  let driftCount = 0;
  for (const entry of manifest.entries) {
    const content = await readTextFile(entry.filePath);
    if (content === null) {
      driftCount++;
      results.push({
        name: "Sync drift",
        status: "warn",
        message: `Managed file missing: ${entry.filePath}`,
      });
    } else if (contentHash(content) !== entry.contentHash) {
      driftCount++;
      results.push({
        name: "Sync drift",
        status: "warn",
        message: `Managed file modified externally: ${entry.filePath}`,
      });
    }
  }
  if (manifest.entries.length > 0 && driftCount === 0) {
    results.push({
      name: "Sync drift",
      status: "ok",
      message: "All managed files in sync",
    });
  }

  // Print results
  const statusIcon = { ok: "  ok", warn: "warn", error: " err" };
  const maxName = Math.max(...results.map((r) => r.name.length));

  for (const r of results) {
    console.log(
      `[${statusIcon[r.status]}] ${r.name.padEnd(maxName)}  ${r.message}`,
    );
  }

  const errors = results.filter((r) => r.status === "error");
  const warnings = results.filter((r) => r.status === "warn");

  console.log();
  if (errors.length > 0) {
    console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s)`);
  } else {
    console.log("All checks passed.");
  }
}
