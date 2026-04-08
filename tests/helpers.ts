import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import stripAnsi from "strip-ansi";

// Project root (one level up from tests/)
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, ".test-output");

// --- Types ---

export interface TestEnv {
  /** Stable output dir: .test-output/{testName}/{harness}/ */
  outputDir: string;
  /** Isolated project dir (fixture copy) inside outputDir */
  projectDir: string;
  /** Isolated HOME dir inside outputDir */
  homeDir: string;
  /** Captured terminal output */
  logPath: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
}

// Convert cursor-movement sequences to spaces, then strip remaining ANSI
export function cleanLog(text: string): string {
  const processed = text
    // Cursor forward [<n>C → <n> spaces (before stripping, so spacing is preserved)
    .replace(/\x1b\[(\d+)C/g, (_match, n) => " ".repeat(parseInt(n)))
    // Private-mode CSI sequences: ESC [ ? ... or ESC [ > ... (kitty protocol, DECLL, etc.)
    .replace(/\x1b\[[>?][0-9;]*[a-zA-Z]/g, "")
    // DCS and other ESC sequences strip-ansi may miss
    .replace(/\x1b[P^_][^\x1b]*\x1b\\/g, "")
    // Stray CSI fragments (e.g., partial sequences)
    .replace(/\x1b\[[\d;]*$/gm, "");
  return stripAnsi(processed);
}

export { stripAnsi };

// --- Sleep ---

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Binary detection ---

export function isInstalled(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// --- Fixture management ---

export async function createTestProject(
  testName: string,
  harnessId: string,
  fixture: string = "basic"
): Promise<TestEnv> {
  const outputDir = path.join(OUTPUT_DIR, testName, harnessId);

  // Wipe previous run, then recreate
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const projectDir = path.join(outputDir, "project");
  const homeDir = path.join(outputDir, "home");

  // Copy fixture to project dir
  await fs.cp(
    path.join(import.meta.dirname, "fixtures", "projects", fixture),
    projectDir,
    { recursive: true }
  );

  // Copy shared files into project dir (e.g., prompt.txt)
  const filesDir = path.join(import.meta.dirname, "fixtures", "files");
  try {
    const files = await fs.readdir(filesDir);
    for (const file of files) {
      await fs.cp(
        path.join(filesDir, file),
        path.join(projectDir, file),
        { recursive: true }
      );
    }
  } catch {
    // No files dir — that's fine
  }

  // Create empty home dir
  await fs.mkdir(homeDir, { recursive: true });

  // Log file lives at top of output dir
  const logPath = path.join(outputDir, "output.log");

  return { outputDir, projectDir, homeDir, logPath };
}

// --- tmux session management ---

function shellEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

export async function startSession(
  cmd: string,
  env: TestEnv
): Promise<string> {
  const session = `agentctl-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const sentinelFile = path.join(env.outputDir, ".setup-done");

  // Create detached session with fixed dimensions
  execSync(`tmux new-session -d -s '${session}' -x 120 -y 40`);

  // Set up environment and signal completion with a sentinel file.
  // All setup runs in one send-keys so there's only one prompt cycle.
  execSync(
    `tmux send-keys -t '${session}' ` +
      `'export HOME=${shellEscape(env.homeDir)} && ` +
      `cd ${shellEscape(env.projectDir)} && ` +
      `touch ${shellEscape(sentinelFile)}' Enter`
  );

  // Wait for sentinel file to appear (setup complete)
  const setupTimeout = 5_000;
  const start = Date.now();
  while (Date.now() - start < setupTimeout) {
    try {
      await fs.access(sentinelFile);
      break;
    } catch {
      await sleep(50);
    }
  }

  // Attach log capture (only captures the test command)
  execSync(
    `tmux pipe-pane -o -t '${session}' 'cat >> ${shellEscape(env.logPath)}'`
  );

  // Send command
  execSync(
    `tmux send-keys -t '${session}' '${shellEscape(cmd)}' Enter`
  );

  return session;
}

export function killSession(session: string): void {
  try {
    execSync(`tmux kill-session -t '${session}' 2>/dev/null`);
  } catch {
    // Session already dead
  }
}

export function sendKeys(session: string, keys: string): void {
  execSync(`tmux send-keys -t '${session}' ${keys}`);
}

export function getPanePid(session: string): string | null {
  try {
    return execSync(
      `tmux list-panes -t '${session}' -F '#{pane_pid}'`,
      { encoding: "utf-8" }
    ).trim();
  } catch {
    return null;
  }
}

// --- Log reading and polling ---

export async function readLog(logPath: string): Promise<string> {
  try {
    return await fs.readFile(logPath, "utf-8");
  } catch {
    return "";
  }
}

export async function writeCleanLog(
  session: string,
  logPath: string
): Promise<void> {
  const cleanPath = logPath.replace(/\.log$/, ".clean.log");
  try {
    // capture-pane renders the composited screen (cursor positioning resolved)
    const content = execSync(
      `tmux capture-pane -t '${session}' -p -S - -E -`,
      { encoding: "utf-8" }
    );
    await fs.writeFile(cleanPath, content);
  } catch {
    // Session already dead — fall back to stripping the raw log
    try {
      const raw = await fs.readFile(logPath, "utf-8");
      await fs.writeFile(cleanPath, cleanLog(raw));
    } catch {
      // No log file either
    }
  }
}

export async function waitForLog(
  logPath: string,
  pattern: string | RegExp,
  options?: WaitOptions
): Promise<string> {
  const timeout = options?.timeoutMs ?? 15_000;
  const poll = options?.pollMs ?? 200;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const content = cleanLog(await fs.readFile(logPath, "utf-8"));
      const match =
        typeof pattern === "string"
          ? content.includes(pattern)
          : pattern.test(content);
      if (match) return content;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // File doesn't exist yet — keep polling
    }
    await sleep(poll);
  }

  // Timeout — read final state for error message
  const finalContent = await fs
    .readFile(logPath, "utf-8")
    .catch(() => "(no log file)");
  throw new Error(
    `waitForLog timed out after ${timeout}ms.\n` +
      `Pattern: ${pattern}\n` +
      `Log content:\n${cleanLog(finalContent)}`
  );
}

export async function waitForSessionExit(
  session: string,
  options?: WaitOptions
): Promise<void> {
  const timeout = options?.timeoutMs ?? 15_000;
  const poll = options?.pollMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      execSync(`tmux has-session -t '${session}' 2>/dev/null`);
    } catch {
      // Session is gone
      return;
    }
    await sleep(poll);
  }

  throw new Error(`Session ${session} did not exit within ${timeout}ms`);
}

// --- Assertions ---

export function assertExitCode(log: string, expected: number): void {
  const match = log.match(/AGENTCTL_EXIT=(\d+)/);
  if (!match) {
    throw new Error(`No exit code found in log:\n${log}`);
  }
  const actual = parseInt(match[1]);
  if (actual !== expected) {
    throw new Error(`Expected exit code ${expected}, got ${actual}`);
  }
}

export async function assertNoZombies(session: string): Promise<void> {
  // Get pane PID before session is fully gone
  const pid = getPanePid(session);
  if (!pid) return; // Session already gone, can't check

  // Wait a moment for cleanup
  await sleep(500);

  try {
    execSync(`kill -0 ${pid} 2>/dev/null`);
    throw new Error(`Zombie process detected: ${pid}`);
  } catch (err) {
    // kill -0 failed = process is gone = good
    if (err instanceof Error && err.message.includes("Zombie")) {
      throw err;
    }
  }
}

// --- Command building ---

export function buildCommand(
  template: string,
  harnessId: string,
  env: TestEnv
): string {
  return template
    .replace(/\{harness\}/g, harnessId)
    .replace(/\{fixture\}/g, env.projectDir)
    .replace(/\{prompt_file\}/g, path.join(env.projectDir, "prompt.txt"));
}

// --- Pre-test cleanup ---

export function cleanupOrphanedSessions(): void {
  try {
    const sessions = execSync(
      "tmux list-sessions -F '#{session_name}' 2>/dev/null",
      { encoding: "utf-8" }
    );
    for (const session of sessions.split("\n")) {
      if (session.startsWith("agentctl-test-")) {
        try {
          execSync(`tmux kill-session -t '${session}' 2>/dev/null`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // No tmux server running
  }
}

// --- Case loading ---

export interface TestCaseExpected {
  dryRun?: string | null;
  dryRunNotContains?: string;
  live?: string | null;
  exitCode?: number;
  error?: string;
  signal?: string;
  xfail?: string;
}

export interface TestCase {
  name: string;
  description: string;
  command: string;
  fixture?: string;
  tags?: string[];
  skipDryRun?: boolean;
  skipLive?: boolean;
  expected: Record<string, TestCaseExpected>;
}

export async function loadCases(): Promise<TestCase[]> {
  const casesDir = path.join(import.meta.dirname, "cases");
  const entries = await fs.readdir(casesDir);
  const jsonFiles = entries.filter((f) => f.endsWith(".json")).sort();

  const cases: TestCase[] = [];
  for (const file of jsonFiles) {
    const content = await fs.readFile(path.join(casesDir, file), "utf-8");
    cases.push(JSON.parse(content));
  }
  return cases;
}
