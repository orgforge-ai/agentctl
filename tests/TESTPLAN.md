# agentctl run — Integration Test Plan

## Approach

All tests use **tmux** to spawn `agentctl run` in a real PTY session. A **stub binary** for each harness (`claude`, `opencode`) replaces the real binary on `PATH`. The stub logs its invocation (command, args, env, TTY status, cwd) to a file atomically and stays alive until signaled, allowing the test to inspect the running session before teardown.

Each test gets an isolated temp directory with a valid `.agentctl/` project structure (config, agents). Tests read the stub's invocation log and tmux pane output to assert correctness.

### Why tmux

- Allocates a real PTY — validates that interactive sessions get a terminal
- `tmux send-keys` lets us test interactive input and signal handling
- `tmux capture-pane` lets us read output without pipe hacks
- Available on all CI Linux runners

### Why stub binaries (not mocks)

- Exercises the full code path: CLI parsing, config loading, adapter resolution, command building, `spawn()`
- Proves the right binary is called with the right args
- No test framework coupling to internal APIs

---

## Infrastructure

### Test isolation

Every test overrides `HOME` to an empty temp directory. This prevents `~/.agentctl/` (the developer's or CI runner's global config) from leaking into tests and affecting model mappings, config, or agent resolution.

Every test fixture includes a `.agentctl/` directory so that `findProjectRoot()` resolves to the temp dir and does not walk up the tree into unrelated `.git` directories.

### Stub binary: `tests/fixtures/bin/claude` (and `opencode`)

The stub writes its log **atomically** — all output goes to a temp file, then is moved into place. This prevents `waitForStub` from reading a partially-written log.

Args are logged **individually** (not flattened with `$*`) so tests can distinguish `"hello world"` (one arg) from `hello` `world` (two args).

```bash
#!/bin/bash
LOG="${AGENTCTL_TEST_INVOCATION_LOG:?}"
TMPLOG="${LOG}.tmp.$$"

{
  echo "CMD=$0"
  echo "ARGC=$#"
  for i in $(seq 1 $#); do
    echo "ARG[$i]=${!i}"
  done
  echo "CWD=$(pwd)"
  [ -t 0 ] && echo "TTY=yes" || echo "TTY=no"
  env | sort
  echo "STUB_READY"
} > "$TMPLOG"
mv "$TMPLOG" "$LOG"

# Handle signals for signal-propagation tests
trap 'echo "SIGNAL=INT" >> "$LOG"; exit 130' INT
trap 'echo "SIGNAL=TERM" >> "$LOG"; exit 143' TERM

sleep 300  # stay alive until killed
```

**Variant: `tests/fixtures/bin/claude-exit`** — exits immediately with a configurable code for exit-code propagation tests:

```bash
#!/bin/bash
LOG="${AGENTCTL_TEST_INVOCATION_LOG:?}"
echo "STUB_READY" > "$LOG"
exit "${AGENTCTL_TEST_EXIT_CODE:-0}"
```

### Fixture project: `tests/fixtures/projects/basic/`

```
.agentctl/
  config.json          # { "version": 1 }
  models.json          # default model mappings
  agents/
    reviewer/
      agent.json       # { "name": "reviewer", "description": "...", "prompt_file": "prompt.md" }
      prompt.md        # "You are a code reviewer."
```

### Fixture project: `tests/fixtures/projects/custom-models/`

Same as `basic/` but with a `models.json` that overrides `small.claude` to `"custom-haiku"`. Used by test 3.6.

### Test helpers

- `createTestProject(fixture?)` — copies fixture into a temp dir, sets up isolated `HOME`, returns `{ projectDir, homeDir, logPath }`
- `startSession(cmd, opts?)` — creates tmux session with `HOME` override, sends cmd, returns session handle
- `waitForStub(logPath, timeoutMs?)` — polls until log file exists and contains `STUB_READY`. Handles ENOENT gracefully. Default timeout 10s, poll interval 100ms.
- `readInvocationLog(logPath)` — parses log into `{ cmd, argc, args[], cwd, tty, env{} }`
- `waitForSessionExit(session, timeoutMs?)` — waits for tmux pane to close (for dry-run and error tests). Captures final pane content before exit.
- `capturePaneContent(session)` — returns tmux pane text
- `killSession(session)` — sends SIGTERM, waits, kills tmux session
- `assertNoInvocation(logPath)` — asserts log file was never created (stub never ran)

---

## Test Matrix

### 1. Interactive session (no --headless)

#### 1.1 `run -h claude` — bare interactive launch

```
agentctl run -h claude
```

**Asserts:**
- Stub binary `claude` is invoked (not `opencode`)
- No `-p` flag in args (not headless)
- No `--agent` flag
- No `--model` flag
- `TTY=yes` in invocation log (stdio inherited, PTY attached)
- `CWD` in log matches the tmux session's starting directory

**Why:** Validates the simplest happy path — interactive mode with no optional flags. Confirms spawn actually happens and the child process gets a terminal. CWD assertion guards against `findProjectRoot` escaping the sandbox.

#### 1.2 `run -h opencode` — bare interactive launch (alternate harness)

```
agentctl run -h opencode
```

**Asserts:**
- Stub binary `opencode` is invoked (not `claude`)
- No `run` subcommand in args (that's headless-only for opencode)
- `TTY=yes`
- `CWD` is the project root (opencode defaults cwd to projectRoot)

**Why:** Proves harness routing works. Also validates opencode's default cwd behavior differs from Claude — opencode defaults to projectRoot even without `--cwd`.

#### 1.3 `run -h claude --agent reviewer` — interactive with agent

```
agentctl run -h claude --agent reviewer
```

**Asserts:**
- `ARG[1]` is `--agent`, `ARG[2]` is `reviewer`
- `TTY=yes`

**Why:** Validates that `--agent` is passed through to the harness binary in interactive mode. The agent name must match exactly — no path expansion, no `.md` suffix.

---

### 2. Headless mode (--headless --prompt)

#### 2.1 `run -h claude --headless --prompt "review the codebase"`

```
agentctl run -h claude --headless --prompt "review the codebase"
```

**Asserts:**
- `ARG[1]` is `-p`, `ARG[2]` is `review the codebase` (single arg, not split on spaces)
- Stub is invoked

**Why:** Core headless path for Claude adapter. The prompt is passed via `-p`, not as a positional arg. Per-arg logging confirms the prompt survives as a single argument.

#### 2.2 `run -h opencode --headless --prompt "review the codebase"`

```
agentctl run -h opencode --headless --prompt "review the codebase"
```

**Asserts:**
- `ARG[1]` is `run` (opencode's headless subcommand)
- `ARG[2]` is `review the codebase` (positional, single arg)

**Why:** OpenCode uses a different arg format than Claude for headless mode — `opencode run "prompt"` vs `claude -p "prompt"`. This test validates the adapter-specific mapping.

#### 2.3 `run -h claude --headless --prompt-file <absolute-path>`

Setup: write `prompt.txt` with content `"You should review all files."` in the test project. Pass as an **absolute path** to avoid cwd ambiguity.

**Asserts:**
- `ARG[1]` is `-p`, `ARG[2]` is `You should review all files.` (file contents, not the path)
- Stub is invoked

**Why:** `--prompt-file` reads the file and passes its content inline. The adapter never passes a file path to the harness binary — it resolves the content first. Absolute path avoids the ambiguity of what cwd the path would resolve relative to.

#### 2.4 `run -h claude --headless` (no --prompt, no --prompt-file)

**Asserts:**
- agentctl exits with code 1
- stderr contains "Headless mode requires --prompt or --prompt-file"
- Stub is NOT invoked (`assertNoInvocation`)

**Why:** Headless without a prompt is a user error. Must fail before spawn.

#### 2.5 `run -h claude --headless --prompt-file /nonexistent/path.txt`

**Asserts:**
- agentctl exits with code 1
- stderr contains "Cannot read prompt file"
- Stub is NOT invoked

**Why:** Nonexistent prompt file must produce a clear error, not a stack trace.

#### 2.6 `run -h claude --headless --prompt` with shell-hostile characters

```
agentctl run -h claude --headless --prompt 'say "hello" && echo $PATH `whoami`'
```

**Asserts:**
- `ARG[2]` is exactly `say "hello" && echo $PATH \`whoami\`` — quotes, ampersands, dollar signs, and backticks all survive verbatim
- Stub is invoked

**Why:** Prompts are user-supplied strings that may contain any character. `spawn()` with an args array (not a shell string) should preserve them, but this must be verified since shell metacharacters are a common source of bugs.

---

### 3. Model class mapping

#### 3.1 `run -h claude --model large`

**Asserts:**
- Args contain `--model` followed by `opus` (mapped from "large" → "opus" for claude)

**Why:** Model classes are abstract ("large", "small") and each adapter maps them to harness-specific names. Validates the default mapping.

#### 3.2 `run -h opencode --model large`

**Asserts:**
- Args contain `-m` followed by `anthropic/claude-opus-4-6` (opencode uses `-m`, not `--model`)

**Why:** OpenCode uses a short flag (`-m`) and fully-qualified model identifiers. Different from Claude's `--model <shortname>`.

#### 3.3 `run -h claude --model small`

**Asserts:**
- Args contain `--model` followed by `haiku`

**Why:** Validates a second mapping to ensure the lookup isn't hardcoded to one class.

#### 3.4 `run -h claude --model nonexistent`

**Asserts:**
- agentctl exits with code 1
- stderr contains `No Claude mapping for model class "nonexistent"`
- Stub is NOT invoked

**Why:** Unknown model class must error before spawn. The error message must name the class so the user knows what to fix.

#### 3.5 `run -h claude --model nonexistent --degraded-ok`

**Asserts:**
- Stub IS invoked
- No arg is `--model` (model flag silently omitted, not set to empty)

**Why:** `--degraded-ok` makes missing model mappings non-fatal. The session launches without a model override. Note: unlike capability degradation (which prints a warning), model degradation is silent — the flag is simply dropped.

#### 3.6 Custom model mapping via project config

Setup: use `custom-models` fixture where `.agentctl/models.json` overrides `small.claude` to `"custom-haiku"`.

```
agentctl run -h claude --model small
```

**Asserts:**
- Args contain `--model` followed by `custom-haiku` (not the default `haiku`)

**Why:** Project-level config overrides defaults. Validates the three-layer config merge for model mappings.

---

### 4. Environment variable passthrough

#### 4.1 `run -h claude --env AGENTCTL_TEST_FOO=bar`

**Asserts:**
- Stub's logged environment contains `AGENTCTL_TEST_FOO=bar`

**Why:** `--env` vars must reach the child process. Validates the `spawn({ env: {...process.env, ...spec.env} })` merge.

#### 4.2 `run -h claude --env AGENTCTL_TEST_A=1 --env AGENTCTL_TEST_B=2`

**Asserts:**
- Stub's environment contains both `AGENTCTL_TEST_A=1` and `AGENTCTL_TEST_B=2`

**Why:** Multiple `--env` flags accumulate. Validates the variadic CLI option parsing.

#### 4.3 `run -h claude --env INVALID`

**Asserts:**
- agentctl exits with code 1
- stderr contains `Invalid --env format: INVALID (expected KEY=VALUE)`
- Stub is NOT invoked

**Why:** Malformed env vars must fail early with a clear message.

#### 4.4 `run -h claude --env AGENTCTL_TEST_EMPTY=`

**Asserts:**
- Stub's environment contains `AGENTCTL_TEST_EMPTY=` (key present, value is empty string)
- Stub IS invoked

**Why:** Empty values after `=` are valid. The parser splits on the first `=`, so `FOO=` produces key `FOO` with value `""`. Documents this as intentional behavior.

#### 4.5 `run -h claude --env AGENTCTL_TEST_EQ=bar=baz=qux`

**Asserts:**
- Stub's environment contains `AGENTCTL_TEST_EQ=bar=baz=qux`

**Why:** Values containing `=` are valid. The parser uses `indexOf("=")` and `slice()`, so only the first `=` is treated as the delimiter. Documents this edge case.

---

### 5. Working directory

#### 5.1 `run -h claude --cwd /tmp`

**Asserts:**
- Args contain `--cwd` followed by `/tmp`

**Why:** Claude adapter passes `--cwd` as a flag to the binary (it does NOT set spawn's `cwd`).

#### 5.2 `run -h opencode --cwd /tmp`

**Asserts:**
- Stub's `CWD` is `/tmp` (logged by `pwd` in stub)
- Args do NOT contain `--cwd` (opencode uses spawn's `cwd` option, not a flag)

**Why:** OpenCode adapter sets `cwd` on the spawn options, not as an arg. Different mechanism than Claude — worth verifying both the presence of `cwd` and the absence of the flag.

#### 5.3 `run -h opencode` (no --cwd)

**Asserts:**
- Stub's `CWD` is the project root (default fallback for opencode)

**Why:** OpenCode defaults `cwd` to `projectRoot` when not specified. Claude leaves it undefined (inherits parent's cwd). This is a behavioral difference between adapters.

#### 5.4 `run -h claude` (no --cwd)

**Asserts:**
- Stub's `CWD` is the tmux session's starting directory (inherited from parent, not forced to project root)
- Args do NOT contain `--cwd`

**Why:** Claude adapter does not set a default `cwd` — the child inherits the parent's working directory. This is the opposite of opencode's behavior and must be verified to document the asymmetry.

---

### 6. Dry run

#### 6.1 `run -h claude --headless --prompt "hello" --dry-run`

Uses `waitForSessionExit` to capture output after the process exits (avoids race between print and tmux pane flush).

**Asserts:**
- Captured output contains `claude -p hello`
- agentctl exits with code 0
- Stub is NOT invoked (`assertNoInvocation`)

**Why:** `--dry-run` must print the command and exit without spawning. Users rely on this to preview what will run.

#### 6.2 `run -h claude --headless --prompt "hello" --env FOO=bar --dry-run`

**Asserts:**
- Captured output contains `FOO=bar claude -p hello`

**Why:** Dry run output must include env var prefix so the user sees the full invocation.

---

### 7. Combined flags

#### 7.1 Full flag combination (claude)

```
agentctl run -h claude --headless --prompt "review" --agent reviewer --model large --env AGENTCTL_TEST_KEY=secret --cwd /tmp
```

**Asserts:**
- Args contain (in any order): `-p` `review`, `--agent` `reviewer`, `--model` `opus`, `--cwd` `/tmp`
- Env contains `AGENTCTL_TEST_KEY=secret`
- Stub invoked
- `ARGC` matches expected count

**Why:** All flags must compose correctly. No flag should clobber another. ARGC check catches stray or missing args.

#### 7.2 Full flag combination (opencode)

```
agentctl run -h opencode --headless --prompt "review" --agent reviewer --model large --env AGENTCTL_TEST_KEY=secret --cwd /tmp
```

**Asserts:**
- Args contain: `run`, `review` (positional), `--agent` `reviewer`, `-m` `anthropic/claude-opus-4-6`
- Env contains `AGENTCTL_TEST_KEY=secret`
- Stub's `CWD` is `/tmp`
- Args do NOT contain `--cwd` (opencode uses spawn cwd)

**Why:** Same composition test for the other adapter. Validates that adapter-specific arg formats hold under full flag load. Explicitly checks the cwd mechanism difference.

---

### 8. Error cases

#### 8.1 Unknown harness

```
agentctl run -h nonexistent
```

**Asserts:**
- Exit code 1
- stderr contains "Unknown harness: nonexistent"
- stderr contains "Available:" with known harness IDs
- Stub is NOT invoked

**Why:** Fails fast with actionable guidance.

#### 8.2 Exit code propagation

Setup: use `claude-exit` stub variant. Set `AGENTCTL_TEST_EXIT_CODE=42`.

**Asserts:**
- agentctl exits with code 42

**Why:** The CLI must forward the child process exit code to the caller. Scripts and CI depend on this.

#### 8.3 Harness binary not on PATH

Setup: do NOT place any stub on PATH. Override PATH to contain only system essentials (no `claude` or `opencode`).

**Asserts:**
- agentctl exits with non-zero code
- stderr contains a meaningful error (not an unhandled Node.js stack trace)

**Why:** Currently `run.ts` has no `child.on("error")` handler, so `spawn` failing (ENOENT) produces an ugly crash. This test documents the expected behavior and will fail until the product code adds error handling. **Known product bug — this test should be written to assert the desired behavior, not the current broken behavior.**

---

### 9. Signal handling

#### 9.1 Ctrl+C in interactive session

Setup: start interactive session in tmux with the signal-aware stub, send `C-c` via `tmux send-keys`.

**Asserts:**
- Stub's log contains `SIGNAL=INT` (signal was received)
- tmux session terminates (pane closes)
- No zombie processes left behind (`pgrep` for the stub PID returns empty)

**Why:** Users expect Ctrl+C to cleanly stop both agentctl and the harness. With `stdio: "inherit"`, the terminal sends SIGINT to the entire foreground process group.

#### 9.2 SIGTERM to child — exit code reflects signal

Setup: start session, get the stub's PID from tmux (`#{pane_pid}`), send SIGTERM.

**Asserts:**
- agentctl exits with code 143 (128 + 15 for SIGTERM) OR exits with code 0 (documenting current behavior of `code ?? 0`)

**Why:** Unix convention is exit code 128 + signal number for signal-killed processes. The current code uses `code ?? 0`, which loses signal information (the `close` event provides `(null, 'SIGTERM')` but only `code` is checked). This test documents the actual behavior. **If the product is fixed to handle signals properly, update the assertion to expect 143.**

---

### 10. Prompt edge cases

#### 10.1 Empty prompt

```
agentctl run -h claude --headless --prompt ""
```

**Asserts:**
- Document actual behavior: does the adapter pass `-p ""` to the harness, or does it error?
- If it passes through: `ARG[2]` is empty string, stub is invoked
- If it errors: exit code 1, meaningful message

**Why:** Empty prompts are a likely user mistake. The current code has no guard — the empty string is passed through. This test locks in the behavior so a future change is intentional.

---

## Test count summary

| Category                         | Tests |
|----------------------------------|-------|
| Interactive session              | 3     |
| Headless mode                    | 6     |
| Model class mapping              | 6     |
| Environment variable passthrough | 5     |
| Working directory                | 4     |
| Dry run                          | 2     |
| Combined flags                   | 2     |
| Error cases                      | 3     |
| Signal handling                  | 2     |
| Prompt edge cases                | 1     |
| **Total**                        | **34**|

---

## Known product issues to track

These were discovered during test design and should be fixed independently:

1. **No `child.on("error")` handler** (`src/cli/run.ts:97`) — spawn failure (binary not found) produces unhandled Node.js error instead of clean message. Covered by test 8.3.
2. **Signal exit codes lost** (`src/cli/run.ts:104`) — `code ?? 0` discards signal information. Child killed by SIGINT exits as 0 instead of 130. Covered by test 9.2.
3. **Asymmetric cwd defaults** — Claude inherits parent cwd, OpenCode defaults to projectRoot. May be intentional but should be documented. Covered by tests 5.3/5.4.
