# Test Infrastructure Design

## Overview

Integration tests for `agentctl run` use real harness binaries inside real PTY sessions. The infrastructure manages tmux session lifecycle, output capture, fixture isolation, and assertion against captured logs.

```
┌─────────────────────────────────────────────────┐
│  Test Runner (node:test)                        │
│                                                 │
│  for each case.json:                            │
│    for each harness in case.expected:           │
│      ┌──────────────────────────────────────┐   │
│      │  Test Environment                    │   │
│      │                                      │   │
│      │  HOME=/tmp/test-xxxxx/home (empty)   │   │
│      │  CWD=/tmp/test-xxxxx/project         │   │
│      │      └── .agentctl/ (from fixture)   │   │
│      │                                      │   │
│      │  ┌────────────────────────────────┐  │   │
│      │  │  tmux session                  │  │   │
│      │  │                                │  │   │
│      │  │  $ agentctl run -h claude ...  │  │   │
│      │  │         │                      │  │   │
│      │  │         ├── pipe-pane ──► log  │  │   │
│      │  │         │               file   │  │   │
│      │  │         └── real PTY           │  │   │
│      │  └────────────────────────────────┘  │   │
│      │                                      │   │
│      │  assertions against log file         │   │
│      └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## File structure

```
tests/
  TESTPLAN.md               # test case definitions (what to test)
  DESIGN.md                 # this file (how it works)
  runner.ts                 # test runner: loads cases, orchestrates execution
  helpers.ts                # tmux management, log polling, fixtures
  cases/
    01-bare-interactive.json
    02-interactive-agent.json
    ...
  fixtures/
    projects/
      basic/
        .agentctl/
          config.json
          agents/
            reviewer/
              agent.json
              prompt.md
      custom-models/
        .agentctl/
          config.json
          models.json
          agents/
            reviewer/
              agent.json
              prompt.md
    files/
      prompt.txt            # "respond with exactly: FILE_TEST_OK"
```

---

## tmux Session Lifecycle

### Why tmux

The harness binaries (`claude`, `opencode`) are interactive CLI tools that expect a real terminal. A plain `child_process.spawn()` without a PTY would cause them to behave differently or fail. tmux allocates a real PTY, and `pipe-pane` gives us a persistent log of everything printed — no timing races with `capture-pane`.

### Session creation

Each test run gets a unique tmux session. Session names include the test name and harness to avoid collisions when running in parallel (future).

```bash
SESSION="agentctl-test-${testName}-${harness}-${pid}"
LOG="/tmp/${SESSION}.log"

# Create detached session with fixed dimensions for deterministic output
tmux new-session -d -s "$SESSION" -x 120 -y 40

# Set up environment inside the session
tmux send-keys -t "$SESSION" "export HOME=$ISOLATED_HOME" Enter
tmux send-keys -t "$SESSION" "cd $PROJECT_DIR" Enter

# Pipe all pane output to log file
tmux pipe-pane -o -t "$SESSION" "cat >> $LOG"

# Send the actual command
tmux send-keys -t "$SESSION" "$COMMAND 2>&1" Enter
```

### Why `send-keys` for env setup (not tmux `set-environment`)

`tmux set-environment` only affects new windows/panes, not the current shell. Setting `HOME` and `cd`-ing via `send-keys` ensures the shell session itself has the right environment. The `pipe-pane` is attached after env setup so the setup commands don't pollute the log.

Alternative: attach `pipe-pane` after setup commands but before the test command. There's a small race here — the approach is to add a short `sleep 0.1` between setup and pipe-pane attachment, or use a sentinel:

```bash
# Setup env (not logged)
tmux send-keys -t "$SESSION" "export HOME=$ISOLATED_HOME && cd $PROJECT_DIR" Enter

# Small delay to let setup complete
sleep 0.2

# Now attach pipe-pane (only captures test command output)
tmux pipe-pane -o -t "$SESSION" "cat >> $LOG"

# Send test command
tmux send-keys -t "$SESSION" "$COMMAND 2>&1" Enter
```

### Output capture via pipe-pane

`tmux pipe-pane -o` pipes the pane's output (what the PTY produces) to a command. We use `cat >> $LOG` to append to a file.

Key properties:
- **Persistent** — captures everything, not just what's visible in the pane buffer
- **Streaming** — log file grows as output arrives, enabling polling
- **Complete** — includes control characters/ANSI escapes (tests should strip or tolerate them)

### ANSI escape handling

Harness output will contain ANSI color codes, cursor movement, etc. The log file captures raw terminal output. Helpers should provide:

```typescript
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
```

All pattern matching in assertions should run against stripped content.

### Session teardown

```bash
# Kill the session (and all processes in it)
tmux kill-session -t "$SESSION" 2>/dev/null

# Clean up log file
rm -f "$LOG"
```

Teardown runs in a `finally` block / `afterEach` — always executes regardless of test outcome.

### Zombie process detection

For signal tests, after killing the session:

```bash
# Check no child processes survived
# (record the pane PID before sending signal)
PANE_PID=$(tmux list-panes -t "$SESSION" -F '#{pane_pid}')
# ... send signal, wait for session to close ...
# Verify process is gone
if kill -0 "$PANE_PID" 2>/dev/null; then
  fail("zombie process detected: $PANE_PID")
fi
```

---

## Log Polling

### waitForLog

The core primitive. Polls the log file until a pattern appears or timeout is reached.

```typescript
async function waitForLog(
  logPath: string,
  pattern: string | RegExp,
  options?: { timeoutMs?: number; pollMs?: number }
): Promise<string> {
  const timeout = options?.timeoutMs ?? 15_000;
  const poll = options?.pollMs ?? 200;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const content = stripAnsi(await fs.readFile(logPath, "utf-8"));
      const match = typeof pattern === "string"
        ? content.includes(pattern)
        : pattern.test(content);
      if (match) return content;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      // File doesn't exist yet — keep polling
    }
    await sleep(poll);
  }

  // Timeout — read final state for error message
  const finalContent = await fs.readFile(logPath, "utf-8").catch(() => "(no log file)");
  throw new Error(
    `waitForLog timed out after ${timeout}ms.\n` +
    `Pattern: ${pattern}\n` +
    `Log content:\n${finalContent}`
  );
}
```

### waitForSessionExit

For tests where the process should exit (dry-run, errors, headless completion):

```typescript
async function waitForSessionExit(
  session: string,
  options?: { timeoutMs?: number; pollMs?: number }
): Promise<void> {
  const timeout = options?.timeoutMs ?? 15_000;
  const poll = options?.pollMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = execSync(
      `tmux has-session -t ${session} 2>&1 || echo GONE`,
      { encoding: "utf-8" }
    );
    if (result.includes("GONE")) return;
    await sleep(poll);
  }

  throw new Error(`Session ${session} did not exit within ${timeout}ms`);
}
```

### Exit code capture

The command is wrapped to capture the exit code in the log:

```bash
# Instead of:
agentctl run -h claude --headless --prompt "x"

# Send:
agentctl run -h claude --headless --prompt "x" ; echo "AGENTCTL_EXIT=$?"
```

Then assert:

```typescript
const log = await readLog(logPath);
const match = log.match(/AGENTCTL_EXIT=(\d+)/);
assert.equal(parseInt(match[1]), expectedExitCode);
```

---

## Test Isolation

### HOME override

Every test sets `HOME` to an empty temp directory. This isolates from:
- `~/.agentctl/config.json` (global config)
- `~/.agentctl/models.json` (global model overrides)
- `~/.agentctl/state/` (sync manifests)

Without this, a developer's personal config could make model mapping tests pass/fail depending on the machine.

### Project directory

Each test copies a fixture into a fresh temp directory. This ensures:
- `findProjectRoot()` resolves to the temp dir (the fixture includes `.agentctl/`)
- No state leaks between tests
- Fixtures are read-only templates

```typescript
async function createTestProject(fixture: string = "basic"): Promise<TestEnv> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentctl-test-"));
  const projectDir = path.join(tmpDir, "project");
  const homeDir = path.join(tmpDir, "home");

  // Copy fixture to project dir
  await fs.cp(
    path.join(__dirname, "fixtures", "projects", fixture),
    projectDir,
    { recursive: true }
  );

  // Create empty home dir
  await fs.mkdir(homeDir, { recursive: true });

  // Create log path
  const logPath = path.join(tmpDir, "output.log");

  return { tmpDir, projectDir, homeDir, logPath };
}
```

### Cleanup

```typescript
async function cleanupTestEnv(env: TestEnv): Promise<void> {
  await fs.rm(env.tmpDir, { recursive: true, force: true });
}
```

---

## Test Runner

### Framework

Uses Node's built-in `node:test` module with `tsx` for TypeScript. Zero external test dependencies.

```json
// package.json
{
  "scripts": {
    "test": "tsx --test tests/runner.ts",
    "test:fast": "tsx --test tests/runner.ts --exclude api,slow",
    "test:dry-run-only": "tsx --test tests/runner.ts --exclude api,slow,interactive,signal"
  }
}
```

### Case loading and execution

```typescript
import { describe, it, before, after } from "node:test";
import { glob } from "node:fs/promises";

// Load all case files
const caseFiles = await glob("tests/cases/*.json");
const cases = await Promise.all(
  caseFiles.map(async (f) => JSON.parse(await fs.readFile(f, "utf-8")))
);

for (const testCase of cases) {
  describe(testCase.name, () => {
    // Determine which harnesses to test
    const harnesses = testCase.expected._global
      ? [{ id: "_global", expected: testCase.expected._global }]
      : Object.entries(testCase.expected).map(
          ([id, exp]) => ({ id, expected: exp })
        );

    for (const { id: harnessId, expected } of harnesses) {
      describe(`[${harnessId}]`, () => {
        let env: TestEnv;
        let session: string;

        before(async () => {
          // Skip if binary not installed (unless error/dry-run test)
          if (harnessId !== "_global" && !testCase.skipDryRun) {
            // dry-run doesn't need binary
          } else if (harnessId !== "_global" && !isInstalled(harnessId)) {
            return; // skip
          }
          env = await createTestProject(testCase.fixture);
        });

        after(async () => {
          if (session) await killSession(session);
          if (env) await cleanupTestEnv(env);
        });

        // Dry-run test
        if (!testCase.skipDryRun && expected.dryRun) {
          it("dry-run output matches", async () => {
            const cmd = buildCommand(testCase.command, harnessId, env) + " --dry-run";
            session = await startSession(cmd, env);
            await waitForSessionExit(session);
            const log = stripAnsi(await readLog(env.logPath));

            assert(log.includes(expected.dryRun),
              `Expected dry-run to contain: ${expected.dryRun}\nGot: ${log}`);

            if (expected.dryRunNotContains) {
              assert(!log.includes(expected.dryRunNotContains),
                `Expected dry-run NOT to contain: ${expected.dryRunNotContains}\nGot: ${log}`);
            }
          });
        }

        // Live test
        if (!testCase.skipLive) {
          it("live execution matches", async (t) => {
            if (expected.xfail) {
              t.todo(expected.xfail); // mark as known failure
            }

            const cmd = buildCommand(testCase.command, harnessId, env);
            session = await startSession(cmd + " ; echo AGENTCTL_EXIT=$?", env);

            if (expected.error) {
              await waitForLog(env.logPath, expected.error);
              // Check exit code
              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/);
              const log = stripAnsi(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 1);

            } else if (testCase.tags?.includes("signal")) {
              // Wait for session to start
              if (expected.live) {
                await waitForLog(env.logPath, expected.live);
              }
              // Send signal
              sendKeys(session, expected.signal ?? "C-c");
              // Wait for exit
              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/);
              const log = stripAnsi(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 0);
              // Check no zombies
              await assertNoZombies(session);

            } else if (testCase.tags?.includes("interactive")) {
              // Wait for session to appear
              if (expected.live) {
                await waitForLog(env.logPath, expected.live);
              }
              // Session started — test passes, kill it

            } else {
              // Headless — wait for completion
              if (expected.live) {
                await waitForLog(env.logPath, expected.live);
              }
              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/);
              const log = stripAnsi(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 0);
            }
          });
        }
      });
    }
  });
}
```

### Command template substitution

```typescript
function buildCommand(
  template: string,
  harnessId: string,
  env: TestEnv
): string {
  return template
    .replace(/\{harness\}/g, harnessId)
    .replace(/\{fixture\}/g, env.projectDir)
    .replace(/\{prompt_file\}/g, path.join(env.projectDir, "prompt.txt"));
}
```

### Helper: startSession

```typescript
async function startSession(cmd: string, env: TestEnv): Promise<string> {
  const session = `agentctl-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Create session
  execSync(`tmux new-session -d -s ${session} -x 120 -y 40`);

  // Set up environment (before pipe-pane to keep setup out of log)
  execSync(`tmux send-keys -t ${session} 'export HOME=${env.homeDir}' Enter`);
  execSync(`tmux send-keys -t ${session} 'cd ${env.projectDir}' Enter`);

  // Brief pause for env setup to complete
  await sleep(300);

  // Attach log capture
  execSync(`tmux pipe-pane -o -t ${session} 'cat >> ${env.logPath}'`);

  // Send command
  execSync(`tmux send-keys -t ${session} '${escapeSingleQuotes(cmd)}' Enter`);

  return session;
}
```

### Helper: sendKeys

```typescript
function sendKeys(session: string, keys: string): void {
  execSync(`tmux send-keys -t ${session} ${keys}`);
}
```

### Helper: assertExitCode

```typescript
function assertExitCode(log: string, expected: number): void {
  const match = log.match(/AGENTCTL_EXIT=(\d+)/);
  assert(match, `No exit code found in log:\n${log}`);
  assert.equal(parseInt(match[1]), expected,
    `Expected exit code ${expected}, got ${match[1]}`);
}
```

---

## Timeouts

| Scenario | Default timeout | Rationale |
|---|---|---|
| Dry-run | 5s | Should exit immediately |
| Error cases | 5s | Fail before spawn |
| Interactive start | 15s | Binary startup can be slow |
| Headless (API) | 60s | API latency + model response |
| Signal cleanup | 5s | Should terminate quickly |
| Session exit | 15s | Graceful shutdown |

Timeouts are configurable per test via tags or explicit override in the case JSON.

---

## CI Considerations

### Prerequisites check

Runner verifies before starting:

```typescript
before(async () => {
  // tmux is required
  assert(isInstalled("tmux"), "tmux is required for integration tests");

  // Log which harnesses are available
  for (const h of ["claude", "opencode"]) {
    if (isInstalled(h)) {
      console.log(`  ✓ ${h} installed`);
    } else {
      console.log(`  ✗ ${h} not installed — tests for this harness will skip`);
    }
  }
});
```

### Parallel safety

Session names include PID and random suffix. Log files are in per-test temp dirs. No shared state between tests. Safe to run with `--concurrency` in the future.

### Cleanup on failure

If CI is interrupted (SIGKILL), orphaned tmux sessions may remain. Add a pre-test cleanup:

```bash
# Kill any leftover test sessions
tmux list-sessions -F '#{session_name}' 2>/dev/null \
  | grep '^agentctl-test-' \
  | xargs -I{} tmux kill-session -t {} 2>/dev/null
```
