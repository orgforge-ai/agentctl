# Writing Tests

Practical guide for writing interactive integration tests using the step-based system.

## How it works

Tests run inside tmux sessions with real harness binaries. Each test case is a JSON file in `tests/cases/` that declares a sequence of **steps** — wait for something, send keystrokes, wait for a response.

```
test case JSON
  → runner loads it
    → starts tmux session
      → executes steps sequentially
        → captures terminal snapshot after each step
          → snapshots saved to .test-output/{test}/{harness}/step-{N}.log
```

### Two output systems

1. **pipe-pane log** (`output.log`) — raw stream of all terminal output, used by `waitForLog` for polling. Accumulates over time. Contains ANSI escapes (cleaned by `cleanLog` before matching).

2. **capture-pane snapshots** (`step-{N}.log`) — screenshot of the terminal at a point in time. Taken after every step. This is what you inspect to see what the TUI looks like.

The pipe-pane log is for assertions. The snapshots are for debugging.

## Workflow: start with null, then build regexes

### Step 1: Stub the test with `wait: null`

Start with a `wait: null` step to pause the test and capture what the harness actually outputs. This lets you see the real terminal content before writing assertions.

```json
{
  "name": "my-test",
  "description": "What this test verifies",
  "command": "agentctl run -h {harness}",
  "tags": ["interactive"],
  "skipDryRun": true,
  "expected": {
    "claude": {
      "steps": [
        { "wait": null, "timeoutMs": 15000 }
      ],
      "exitCode": 0
    },
    "opencode": {
      "steps": [
        { "wait": null, "timeoutMs": 15000 }
      ],
      "exitCode": 0
    }
  }
}
```

Run the test:

```bash
npm test
```

The test will sleep for 15 seconds, then capture the terminal. Inspect the snapshot:

```bash
cat .test-output/my-test/claude/step-0.log
cat .test-output/my-test/opencode/step-0.log
```

### Step 2: Replace null with a real wait pattern

Look at the snapshot and pick a string that indicates the harness loaded. Replace `wait: null` with a pattern:

```json
{ "wait": "Claude Code", "timeoutMs": 15000 }
```

For regex patterns, wrap in `/slashes/`:

```json
{ "wait": "/Claude Code v\\d+/", "timeoutMs": 15000 }
```

### Step 3: Add send and wait steps

Build up the interaction sequence. Use `\\n` at the end of a send to press Enter (submit):

```json
{
  "steps": [
    { "wait": "Claude Code", "timeoutMs": 15000 },
    { "send": "respond with only TEST_SUCCEEDED\\n" },
    { "wait": "/(?<!only )TEST_SUCCEEDED/", "timeoutMs": 30000 }
  ]
}
```

Run again and check each step's snapshot:

```bash
cat .test-output/my-test/claude/step-0.log   # after wait: harness loaded
cat .test-output/my-test/claude/step-1.log   # after send: prompt submitted
cat .test-output/my-test/claude/step-2.log   # after wait: response received
```

### Step 4: Iterate

If a wait pattern doesn't match, check the pipe-pane log to see what text was actually captured:

```bash
cat .test-output/my-test/claude/output.log | less
```

The raw log has ANSI escapes. The `output.clean.log` has a cleaned capture-pane snapshot from cleanup time.

## Step reference

### wait

Polls the pipe-pane log until a pattern appears.

```json
{ "wait": "some text", "timeoutMs": 15000 }
```

| Field | Type | Description |
|---|---|---|
| `wait` | `string \| null` | Pattern to match. String for literal, `/regex/` for regex, `null` to sleep for `timeoutMs`. |
| `timeoutMs` | `number` | Max time to wait. Default: 15000. |

**Pattern format:**
- `"Claude Code"` — literal substring match against cleaned log
- `"/Claude Code v\\d+/"` — regex (note: double-escape backslashes in JSON)
- `"/pattern/i"` — regex with flags
- `null` — sleep for `timeoutMs` then continue (for exploratory debugging)

### send

Types text into the tmux session.

```json
{ "send": "hello world\\n" }
```

| Field | Type | Description |
|---|---|---|
| `send` | `string` | Text to type. `\\n` sends Enter key. |

**How `\\n` works:** The string is split on literal `\n`. Text parts are sent with `tmux send-keys -l` (literal mode). Between parts, an Enter key is sent. This means:

- `"hello\\n"` → types "hello", presses Enter
- `"line1\\nline2\\n"` → types "line1", Enter, types "line2", Enter
- `"hello"` → types "hello" (no Enter — text sits in input, not submitted)

## Writing wait patterns that don't false-match

The pipe-pane log contains everything — your sent text, the harness UI, and the model's response. If your prompt contains the same string you're waiting for, the wait will match the prompt immediately.

### Use negative lookbehind

If your prompt is "respond with only TEST_SUCCEEDED", the response is just "TEST_SUCCEEDED". Use a negative lookbehind to skip the prompt line:

```json
{ "wait": "/(?<!only )TEST_SUCCEEDED/", "timeoutMs": 30000 }
```

This matches `TEST_SUCCEEDED` only when NOT preceded by `only `.

### Use anchored patterns

If the response appears on its own line, use `^` and `$` with the multiline flag:

```json
{ "wait": "/^\\s*TEST_SUCCEEDED\\s*$/m", "timeoutMs": 30000 }
```

Note: this works well for simple CLI output but may not work for TUI harnesses where the line contains UI chrome (borders, bullets, status indicators).

### Avoid ambiguity entirely

If possible, phrase the prompt so the expected response doesn't appear in it:

```json
{ "send": "what is 2+2? reply with only the number\\n" },
{ "wait": "/^\\s*4\\s*$/m", "timeoutMs": 30000 }
```

## Test case fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique test identifier, used for output directory |
| `description` | string | yes | What this test verifies |
| `command` | string | yes | Command template. `{harness}` → harness ID, `{fixture}` → project dir, `{prompt_file}` → prompt.txt path |
| `fixture` | string | no | Fixture project to use. Default: `basic` |
| `tags` | string[] | no | `interactive`, `signal`, `api`, `slow` |
| `skipDryRun` | boolean | no | Skip dry-run test |
| `skipLive` | boolean | no | Skip live execution test |
| `expected.{harness}` | object | yes | Expected behavior per harness (`claude`, `opencode`, or `_global`) |
| `.steps` | Step[] | no | Sequence of wait/send steps |
| `.exitCode` | number | no | Expected exit code (default: 0) |
| `.error` | string | no | Expected error substring |
| `.xfail` | string | no | Mark as expected failure with reason |

## Output directory structure

After running tests, `.test-output/` contains:

```
.test-output/
  bare-interactive/
    claude/
      output.log          # raw pipe-pane log
      output.clean.log    # cleaned capture-pane at cleanup time
      step-0.log          # snapshot after step 0 (wait for harness)
      step-1.log          # snapshot after step 1 (send prompt)
      step-2.log          # snapshot after step 2 (wait for response)
    opencode/
      output.log
      output.clean.log
      step-0.log
      step-1.log
      step-2.log
```

## Running tests

```bash
npm test                    # run all tests
npm run test:fast           # skip api and slow tests
npm run test:dry-run-only   # dry-run tests only (no interactive/signal/api)
```

Exclude specific tags:

```bash
npm test -- --exclude=api,slow
```

## Tips

- **Start every new test with `wait: null`** to see what the harness actually renders before writing patterns.
- **Check step snapshots** (`step-N.log`) to debug what the terminal looked like at each point.
- **Interactive tests don't check exit codes** — the session is killed after steps complete.
- **Both harnesses must be installed** for their tests to run. Missing harnesses are skipped automatically.
- **Timeouts for API calls** should be generous (30s+). Model responses vary in speed.
- **JSON escaping**: `\\n` in JSON becomes the literal two characters `\n`, which the runner splits on. A JSON `\n` becomes a real newline character and won't trigger an Enter key.

## Adding a new harness

A harness is a coding-agent CLI (like Claude Code or OpenCode) that agentctl can drive. Adding one requires an adapter in `src/adapters/`, registration in the adapter registry, and test fixtures.

### 1. Implement the adapter

Create `src/adapters/{name}.ts` implementing the `HarnessAdapter` interface from `src/adapters/base.ts`:

```typescript
import { type HarnessAdapter, /* ... */ } from "./base.js";

export class MyHarnessAdapter implements HarnessAdapter {
  id = "myharness";           // Used everywhere: CLI flags, test keys, fixture dirs
  displayName = "My Harness"; // Human-readable name for error messages

  async detect(): Promise<DetectionResult> { /* ... */ }
  capabilities(): HarnessCapabilities { /* ... */ }
  resolveInstallPaths(context): HarnessPaths { /* ... */ }
  async listInstalled(context): Promise<InstalledResources> { /* ... */ }
  async listUnmanaged(context): Promise<UnmanagedResource[]> { /* ... */ }
  async renderAgent(input): Promise<RenderedFile[]> { /* ... */ }
  async importAgents(context): Promise<ImportedAgent[]> { /* ... */ }
  async sync(context): Promise<SyncResult> { /* ... */ }
  async buildRunCommand(input): Promise<CommandSpec> { /* ... */ }
}
```

Key methods:

| Method | Purpose |
|---|---|
| `detect` | Check if the binary is installed, return version info |
| `capabilities` | Declare what the harness supports (headless, agents, etc.) |
| `resolveInstallPaths` | Where agents live on disk for this harness |
| `renderAgent` | Convert an agentctl agent definition into harness-native format |
| `importAgents` | Read existing harness-native agents back into agentctl format |
| `sync` | Write/update/delete agent files in the harness's directory |
| `buildRunCommand` | Build the `CommandSpec` (binary, args, env, cwd) for `agentctl run` |

Use the existing adapters as reference:
- `src/adapters/claude.ts` — Claude Code adapter
- `src/adapters/opencode.ts` — OpenCode adapter

### 2. Register the adapter

Add it to `src/adapters/registry.ts`:

```typescript
import { MyHarnessAdapter } from "./myharness.js";

register(new MyHarnessAdapter());
```

The `id` field becomes the harness name used in:
- `agentctl run -h myharness`
- Test case JSON keys (`expected.myharness`)
- Fixture directories (`tests/fixtures/home/myharness/`)
- Model class mappings (`models.modelClasses.large.myharness`)

### 3. Add model class mappings

If the harness uses model names different from agentctl's model classes, add mappings. The config schema in `src/config/` defines model classes like `large`, `medium`, `small` — each maps to a harness-specific model identifier.

The adapter's `buildRunCommand` reads these:

```typescript
const mapping = input.context.models.modelClasses[input.model];
const myModel = mapping?.["myharness"];
if (myModel) {
  args.push("--model", myModel);
}
```

### 4. Create test fixtures

#### Home fixture (optional)

If the harness needs config files in `$HOME` to skip onboarding or accept terms, create `tests/fixtures/home/{id}/`:

```
tests/fixtures/home/myharness/
  .myharness/
    config.json       # Skip onboarding, accept terms, etc.
    settings.json     # Default settings for test environment
```

This directory is copied to the test's isolated `$HOME` before each run. Look at `tests/fixtures/home/claude/` for reference — it pre-accepts onboarding and sets up trust for the project directory.

**Credential handling:** The test setup in `helpers.ts` automatically symlinks Claude-specific credential files from the real home. If your harness uses different credential files, you may need to update `createTestProject()` in `helpers.ts` to symlink them:

```typescript
// In createTestProject(), add credential symlinks for your harness
const myHarnessCredsDir = path.join(os.homedir(), ".myharness");
// ... symlink relevant credential files
```

#### Project fixture (usually not needed)

The `basic` project fixture (`tests/fixtures/projects/basic/`) works for most tests. It includes an `.agentctl/` directory with a config and a sample agent. Only create a new project fixture if your harness needs harness-specific project files that differ from the standard setup.

### 5. Add test cases

Add an entry for your harness in each relevant test case JSON file under `tests/cases/`. The key in `expected` must match the adapter's `id`.

Start with an exploratory `wait: null`:

```json
{
  "expected": {
    "claude": { /* ... existing ... */ },
    "opencode": { /* ... existing ... */ },
    "myharness": {
      "steps": [
        { "wait": null, "timeoutMs": 15000 }
      ],
      "exitCode": 0
    }
  }
}
```

Run the test, inspect `.test-output/{test}/myharness/step-0.log`, then replace `null` with real patterns. See [Workflow: start with null, then build regexes](#workflow-start-with-null-then-build-regexes) above.

Use `xfail` for known-broken scenarios while bringing the harness up:

```json
"myharness": {
  "steps": [],
  "exitCode": 0,
  "xfail": "myharness headless not validated yet"
}
```

### 6. Verify

```bash
npm test
```

If the harness binary isn't installed, its tests are automatically skipped (shown as `﹣` in output). Tests only run when the binary is on `$PATH`.

### Checklist

- [ ] `src/adapters/{id}.ts` — implements `HarnessAdapter`
- [ ] `src/adapters/registry.ts` — `register(new MyAdapter())`
- [ ] Model class mappings configured (if applicable)
- [ ] `tests/fixtures/home/{id}/` — home fixture to skip onboarding (if needed)
- [ ] `tests/cases/*.json` — `expected.{id}` entry in each relevant test case
- [ ] `helpers.ts` — credential symlinks updated (if harness uses non-Claude credentials)
- [ ] `npm test` passes with harness installed

## Complete example

```json
{
  "name": "bare-interactive",
  "description": "Bare interactive launch starts a session with no flags",
  "command": "agentctl run -h {harness}",
  "tags": ["interactive"],
  "skipDryRun": true,
  "expected": {
    "claude": {
      "steps": [
        { "wait": "Claude Code", "timeoutMs": 15000 },
        { "send": "respond with only TEST_SUCCEEDED\\n" },
        { "wait": "/(?<!only )TEST_SUCCEEDED/", "timeoutMs": 30000 }
      ],
      "exitCode": 0
    },
    "opencode": {
      "steps": [
        { "wait": "OpenCode", "timeoutMs": 15000 },
        { "send": "respond with only TEST_SUCCEEDED\\n" },
        { "wait": "/(?<!only )TEST_SUCCEEDED/", "timeoutMs": 30000 }
      ],
      "exitCode": 0
    }
  }
}
```
