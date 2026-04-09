import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_MODELS } from "../config/defaults.js";
import { getAdapter } from "../adapters/registry.js";
import {
  fileExists,
  writeJsonFile,
  writeTextFile,
  findProjectRoot,
  getHome,
} from "../util/index.js";
import {
  ensureSkillshare,
  writeSkillshareConfig,
  detectTargets,
} from "../skillshare/index.js";
import type { AgentManifest } from "../resources/agents/schema.js";
import { AgentctlError } from "../errors.js";

export interface InitOptions {
  from?: string;
  withSkillshare?: boolean;
}

export async function runInit(options: InitOptions): Promise<void> {
  const projectRoot = await findProjectRoot();
  const agentctlDir = path.join(projectRoot, ".agentctl");

  if (await fileExists(agentctlDir)) {
    if (options.withSkillshare) {
      // Ensure skills/ exists even on an existing project
      await fs.mkdir(path.join(agentctlDir, "skills"), { recursive: true });
      await initSkillshare(projectRoot);
      return;
    }
    console.log(`.agentctl/ already exists at ${projectRoot}`);
    console.log("Use agentctl sync to update harness artifacts.");
    return;
  }

  // Create directory structure
  await fs.mkdir(path.join(agentctlDir, "agents"), { recursive: true });
  await fs.mkdir(path.join(agentctlDir, "skills"), { recursive: true });

  // Write config.json
  await writeJsonFile(path.join(agentctlDir, "config.json"), {
    version: 1,
  });

  // Write models.json with defaults
  await writeJsonFile(
    path.join(agentctlDir, "models.json"),
    DEFAULT_MODELS,
  );

  console.log(`Created .agentctl/ at ${projectRoot}`);
  console.log("  config.json  - project configuration");
  console.log("  models.json  - model class mappings");
  console.log("  agents/      - agent definitions");
  console.log("  skills/      - skill definitions (for skillshare)");

  if (options.withSkillshare) {
    await initSkillshare(projectRoot);
  }

  // Import from harness if requested
  if (options.from) {
    const adapter = getAdapter(options.from);
    if (!adapter) {
      throw new AgentctlError(`Unknown harness: ${options.from}`);
    }

    console.log(`\nImporting agents from ${adapter.displayName}...`);

    const context = {
      projectRoot,
      globalDir: path.join(getHome(), ".agentctl"),
      projectDir: agentctlDir,
      models: DEFAULT_MODELS,
    };

    const imported = await adapter.importAgents(context);

    if (imported.length === 0) {
      console.log("No agents found to import.");
      return;
    }

    for (const agent of imported) {
      const agentDir = path.join(agentctlDir, "agents", agent.name);
      await fs.mkdir(agentDir, { recursive: true });

      const manifest: AgentManifest = {
        version: 1,
        name: agent.name,
        description: agent.description ?? undefined,
        adapterOverrides: {},
      };

      // Preserve adapter-specific metadata as overrides
      const overrides: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(agent.metadata)) {
        if (!["name", "description"].includes(key)) {
          overrides[key] = value;
        }
      }
      if (Object.keys(overrides).length > 0) {
        manifest.adapterOverrides = { [options.from]: overrides };
      }

      await writeJsonFile(path.join(agentDir, "agent.json"), manifest);

      if (agent.description) {
        await writeTextFile(
          path.join(agentDir, "description.md"),
          agent.description,
        );
      }

      if (agent.prompt) {
        await writeTextFile(path.join(agentDir, "prompt.md"), agent.prompt);
      }

      console.log(`  Imported: ${agent.name}`);
    }

    console.log(`\nImported ${imported.length} agent(s).`);
    console.log(
      "Note: settings, memory, and CLAUDE.md were not imported (not managed by agentctl).",
    );
  }
}

async function initSkillshare(projectRoot: string): Promise<void> {
  console.log("\nSetting up skillshare integration...");

  const binPath = await ensureSkillshare();
  console.log(`  skillshare: ${binPath}`);

  const targets = await detectTargets(projectRoot);
  await writeSkillshareConfig(projectRoot, targets);
  console.log(`  .skillshare/config.yaml created (targets: ${targets.join(", ")})`);
  console.log("\nNext steps:");
  console.log("  1. Add skills to .agentctl/skills/");
  console.log("  2. Run: skillshare sync");
}
