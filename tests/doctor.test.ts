import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDoctor } from "../src/cli/doctor.js";

const originalCwd = process.cwd();
const originalHome = process.env.HOME;

async function withCapturedConsole<T>(
  fn: () => Promise<T>,
): Promise<{ lines: string[]; result: T }> {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  try {
    const result = await fn();
    return { lines, result };
  } finally {
    console.log = originalLog;
  }
}

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe("runDoctor", () => {
  it("reports config sources clearly when project .agentctl is missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentctl-doctor-"));
    const projectRoot = path.join(tmpDir, "project");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
    await fs.mkdir(path.join(homeDir, ".agentctl"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".agentctl", "config.json"),
      JSON.stringify({ version: 1 }, null, 2) + "\n",
      "utf-8",
    );

    process.chdir(projectRoot);
    process.env.HOME = homeDir;

    const { lines } = await withCapturedConsole(async () => {
      await runDoctor();
    });

    assert(lines.some((line) => line.includes("Config")));
    assert(
      lines.some((line) => line.includes("Loaded built-in defaults + global")),
      `Expected config sources in output.\n${lines.join("\n")}`,
    );
    assert(
      lines.some((line) => line.includes(`No .agentctl/ found at ${projectRoot}`)),
      `Expected missing project warning in output.\n${lines.join("\n")}`,
    );
    assert(
      !lines.some((line) => line.includes(`Loaded from ${path.join(projectRoot, ".agentctl")}`)),
      `Unexpected misleading project config message.\n${lines.join("\n")}`,
    );

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists profile-managed agents as managed", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentctl-doctor-"));
    const projectRoot = path.join(tmpDir, "project");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
    const profileDest = path.join(projectRoot, ".claude-test", "agents");
    await fs.mkdir(profileDest, { recursive: true });

    // Global agentctl config defines a profile target
    await fs.mkdir(path.join(homeDir, ".agentctl"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".agentctl", "config.json"),
      JSON.stringify(
        {
          version: 1,
          harnesses: {
            "claude-test": {
              adapter: "claude",
              paths: { projectAgentsDir: ".claude-test/agents" },
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    // Pretend a previous sync wrote ducky into the profile dest.
    const agentFilePath = path.join(profileDest, "ducky.md");
    await fs.writeFile(agentFilePath, "# Ducky\n", "utf-8");

    // Project-scoped manifest keyed by target id.
    const projectKey = (await import("node:crypto"))
      .createHash("sha256")
      .update(projectRoot)
      .digest("hex")
      .slice(0, 16);
    await fs.mkdir(path.join(homeDir, ".agentctl", "state"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".agentctl", "state", `${projectKey}.json`),
      JSON.stringify({
        version: 1,
        projectId: projectKey,
        entries: [
          {
            agentName: "ducky",
            harnessId: "claude-test",
            filePath: agentFilePath,
            contentHash: "abc123",
            syncedAt: new Date().toISOString(),
          },
        ],
      }),
      "utf-8",
    );

    process.chdir(projectRoot);
    process.env.HOME = homeDir;

    const { lines } = await withCapturedConsole(async () => {
      await runDoctor();
    });

    const duckyLine = lines.find((line) => line.includes("ducky") && line.includes("managed"));
    assert(
      duckyLine !== undefined,
      `Expected ducky agent listed under harness:\n${lines.join("\n")}`,
    );
    assert(
      duckyLine.includes("managed") && !duckyLine.includes("unmanaged"),
      `Expected ducky to be managed, not unmanaged:\n${duckyLine}`,
    );

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
