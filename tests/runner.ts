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

// Parse exclude tags from EXCLUDE_TAGS env var (argv is consumed by tsx --test)
const excludeTags = new Set(
  process.env.EXCLUDE_TAGS ? process.env.EXCLUDE_TAGS.split(",") : []
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
      const harnessNotInstalled =
        harnessId !== "_global" && !isInstalled(harnessId);

      describe(`[${harnessId}]`, { skip: harnessNotInstalled ? `${harnessId} not installed` : undefined }, () => {
        let env: TestEnv;
        let session: string | undefined;

        before(async () => {
          env = await createTestProject(
            testCase.name,
            harnessId,
            testCase.fixture ?? "basic"
          );
        });

        after(async () => {
          if (session && env) await writeCleanLog(env.logPath, session);
          if (session) killSession(session);
          if (env) await cleanupTestEnv(env);
        });

        // --- Dry-run test ---
        if (!testCase.skipDryRun && expected.dryRun) {
          it("dry-run output matches", async () => {
            const cmd =
              buildCommand(testCase.command, harnessId, env) + " --dry-run";
            session = await startSession(
              cmd + " ; echo AGENTCTL_EXIT=$?",
              env
            );

            await waitForLog(env.logPath, /AGENTCTL_EXIT=\d+/, {
              timeoutMs: 5_000,
            });
            const log = cleanLog(await readLog(env.logPath));

            // Extract just the dry-run output (between command echo and exit marker)
            const exitMatch = log.match(/AGENTCTL_EXIT=\d+/);
            const exitIdx = exitMatch ? log.indexOf(exitMatch[0]) : log.length;
            // Find last newline before the dry-run output starts
            // (skip the echoed command line which contains the original flags)
            const cmdEcho = log.indexOf("--dry-run");
            const outputStart = cmdEcho !== -1 ? log.indexOf("\n", cmdEcho) + 1 : 0;
            const dryRunOutput = log.slice(outputStart, exitIdx);

            assertContains(dryRunOutput, parsePattern(expected.dryRun!), "dry-run");

            if (expected.dryRunNotContains) {
              assertNotContains(
                dryRunOutput,
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
                const result = await runSteps(expected.steps, session!, env.logPath);
                if (result.needsValidation) {
                  assert.fail("steps contain wait: null — needs validation");
                }
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
                const result = await runSteps(expected.steps, session!, env.logPath);
                if (result.needsValidation) {
                  assert.fail("steps contain wait: null — needs validation");
                }
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
