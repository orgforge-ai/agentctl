import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  type TestEnv,
  type TestCaseExpected,
  loadCases,
  createTestProject,
  cleanupTestEnv,
  writeCleanLog,
  parsePattern,
  runSteps,
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

function assertContains(
  text: string,
  pattern: string | RegExp,
  label: string
): void {
  const ok =
    typeof pattern === "string"
      ? text.includes(pattern)
      : pattern.test(text);
  assert(ok, `Expected ${label} to match: ${pattern}\nGot: ${text}`);
}

function assertNotContains(
  text: string,
  pattern: string | RegExp,
  label: string
): void {
  const found =
    typeof pattern === "string"
      ? text.includes(pattern)
      : pattern.test(text);
  assert(!found, `Expected ${label} NOT to match: ${pattern}\nGot: ${text}`);
}

// --- Main ---

const cases = await loadCases();

before(() => {
  assert(isInstalled("tmux"), "tmux is required for integration tests");
  cleanupOrphanedSessions();

  for (const h of ["claude", "opencode"]) {
    if (isInstalled(h)) {
      console.log(`  \u2713 ${h} installed`);
    } else {
      console.log(`  \u2717 ${h} not installed \u2014 tests for this harness will skip`);
    }
  }
});

for (const testCase of cases) {
  if (testCase.tags?.some((t) => excludeTags.has(t))) {
    continue;
  }

  describe(testCase.name, () => {
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
          if (env) await writeCleanLog(env.logPath);
          if (session) killSession(session);
          if (env) await cleanupTestEnv(env);
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

            assertContains(log, parsePattern(expected.dryRun!), "dry-run");

            if (expected.dryRunNotContains) {
              assertNotContains(
                log,
                parsePattern(expected.dryRunNotContains),
                "dry-run"
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

            const cmd = buildCommand(testCase.command, harnessId, env);

            if (expected.error) {
              session = await startSession(
                cmd + " ; echo AGENTCTL_EXIT=$?",
                env
              );
              await waitForLog(env.logPath, parsePattern(expected.error), {
                timeoutMs: 5_000,
              });
              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/, {
                timeoutMs: 5_000,
              });
              const log = cleanLog(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 1);
            } else if (testCase.tags?.includes("signal")) {
              session = await startSession(
                cmd + " ; echo AGENTCTL_EXIT=$?",
                env
              );

              if (expected.steps) {
                await runSteps(expected.steps, session!, env.logPath);
              }

              const panePid = getPanePid(session!);
              sendKeys(session!, expected.signal ?? "C-c");

              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/, {
                timeoutMs: 5_000,
              });
              const log = cleanLog(await readLog(env.logPath));
              assertExitCode(log, expected.exitCode ?? 0);
              await assertNoZombies(session!);
            } else if (testCase.tags?.includes("interactive")) {
              session = await startSession(cmd, env);

              if (expected.steps) {
                await runSteps(expected.steps, session!, env.logPath);
              }
            } else {
              // Headless — wait for completion
              session = await startSession(
                cmd + " ; echo AGENTCTL_EXIT=$?",
                env
              );

              if (expected.steps) {
                await runSteps(expected.steps, session!, env.logPath);
              }

              await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/, {
                timeoutMs: 15_000,
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
