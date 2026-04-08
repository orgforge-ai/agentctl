import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import stripAnsi from "strip-ansi";

// Project root (one level up from tests/)
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, ".test-output");

// --- Types ---

export interface TestEnv {
  /** Stable output dir: .test-output/{testName}/{harness}/ */
  outputDir: string;
  /** Isolated project dir in /tmp/ (outside repo tree) */
  projectDir: string;
  /** Isolated HOME dir in /tmp/ (outside repo tree) */
  homeDir: string;
  /** Captured terminal output (in outputDir) */
  logPath: string;
  /** Temp dir in /tmp/ to clean up */
  tmpDir: string;
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

  // Wipe previous output, then recreate
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  // Project and home dirs live in /tmp/ so they're outside the repo tree.
  // This prevents harnesses from walking up and finding the real repo's config.
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `agentctl-test-${testName}-${harnessId}-`)
  );
  const projectDir = path.join(tmpDir, "project");
  const homeDir = path.join(tmpDir, "home");

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

  // Seed home dir from harness fixture (onboarding config, settings, etc.)
  await fs.mkdir(homeDir, { recursive: true });
  const homeFixtureDir = path.join(import.meta.dirname, "fixtures", "home", harnessId);
  try {
    await fs.access(homeFixtureDir);
    await fs.cp(homeFixtureDir, homeDir, { recursive: true });
  } catch {
    // No home fixture for this harness — start empty
  }

  // Symlink credentials from real home
  const realClaudeDir = path.join(os.homedir(), ".claude");
  const credsFiles = [".credentials.json", ".credentials.trigger"];
  try {
    await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
    for (const file of credsFiles) {
      const src = path.join(realClaudeDir, file);
      const dest = path.join(homeDir, ".claude", file);
      try {
        await fs.access(src);
        // Don't overwrite if fixture already placed one
        await fs.access(dest);
      } catch {
        try {
          await fs.access(src);
          await fs.symlink(src, dest);
        } catch {
          // Source doesn't exist — skip
        }
      }
    }
  } catch {
    // No credentials — tests that need auth will fail naturally
  }

  // Patch .claude.json with project trust entry (path is dynamic)
  const claudeJsonPath = path.join(homeDir, ".claude.json");
  try {
    const raw = await fs.readFile(claudeJsonPath, "utf-8");
    const claudeJson = JSON.parse(raw);
    claudeJson.projects = claudeJson.projects ?? {};
    claudeJson.projects[projectDir] = {
      allowedTools: [],
      hasTrustDialogAccepted: true,
      hasClaudeMdExternalIncludesApproved: true,
      hasClaudeMdExternalIncludesWarningShown: true,
    };
    await fs.writeFile(claudeJsonPath, JSON.stringify(claudeJson, null, 2) + "\n");
  } catch {
    // No .claude.json — skip patching
  }

  // Log file lives in the stable output dir
  const logPath = path.join(outputDir, "output.log");

  return { outputDir, projectDir, homeDir, logPath, tmpDir };
}

export async function cleanupTestEnv(env: TestEnv): Promise<void> {
  await fs.rm(env.tmpDir, { recursive: true, force: true });
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

  // Unset API keys that could leak from the host environment,
  // then set up isolated HOME/CWD and signal completion with a sentinel file.
  const unsetKeys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ].map((k) => `unset ${k}`).join(" && ");

  execSync(
    `tmux send-keys -t '${session}' ` +
      `'${unsetKeys} && ` +
      `export HOME=${shellEscape(env.homeDir)} && ` +
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

export async function writeCleanLog(logPath: string): Promise<void> {
  const cleanPath = logPath.replace(/\.log$/, ".clean.log");
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    await fs.writeFile(cleanPath, cleanLog(raw));
  } catch {
    // No log file
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

  const testMatch = (text: string): boolean =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);

  while (Date.now() - start < timeout) {
    try {
      const content = cleanLog(await fs.readFile(logPath, "utf-8"));
      if (testMatch(content)) return content;
    } catch {
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

/**
 * Parse a pattern string from case JSON into a string or RegExp.
 * Strings starting and ending with `/` are treated as regex (e.g., "/Claude Code v\\d+/").
 * Flags can be appended after the closing slash (e.g., "/pattern/i").
 */
export function parsePattern(pattern: string): string | RegExp {
  const match = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (match) {
    return new RegExp(match[1], match[2]);
  }
  return pattern;
}

// --- Step execution ---

const DEFAULT_WAIT_TIMEOUT = 15_000;

export async function runSteps(
  steps: Step[],
  session: string,
  logPath: string
): Promise<void> {
  for (const step of steps) {
    if ("wait" in step) {
      await waitForLog(logPath, parsePattern(step.wait), {
        timeoutMs: step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT,
      });
    } else if ("send" in step) {
      // Split on literal \n — text parts sent via -l (literal), newlines sent as Enter
      const parts = step.send.split("\\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          execSync(
            `tmux send-keys -t '${session}' -l '${shellEscape(parts[i])}'`
          );
        }
        if (i < parts.length - 1) {
          execSync(`tmux send-keys -t '${session}' Enter`);
        }
      }
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

export interface StepWait {
  wait: string;
  timeoutMs?: number;
}

export interface StepSend {
  send: string;
}

export type Step = StepWait | StepSend;

export interface TestCaseExpected {
  dryRun?: string | null;
  dryRunNotContains?: string;
  steps?: Step[];
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
