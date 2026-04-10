import * as path from "node:path";
import { loadConfig } from "../config/index.js";
import { loadAgents, loadGlobalAgents } from "../resources/agents/index.js";
import { resolveTargets } from "../adapters/registry.js";
import { loadSyncManifest, loadGlobalSyncManifest, getManagedNames } from "../sync/state.js";
import { fileExists, readTextFile, contentHash } from "../util/index.js";
import {
  detectSkillshare,
  listSkills,
  readSkillshareConfig,
  checkSkillsSync,
} from "../skillshare/index.js";
import { AgentctlError } from "../errors.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function runDoctor(): Promise<void> {
  const results: CheckResult[] = [];
  const config = await loadConfig();
  const globalConfigPath = path.join(config.globalDir, "config.json");
  const globalModelsPath = path.join(config.globalDir, "models.json");
  const projectConfigPath = path.join(config.projectDir, "config.json");
  const projectModelsPath = path.join(config.projectDir, "models.json");
  const configSources = ["built-in defaults"];

  if (
    (await fileExists(globalConfigPath)) ||
    (await fileExists(globalModelsPath))
  ) {
    configSources.push(`global (${config.globalDir})`);
  }

  if (
    (await fileExists(projectConfigPath)) ||
    (await fileExists(projectModelsPath))
  ) {
    configSources.push(`project (${config.projectDir})`);
  }

  // Check 1: config validity
  results.push({
    name: "Config",
    status: "ok",
    message: `Loaded ${configSources.join(" + ")}`,
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
  const globalAgents = await loadGlobalAgents(config.globalDir);
  results.push({
    name: "Agents",
    status: agents.size > 0 ? "ok" : "warn",
    message: `${agents.size} agent(s) found`,
  });
  for (const [name, agent] of agents) {
    const shadowed = agent.origin === "project" && globalAgents.has(name);
    results.push({
      name: `  ${agent.manifest.name}`,
      status: shadowed ? "warn" : "ok",
      message: shadowed
        ? `${agent.origin}  ${agent.sourcePath}  (overrides global)`
        : `${agent.origin}  ${agent.sourcePath}`,
    });
  }

  // Check 4: model classes
  const classCount = Object.keys(config.models.modelClasses).length;
  results.push({
    name: "Model classes",
    status: classCount > 0 ? "ok" : "warn",
    message: `${classCount} class(es) defined`,
  });

  // Check 5: harness detection
  const manifest = await loadSyncManifest(config.projectRoot);
  const globalManifest = await loadGlobalSyncManifest();
  const targets = resolveTargets(config);
  const detectedAdapters = new Map<string, Awaited<ReturnType<typeof targets[0]["adapter"]["detect"]>>>();

  for (const target of targets) {
    const adapter = target.adapter;
    const projectManaged = getManagedNames(manifest, target.id);
    const globalManaged = target.isProfile
      ? new Set<string>()
      : getManagedNames(globalManifest, target.id);
    const context = {
      projectRoot: config.projectRoot,
      globalDir: config.globalDir,
      projectDir: config.projectDir,
      models: config.models,
      managedNames: new Set([...projectManaged, ...globalManaged]),
      pathsOverride: target.paths,
      flattenToProject: target.isProfile,
      harnessId: target.id,
    };

    let detection = detectedAdapters.get(adapter.id);
    if (!detection) {
      detection = await adapter.detect(context);
      detectedAdapters.set(adapter.id, detection);
    }

    const label = target.isProfile
      ? `Harness profile: ${target.id}`
      : `Harness: ${adapter.displayName}`;
    const destMsg = target.isProfile
      ? ` → ${target.paths.projectAgentsDir}`
      : "";
    results.push({
      name: label,
      status: detection.installed ? "ok" : "warn",
      message:
        (detection.installed
          ? `Installed${detection.version ? ` (${detection.version})` : ""}`
          : "Not found") + destMsg,
    });

    // List installed agents (managed and unmanaged)
    if (detection.installed) {
      const installed = await adapter.listInstalled(context);
      for (const agent of installed.agents) {
        results.push({
          name: `  ${agent.name}`,
          status: agent.managed ? "ok" : "warn",
          message: agent.managed
            ? `managed  ${agent.path}`
            : `unmanaged  ${agent.path}`,
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

  // Check 6b: global sync drift
  let globalDriftCount = 0;
  for (const entry of globalManifest.entries) {
    const content = await readTextFile(entry.filePath);
    if (content === null) {
      globalDriftCount++;
      results.push({
        name: "Global sync drift",
        status: "warn",
        message: `Managed global file missing: ${entry.filePath}`,
      });
    } else if (contentHash(content) !== entry.contentHash) {
      globalDriftCount++;
      results.push({
        name: "Global sync drift",
        status: "warn",
        message: `Managed global file modified externally: ${entry.filePath}`,
      });
    }
  }
  if (globalManifest.entries.length > 0 && globalDriftCount === 0) {
    results.push({
      name: "Global sync drift",
      status: "ok",
      message: "All global managed files in sync",
    });
  }

  // Check 7: skillshare integration
  const skillsDir = path.join(config.projectDir, "skills");
  const skills = await listSkills(skillsDir);

  if (skills.length > 0) {
    results.push({
      name: "Skills source",
      status: "ok",
      message: `${skillsDir} (${skills.length} skill(s) found)`,
    });

    // Check skillshare binary
    const ssDetection = await detectSkillshare();
    results.push({
      name: "Skillshare",
      status: ssDetection.installed ? "ok" : "warn",
      message: ssDetection.installed
        ? `Installed${ssDetection.version ? ` (${ssDetection.version})` : ""}`
        : "Not found — install skillshare to distribute skills",
    });

    // Check .skillshare/config.yaml
    const ssConfig = await readSkillshareConfig(config.projectRoot);
    if (ssConfig.exists) {
      const pointsToAgentctl =
        ssConfig.source === ".agentctl/skills" ||
        ssConfig.source === ".agentctl/skills/";
      results.push({
        name: ".skillshare/config",
        status: pointsToAgentctl ? "ok" : "warn",
        message: pointsToAgentctl
          ? `source → .agentctl/skills`
          : `source → ${ssConfig.source} (expected .agentctl/skills)`,
      });
    } else {
      results.push({
        name: ".skillshare/config",
        status: "warn",
        message:
          "Not found — run agentctl init --with-skillshare or skillshare init",
      });
    }

    // Check sync status
    if (ssDetection.installed && ssConfig.exists) {
      const targets: string[] = [];
      if (await fileExists(path.join(config.projectRoot, ".claude")))
        targets.push("claude");
      if (await fileExists(path.join(config.projectRoot, ".opencode")))
        targets.push("opencode");

      if (targets.length > 0) {
        const syncCheck = await checkSkillsSync(config.projectRoot, targets);
        results.push({
          name: "Skillshare sync",
          status: syncCheck.synced ? "ok" : "warn",
          message: syncCheck.synced
            ? syncCheck.details
            : `${syncCheck.details} — run \`skillshare sync\``,
        });
      }
    }
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
    throw new AgentctlError(
      `${errors.length} check(s) failed`,
    );
  } else if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s)`);
  } else {
    console.log("All checks passed.");
  }
}
