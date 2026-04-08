# agentctl run — Integration Test Plan

## Goal

Validate that `agentctl run` correctly spawns real harness sessions. E2E tests — real binaries, real PTYs, real output.

See [DESIGN.md](./DESIGN.md) for infrastructure details (tmux lifecycle, log polling, fixture isolation, runner implementation).

## Test case format

```json
{
  "name": "headless-prompt",
  "description": "Headless mode with inline prompt executes and returns model output",
  "command": "agentctl run -h {harness} --headless --prompt \"respond with exactly: TEST_OK\"",
  "fixture": "basic",
  "tags": ["api", "slow"],
  "expected": {
    "claude": {
      "dryRun": "claude -p respond with exactly: TEST_OK",
      "live": "TEST_OK",
      "exitCode": 0
    },
    "opencode": {
      "dryRun": "opencode run respond with exactly: TEST_OK",
      "live": "TEST_OK",
      "exitCode": 0,
      "xfail": "opencode headless not validated yet"
    }
  }
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique test identifier |
| `description` | string | yes | Why this test exists |
| `command` | string | yes | Command template. `{harness}` is replaced with harness ID. `{fixture}` is replaced with project dir path. `{prompt_file}` with absolute path to a test prompt file. |
| `fixture` | string | no | Fixture project to use. Default: `basic` |
| `tags` | string[] | no | `api` (hits API), `slow` (long timeout), `interactive` (starts live session), `signal` (sends signals) |
| `skipDryRun` | boolean | no | Skip dry-run check (for interactive-only tests, error cases that fail before command construction) |
| `skipLive` | boolean | no | Skip live execution (for cases where dry-run is sufficient) |
| `expected.{harness}` | object | yes (per harness) | Expected outputs for this harness |
| `.dryRun` | string/null | conditional | Expected substring in `--dry-run` output. `null` if dry-run should not be tested. |
| `.live` | string/null | conditional | Expected substring/regex in live output. `null` if live should not be tested. |
| `.exitCode` | number | no | Expected exit code. Default: 0 |
| `.error` | string | no | Expected error message substring (for failure cases) |
| `.xfail` | string | no | If set, test is expected to fail. Value is the reason. |

## Runner logic

```
for each case file in tests/cases/*.json:
  load case
  for each harness in case.expected:
    skip if harness binary not installed
    mark xfail if expected.xfail is set

    setup:
      create temp project from case.fixture
      override HOME to isolate global config

    if !case.skipDryRun and expected.dryRun:
      start tmux session
      pipe-pane to log file
      send: {command with {harness} replaced} --dry-run
      wait for session to exit
      assert: log contains expected.dryRun
      assert: exit code matches (default 0)

    if !case.skipLive:
      start tmux session
      pipe-pane to log file
      send: {command with {harness} replaced}

      if expected.error:
        wait for log to contain expected.error
        assert: exit code matches expected.exitCode
      else if expected.live:
        wait for log to contain expected.live
        if "interactive" in tags:
          kill session
        else:
          wait for session to exit
          assert: exit code matches expected.exitCode

      if "signal" in tags:
        (signal-specific logic — send C-c, check cleanup)

    teardown:
      kill tmux session if still alive
      remove temp project
```

## Test cases

### 1. Interactive session

#### 01-bare-interactive.json

```json
{
  "name": "bare-interactive",
  "description": "Bare interactive launch starts a session with no flags",
  "command": "agentctl run -h {harness}",
  "tags": ["interactive"],
  "skipDryRun": true,
  "expected": {
    "claude": {
      "live": ">",
      "exitCode": 0
    },
    "opencode": {
      "live": null,
      "exitCode": 0,
      "xfail": "opencode cannot spawn interactive session via agentctl"
    }
  }
}
```

#### 02-interactive-agent.json

```json
{
  "name": "interactive-agent",
  "description": "Interactive launch with --agent loads the specified agent",
  "command": "agentctl run -h {harness} --agent reviewer",
  "tags": ["interactive"],
  "skipDryRun": true,
  "expected": {
    "claude": {
      "live": ">",
      "exitCode": 0
    },
    "opencode": {
      "live": null,
      "exitCode": 0,
      "xfail": "opencode cannot spawn interactive session via agentctl"
    }
  }
}
```

### 2. Headless mode

#### 03-headless-prompt.json

```json
{
  "name": "headless-prompt",
  "description": "Headless with inline prompt sends prompt and receives response",
  "command": "agentctl run -h {harness} --headless --prompt \"respond with exactly: TEST_OK\"",
  "tags": ["api", "slow"],
  "expected": {
    "claude": {
      "dryRun": "claude -p respond with exactly: TEST_OK",
      "live": "TEST_OK",
      "exitCode": 0
    },
    "opencode": {
      "dryRun": "opencode run respond with exactly: TEST_OK",
      "live": "TEST_OK",
      "exitCode": 0,
      "xfail": "opencode headless not validated yet"
    }
  }
}
```

#### 04-headless-prompt-file.json

```json
{
  "name": "headless-prompt-file",
  "description": "Headless with --prompt-file reads file content and passes it inline",
  "command": "agentctl run -h {harness} --headless --prompt-file {prompt_file}",
  "tags": ["api", "slow"],
  "expected": {
    "claude": {
      "dryRun": "claude -p respond with exactly: FILE_TEST_OK",
      "live": "FILE_TEST_OK",
      "exitCode": 0
    },
    "opencode": {
      "dryRun": "opencode run respond with exactly: FILE_TEST_OK",
      "live": "FILE_TEST_OK",
      "exitCode": 0,
      "xfail": "opencode headless not validated yet"
    }
  }
}
```

#### 05-headless-no-prompt.json

```json
{
  "name": "headless-no-prompt",
  "description": "Headless without --prompt or --prompt-file fails before spawn",
  "command": "agentctl run -h {harness} --headless",
  "skipDryRun": true,
  "expected": {
    "claude": {
      "error": "Headless mode requires --prompt or --prompt-file",
      "exitCode": 1
    },
    "opencode": {
      "error": "Headless mode requires --prompt or --prompt-file",
      "exitCode": 1
    }
  }
}
```

#### 06-headless-bad-prompt-file.json

```json
{
  "name": "headless-bad-prompt-file",
  "description": "Headless with nonexistent prompt file fails cleanly",
  "command": "agentctl run -h {harness} --headless --prompt-file /nonexistent/path.txt",
  "skipDryRun": true,
  "expected": {
    "claude": {
      "error": "Cannot read prompt file",
      "exitCode": 1
    },
    "opencode": {
      "error": "Cannot read prompt file",
      "exitCode": 1
    }
  }
}
```

#### 07-headless-agent-prompt.json

```json
{
  "name": "headless-agent-prompt",
  "description": "Headless with both --agent and --prompt composes correctly",
  "command": "agentctl run -h {harness} --headless --prompt \"respond with exactly: AGENT_TEST_OK\" --agent reviewer",
  "tags": ["api", "slow"],
  "expected": {
    "claude": {
      "dryRun": "claude -p respond with exactly: AGENT_TEST_OK --agent reviewer",
      "live": "AGENT_TEST_OK",
      "exitCode": 0
    },
    "opencode": {
      "dryRun": "opencode run respond with exactly: AGENT_TEST_OK --agent reviewer",
      "live": "AGENT_TEST_OK",
      "exitCode": 0,
      "xfail": "opencode headless not validated yet"
    }
  }
}
```

### 3. Model mapping

#### 08-model-large.json

```json
{
  "name": "model-large",
  "description": "Model class 'large' maps to harness-specific model name",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --model large",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "--model opus"
    },
    "opencode": {
      "dryRun": "-m anthropic/claude-opus-4-6"
    }
  }
}
```

#### 09-model-small.json

```json
{
  "name": "model-small",
  "description": "Model class 'small' maps correctly (not hardcoded to one class)",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --model small",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "--model haiku"
    },
    "opencode": {
      "dryRun": "-m anthropic/claude-haiku-4-5"
    }
  }
}
```

#### 10-model-nonexistent.json

```json
{
  "name": "model-nonexistent",
  "description": "Unknown model class fails with a message naming the class",
  "command": "agentctl run -h {harness} --model nonexistent",
  "skipDryRun": true,
  "expected": {
    "claude": {
      "error": "No Claude mapping for model class \"nonexistent\"",
      "exitCode": 1
    },
    "opencode": {
      "error": "No OpenCode mapping for model class \"nonexistent\"",
      "exitCode": 1
    }
  }
}
```

#### 11-model-degraded-ok.json

```json
{
  "name": "model-degraded-ok",
  "description": "Unknown model with --degraded-ok starts session without model flag",
  "command": "agentctl run -h {harness} --model nonexistent --degraded-ok",
  "tags": ["interactive"],
  "expected": {
    "claude": {
      "dryRun": "claude",
      "live": ">",
      "exitCode": 0
    },
    "opencode": {
      "dryRun": "opencode",
      "live": null,
      "exitCode": 0,
      "xfail": "opencode cannot spawn interactive session via agentctl"
    }
  }
}
```

Note: dry-run assertion should also verify `--model` is NOT present. Runner should support negative assertions.

#### 12-model-custom-config.json

```json
{
  "name": "model-custom-config",
  "description": "Project models.json overrides default model mapping",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --model small",
  "fixture": "custom-models",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "--model custom-haiku"
    },
    "opencode": {
      "dryRun": "-m custom/model-override"
    }
  }
}
```

### 4. Environment variables

#### 13-env-single.json

```json
{
  "name": "env-single",
  "description": "Single --env var appears in command",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --env FOO=bar",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "FOO=bar claude"
    },
    "opencode": {
      "dryRun": "FOO=bar opencode"
    }
  }
}
```

#### 14-env-multiple.json

```json
{
  "name": "env-multiple",
  "description": "Multiple --env flags accumulate",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --env A=1 --env B=2",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "A=1 B=2 claude"
    },
    "opencode": {
      "dryRun": "A=1 B=2 opencode"
    }
  }
}
```

#### 15-env-malformed.json

```json
{
  "name": "env-malformed",
  "description": "Env var without = fails with clear message",
  "command": "agentctl run -h {harness} --env INVALID",
  "skipDryRun": true,
  "expected": {
    "claude": {
      "error": "Invalid --env format: INVALID (expected KEY=VALUE)",
      "exitCode": 1
    },
    "opencode": {
      "error": "Invalid --env format: INVALID (expected KEY=VALUE)",
      "exitCode": 1
    }
  }
}
```

#### 16-env-empty-value.json

```json
{
  "name": "env-empty-value",
  "description": "FOO= is valid — empty string value",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --env FOO=",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "FOO= claude"
    },
    "opencode": {
      "dryRun": "FOO= opencode"
    }
  }
}
```

#### 17-env-equals-in-value.json

```json
{
  "name": "env-equals-in-value",
  "description": "Only first = is the delimiter — value can contain =",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --env FOO=bar=baz",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "FOO=bar=baz claude"
    },
    "opencode": {
      "dryRun": "FOO=bar=baz opencode"
    }
  }
}
```

### 5. Working directory

#### 18-cwd.json

```json
{
  "name": "cwd",
  "description": "Claude passes --cwd as flag; opencode does not (uses spawn cwd)",
  "command": "agentctl run -h {harness} --headless --prompt \"x\" --cwd /tmp",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "--cwd /tmp"
    },
    "opencode": {
      "dryRun": "opencode run x",
      "dryRunNotContains": "--cwd"
    }
  }
}
```

### 6. Full composition

#### 19-dry-run-full-composition.json

```json
{
  "name": "dry-run-full-composition",
  "description": "All flags compose correctly in dry-run output",
  "command": "agentctl run -h {harness} --headless --prompt \"review\" --agent reviewer --model large --env KEY=val --cwd /tmp",
  "skipLive": true,
  "expected": {
    "claude": {
      "dryRun": "KEY=val claude -p review --agent reviewer --model opus --cwd /tmp"
    },
    "opencode": {
      "dryRun": "KEY=val opencode run review --agent reviewer -m anthropic/claude-opus-4-6",
      "dryRunNotContains": "--cwd"
    }
  }
}
```

### 7. Error cases

#### 20-unknown-harness.json

```json
{
  "name": "unknown-harness",
  "description": "Unknown harness ID fails with available harness list",
  "command": "agentctl run -h nonexistent",
  "skipDryRun": true,
  "expected": {
    "_global": {
      "error": "Unknown harness: nonexistent",
      "exitCode": 1
    }
  }
}
```

Note: `_global` key means this test runs once, not per-harness.

### 8. Signal handling

#### 21-signal-ctrl-c.json

```json
{
  "name": "signal-ctrl-c",
  "description": "Ctrl+C cleanly terminates session with no zombies",
  "command": "agentctl run -h {harness}",
  "tags": ["interactive", "signal"],
  "skipDryRun": true,
  "expected": {
    "claude": {
      "live": ">",
      "signal": "C-c",
      "exitCode": 0
    },
    "opencode": {
      "live": null,
      "signal": "C-c",
      "exitCode": 0,
      "xfail": "opencode cannot spawn interactive session via agentctl"
    }
  }
}
```

#### 22-signal-exit-code.json

```json
{
  "name": "signal-exit-code",
  "description": "Exit code after SIGINT should be 130 (128+SIGINT) — currently 0 due to known bug",
  "command": "agentctl run -h {harness} ; echo EXIT_CODE=$?",
  "tags": ["interactive", "signal"],
  "skipDryRun": true,
  "expected": {
    "claude": {
      "live": ">",
      "signal": "C-c",
      "exitCode": 130,
      "xfail": "run.ts uses code ?? 0 which loses signal information"
    },
    "opencode": {
      "live": null,
      "signal": "C-c",
      "exitCode": 130,
      "xfail": "opencode interactive + signal exit code both broken"
    }
  }
}
```

---

## Adding a test case

Write one JSON file in `tests/cases/`. Include `expected` entries for each harness. Done.

## Adding a harness

Add an `expected` entry to each case file in `tests/cases/`. The runner picks it up. Use `xfail` for known-broken scenarios while bringing the harness up.

---

## Test count summary

| # | Name | Dry-run | Live | API | Signal |
|---|---|---|---|---|---|
| 01 | bare-interactive | — | per-harness | — | — |
| 02 | interactive-agent | — | per-harness | — | — |
| 03 | headless-prompt | per-harness | per-harness | yes | — |
| 04 | headless-prompt-file | per-harness | per-harness | yes | — |
| 05 | headless-no-prompt | — | per-harness | — | — |
| 06 | headless-bad-prompt-file | — | per-harness | — | — |
| 07 | headless-agent-prompt | per-harness | per-harness | yes | — |
| 08 | model-large | per-harness | — | — | — |
| 09 | model-small | per-harness | — | — | — |
| 10 | model-nonexistent | — | per-harness | — | — |
| 11 | model-degraded-ok | per-harness | per-harness | — | — |
| 12 | model-custom-config | per-harness | — | — | — |
| 13 | env-single | per-harness | — | — | — |
| 14 | env-multiple | per-harness | — | — | — |
| 15 | env-malformed | — | per-harness | — | — |
| 16 | env-empty-value | per-harness | — | — | — |
| 17 | env-equals-in-value | per-harness | — | — | — |
| 18 | cwd | per-harness | — | — | — |
| 19 | full-composition | per-harness | — | — | — |
| 20 | unknown-harness | — | once | — | — |
| 21 | signal-ctrl-c | — | per-harness | — | yes |
| 22 | signal-exit-code | — | per-harness | — | yes |

**With 2 harnesses:**
- Dry-run executions: 24
- Live executions: 23
- Total test runs: 47
- API-hitting: 6
- Signal tests: 4

---

## Known issues tracked

| Issue | Test(s) | xfail in |
|---|---|---|
| opencode interactive launch | 01, 02, 11, 21, 22 | opencode |
| opencode headless | 03, 04, 07 | opencode |
| Signal exit code `code ?? 0` | 22 | all harnesses |
| Missing `child.on("error")` | not yet covered | — |
