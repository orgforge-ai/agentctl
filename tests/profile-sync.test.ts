import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/index.js";
import { loadAgents, loadGlobalAgents } from "../src/resources/agents/index.js";
import { resolveTarget, resolveTargets } from "../src/adapters/registry.js";
import { syncHarness } from "../src/sync/index.js";

const originalCwd = process.cwd();
const originalHome = process.env.HOME;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

interface Fixture {
  tmpDir: string;
  projectRoot: string;
  homeDir: string;
  profileDest: string;
}

async function writeAgent(
  dir: string,
  name: string,
  description: string,
  prompt: string,
): Promise<void> {
  const agentDir = path.join(dir, name);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(
    path.join(agentDir, "agent.json"),
    JSON.stringify({ version: 1, name, description }, null, 2),
    "utf-8",
  );
  await fs.writeFile(path.join(agentDir, "prompt.md"), prompt, "utf-8");
}

async function setupFixture(
  testName: string,
  profileConfig: Record<string, unknown>,
): Promise<Fixture> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `agentctl-${testName}-`));
  const projectRoot = path.join(tmpDir, "project");
  const homeDir = path.join(tmpDir, "home");

  await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, ".agentctl", "agents"), {
    recursive: true,
  });
  await fs.mkdir(path.join(homeDir, ".agentctl", "agents"), { recursive: true });

  await fs.writeFile(
    path.join(projectRoot, ".agentctl", "config.json"),
    JSON.stringify(profileConfig, null, 2),
    "utf-8",
  );

  const profileDest = path.join(projectRoot, ".opencode-zai", "agents");

  process.chdir(projectRoot);
  process.env.HOME = homeDir;

  return { tmpDir, projectRoot, homeDir, profileDest };
}

const profileConfig = {
  version: 1,
  harnesses: {
    "opencode-zai": {
      adapter: "opencode",
      paths: {
        projectAgentsDir: ".opencode-zai/agents",
      },
      run: {
        env: {
          OPENCODE_CONFIG_DIR: "~/.config/opencode-zai",
        },
      },
    },
  },
};

async function runProfileSync(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);
  const target = resolveTarget("opencode-zai", config);
  assert(target, "expected opencode-zai target");
  const agents = await loadAgents(config.globalDir, config.projectDir);
  const globalAgents = await loadGlobalAgents(config.globalDir);
  await syncHarness(target!, config, agents, globalAgents, {
    dryRun: false,
    force: false,
  });
}

describe("OpenCode profile sync", () => {
  it("resolves profiles as effective harness targets", async () => {
    const fx = await setupFixture("profile-resolve", profileConfig);
    try {
      const config = await loadConfig(fx.projectRoot);
      const targets = resolveTargets(config);
      const ids = targets.map((t) => t.id);
      assert.deepEqual(
        ids,
        ["opencode-zai"],
        "only configured profiles should appear as targets",
      );

      const profile = targets.find((t) => t.id === "opencode-zai");
      assert(profile);
      assert.equal(profile!.isProfile, true);
      assert.equal(profile!.paths.projectAgentsDir, fx.profileDest);
      assert.deepEqual(profile!.runEnv, {
        OPENCODE_CONFIG_DIR: path.join(fx.homeDir, ".config", "opencode-zai"),
      });
    } finally {
      await fs.rm(fx.tmpDir, { recursive: true, force: true });
    }
  });

  it("merges global and project canonical agents into one profile destination", async () => {
    const fx = await setupFixture("profile-merge", profileConfig);
    try {
      // Global canonical: ducky and helper
      await writeAgent(
        path.join(fx.homeDir, ".agentctl", "agents"),
        "ducky",
        "Global ducky",
        "global ducky prompt",
      );
      await writeAgent(
        path.join(fx.homeDir, ".agentctl", "agents"),
        "helper",
        "Global helper",
        "global helper prompt",
      );
      // Project canonical: override ducky
      await writeAgent(
        path.join(fx.projectRoot, ".agentctl", "agents"),
        "ducky",
        "Project ducky",
        "project ducky prompt",
      );

      await runProfileSync(fx.projectRoot);

      const duckyPath = path.join(fx.profileDest, "ducky.md");
      const helperPath = path.join(fx.profileDest, "helper.md");
      const ducky = await fs.readFile(duckyPath, "utf-8");
      const helper = await fs.readFile(helperPath, "utf-8");

      assert(
        ducky.includes("project ducky prompt"),
        `project override should win; got:\n${ducky}`,
      );
      assert(ducky.includes("Project ducky"));
      assert(helper.includes("global helper prompt"));
    } finally {
      await fs.rm(fx.tmpDir, { recursive: true, force: true });
    }
  });

  it("restores global version when project override is removed", async () => {
    const fx = await setupFixture("profile-fallback", profileConfig);
    try {
      await writeAgent(
        path.join(fx.homeDir, ".agentctl", "agents"),
        "ducky",
        "Global ducky",
        "global ducky prompt",
      );
      await writeAgent(
        path.join(fx.projectRoot, ".agentctl", "agents"),
        "ducky",
        "Project ducky",
        "project ducky prompt",
      );

      await runProfileSync(fx.projectRoot);
      const duckyPath = path.join(fx.profileDest, "ducky.md");
      let ducky = await fs.readFile(duckyPath, "utf-8");
      assert(ducky.includes("project ducky prompt"));

      // Remove project override
      await fs.rm(path.join(fx.projectRoot, ".agentctl", "agents", "ducky"), {
        recursive: true,
      });

      await runProfileSync(fx.projectRoot);
      ducky = await fs.readFile(duckyPath, "utf-8");
      assert(
        ducky.includes("global ducky prompt"),
        `expected fallback to global; got:\n${ducky}`,
      );
    } finally {
      await fs.rm(fx.tmpDir, { recursive: true, force: true });
    }
  });

  it("deletes the generated file when both layers disappear", async () => {
    const fx = await setupFixture("profile-delete", profileConfig);
    try {
      await writeAgent(
        path.join(fx.homeDir, ".agentctl", "agents"),
        "ducky",
        "Global ducky",
        "global ducky prompt",
      );
      // Also add a second agent so sync runs even after we remove ducky entirely
      await writeAgent(
        path.join(fx.homeDir, ".agentctl", "agents"),
        "keep",
        "Keep me",
        "keep prompt",
      );

      await runProfileSync(fx.projectRoot);
      const duckyPath = path.join(fx.profileDest, "ducky.md");
      await fs.access(duckyPath);

      await fs.rm(path.join(fx.homeDir, ".agentctl", "agents", "ducky"), {
        recursive: true,
      });

      await runProfileSync(fx.projectRoot);
      let deleted = false;
      try {
        await fs.access(duckyPath);
      } catch {
        deleted = true;
      }
      assert(deleted, `expected ${duckyPath} to be deleted`);
    } finally {
      await fs.rm(fx.tmpDir, { recursive: true, force: true });
    }
  });

  it("does not pollute the built-in opencode destination", async () => {
    const fx = await setupFixture("profile-isolation", profileConfig);
    try {
      await writeAgent(
        path.join(fx.projectRoot, ".agentctl", "agents"),
        "ducky",
        "Project ducky",
        "project ducky prompt",
      );

      await runProfileSync(fx.projectRoot);

      // The built-in opencode dir should NOT contain the file — we only synced the profile.
      const builtInProject = path.join(fx.projectRoot, ".opencode", "agents");
      let exists = true;
      try {
        await fs.access(path.join(builtInProject, "ducky.md"));
      } catch {
        exists = false;
      }
      assert(!exists, "built-in opencode dest should be untouched");
    } finally {
      await fs.rm(fx.tmpDir, { recursive: true, force: true });
    }
  });
});
