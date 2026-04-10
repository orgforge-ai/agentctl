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

  it("does not report globally synced agents as unmanaged", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentctl-doctor-"));
    const projectRoot = path.join(tmpDir, "project");
    const homeDir = path.join(tmpDir, "home");

    // Set up project with .git
    await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });

    // Set up global agentctl config
    await fs.mkdir(path.join(homeDir, ".agentctl", "state"), { recursive: true });
    await fs.mkdir(path.join(homeDir, ".agentctl", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".agentctl", "config.json"),
      JSON.stringify({ version: 1 }, null, 2) + "\n",
      "utf-8",
    );

    // Set up a global agent source
    await fs.writeFile(
      path.join(homeDir, ".agentctl", "agents", "ducky.md"),
      "# Ducky\nA test agent.\n",
      "utf-8",
    );

    // Set up a Claude Code harness with the agent installed
    await fs.mkdir(path.join(homeDir, ".claude", "agents"), { recursive: true });
    const agentFilePath = path.join(homeDir, ".claude", "agents", "ducky.md");
    await fs.writeFile(agentFilePath, "# Ducky\nA test agent.\n", "utf-8");

    // Write a global sync manifest that marks ducky as managed
    await fs.writeFile(
      path.join(homeDir, ".agentctl", "state", "global-sync.json"),
      JSON.stringify({
        version: 1,
        projectId: "global",
        entries: [
          {
            agentName: "ducky",
            harnessId: "claude",
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
