import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  type TestEnv,
  type TestCaseExpected,
  loadCases,
  createTestProject,
  writeCleanLog,
  startSession,
  killSession,
  sendKeys,
  getPanePid,
  waitForLog,
  waitForSessionExit,
  readLog,
  cleanLog,
  assertExitCode,
  assertNoZombies,
  buildCommand,
  isInstalled,
  cleanupOrphanedSessions,
} from "./helpers.js";

// Parse --exclude from argv: --exclude api,slow
const excludeArg = process.argv.find((a) => a.startsWith("--exclude"));
const excludeTags = new Set(
  excludeArg ? excludeArg.split("=").pop()!.split(",") : []
);

// Timeout defaults by tag
function getTimeout(tags?: string[]): number {
  if (tags?.includes("slow")) return 60_000;
  if (tags?.includes("interactive")) return 15_000;
  if (tags?.includes("signal")) return 15_000;
  return 5_000;
}

// --- Main ---

const cases = await loadCases();

before(() => {
  // tmux is required
  assert(isInstalled("tmux"), "tmux is required for integration tests");

  // Clean up any orphaned sessions from prior runs
  cleanupOrphanedSessions();

  // Log which harnesses are available
  for (const h of ["claude", "opencode"]) {
    if (isInstalled(h)) {
      console.log(`  \u2713 ${h} installed`);
    } else {
      console.log(`  \u2717 ${h} not installed \u2014 tests for this harness will skip`);
    }
  }
});

for (const testCase of cases) {
  // Check if any tags are excluded
  if (testCase.tags?.some((t) => excludeTags.has(t))) {
    continue;
  }

  describe(testCase.name, () => {
    // Determine which harnesses to test
    const harnesses = testCase.expected._global
      ? [{ id: "_global", expected: testCase.expected._global }]
      : Object.entries(testCase.expected).map(([id, exp]) => ({
          id,
          expected: exp as TestCaseExpected,
        }));

    for (const { id: harnessId, expected } of harnesses) {
      describe(`[${harnessId}]`, () => {
        let env: TestEnv;
        let session: string | undefined;

        before(async () => {
          // Skip if harness binary not installed (unless _global test)
          if (harnessId !== "_global" && !isInstalled(harnessId)) {
            return;
          }
          env = await createTestProject(
            testCase.name,
            harnessId,
            testCase.fixture ?? "basic"
          );
        });

        after(async () => {
          // Capture rendered screen before killing the session
          if (session && env) await writeCleanLog(session, env.logPath);
          if (session) killSession(session);
        });

        // --- Dry-run test ---
        if (!testCase.skipDryRun && expected.dryRun) {
          it("dry-run output matches", async (t) => {
            if (harnessId !== "_global" && !isInstalled(harnessId)) {
              t.skip(`${harnessId} not installed`);
              return;
            }

            const cmd =
              buildCommand(testCase.command, harnessId, env) + " --dry-run";
            session = await startSession(
              cmd + " ; echo AGENTCTL_EXIT=$?",
              env
            );

            await waitForSessionExit(session, { timeoutMs: 5_000 });
            const log = cleanLog(await readLog(env.logPath));

            assert(
              log.includes(expected.dryRun!),
              `Expected dry-run to contain: ${expected.dryRun}\nGot: ${log}`
            );

            if (expected.dryRunNotContains) {
              assert(
                !log.includes(expected.dryRunNotContains),
                `Expected dry-run NOT to contain: ${expected.dryRunNotContains}\nGot: ${log}`
              );
            }

            assertExitCode(log, expected.exitCode ?? 0);
          });
        }

        // --- Live test ---
        if (!testCase.skipLive) {
          it("live execution matches", async (t) => {
            if (harnessId !== "_global" && !isInstalled(harnessId)) {
              t.skip(`${harnessId} not installed`);
              return;
            }
            if (expected.xfail) {
              t.todo(expected.xfail);
              return;
            }

            const timeout = getTimeout(testCase.tags);
            const cmd = buildCommand(testCase.command, harnessId, env);

            if (expected.error) {
              // Error case — expect failure message and exit code
              session = await startSession(
                cmd + " ; echo AGENTCTL_EXIT=$?",
                env
              );
              await waitForLog(env.logPath, expected.error, {
                timeoutMs: timeout,
              });
              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/, {
                timeoutMs: 5_000,
              });
              const log = cleanLog(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 1);
            } else if (testCase.tags?.includes("signal")) {
              // Signal test — start, optionally wait for prompt, send signal, check exit
              session = await startSession(
                cmd + " ; echo AGENTCTL_EXIT=$?",
                env
              );

              if (expected.live) {
                await waitForLog(env.logPath, expected.live, {
                  timeoutMs: timeout,
                });
              }

              // Record pane PID before signal
              const panePid = getPanePid(session!);

              sendKeys(session!, expected.signal ?? "C-c");

              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/, {
                timeoutMs: 5_000,
              });
              const log = cleanLog(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 0);

              // Check no zombie processes
              await assertNoZombies(session!);
            } else if (testCase.tags?.includes("interactive")) {
              // Interactive test — just verify session starts
              session = await startSession(cmd, env);

              if (expected.live) {
                await waitForLog(env.logPath, expected.live, {
                  timeoutMs: timeout,
                });
              }
              // Session started — test passes, kill it in after()
            } else {
              // Headless — wait for completion
              session = await startSession(
                cmd + " ; echo AGENTCTL_EXIT=$?",
                env
              );

              if (expected.live) {
                await waitForLog(env.logPath, expected.live, {
                  timeoutMs: timeout,
                });
              }

              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/, {
                timeoutMs: timeout,
              });
              const log = cleanLog(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 0);
            }
          });
        }
      });
    }
  });
}
