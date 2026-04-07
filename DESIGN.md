# agentctl Design

## Goal

`agentctl` is a portable control plane for coding-agent harnesses such as Claude Code, Codex, OpenCode, and future runtimes.

It provides:

- one cross-platform source of truth for agent definitions and model mappings
- one normalized CLI for interactive and headless execution
- adapter-based synchronization into harness-specific config/layouts
- provider-agnostic model aliases such as `small`, `medium`, and `large`
- an extension model that makes adding new harnesses cheap

It does not try to pretend all harnesses are identical. Where capabilities differ, `agentctl` should expose a stable abstraction and also surface capability gaps clearly.

## Non-Goals

- perfect feature parity across all harnesses
- lossless round-tripping from harness-native config back into `.agentctl`
- hiding every provider-specific detail
- managing arbitrary non-coding agent runtimes from day one
- managing runtime state such as session history, memory, or task logs (these remain harness-managed)

## Core Idea

`.agentctl/` and `~/.agentctl/` become the canonical source of truth for agent definitions and model mappings.

- `~/.agentctl/` is the global layer
- `<repo>/.agentctl/` is the project layer
- harness-native folders such as `.claude/`, `.codex/`, and `.opencode/` are generated or synchronized artifacts

This is intentionally similar to how Terraform treats provider state and generated artifacts: user-owned config lives in one place, adapter-owned outputs live elsewhere.

### Ownership Boundary

agentctl manages **agent definitions** (prompts, metadata, model preferences) — the static, declarative parts. Runtime state such as session history, agent memory, and task logs remains harness-managed. Each harness stores memory in its own location (e.g., Claude Code uses `~/.claude/projects/<path>/memory/`), and agentctl does not read, write, or migrate that state.

This keeps the sync model one-directional: agentctl pushes definitions into harness directories, never pulls runtime state back.

## Primary Use Cases

1. Define portable agents once and sync them into multiple harnesses.
2. Install skills globally or per-repo, then expose them in each supported harness.
3. Launch a harness interactively through one consistent CLI.
4. Launch a harness headlessly through one consistent CLI.
5. List what agents/skills are available from the canonical config and from installed harness locations.
6. Add support for a new harness without rewriting the whole system.

## Proposed Directory Model

Global:

```text
~/.agentctl/
  config.json
  models.json
  agents/
  adapters/
  state/            # sync state, gitignored, keyed per project
```

Project:

```text
<repo>/.agentctl/
  config.json
  models.json
  agents/
```

Generated harness artifacts:

```text
<repo>/.claude/
<repo>/.codex/
<repo>/.opencode/
```

Notes:

- project config overrides global config
- project agents augment or shadow global entries by name
- generated harness directories should be safe to recreate
- `~/.agentctl/state/` tracks sync metadata and is never committed to version control

## Resource Model

v1 has one portable resource kind: **agents**. Skills and plugins are deferred to later stages (see `FUTURE.md`).

### Agents

Portable unit describing a named agent persona or role.

Suggested shape:

```text
.agentctl/agents/<name>/
  agent.json
  description.md
  prompt.md
```

`agent.json` should hold portable metadata, not harness-native schema.

Example fields:

- `name`
- `description`
- `capabilities`
- `defaultModelClass`
- `tools`
- `executionHints`
- `adapterOverrides`

## Configuration Layers

There should be three config layers:

1. built-in defaults shipped with `agentctl` (including starter model mappings)
2. global config in `~/.agentctl/`
3. project config in `<repo>/.agentctl/`

Merge rule:

- maps merge by key
- scalar project values override global values
- named resources (agents) shadow by name at the project level
- adapter-specific arrays are replace, not append, unless explicitly marked mergeable

## Models

Portable model names are a core feature.

Example portable classes:

- `small`
- `medium`
- `large`
- `planning`
- `editing`
- `reasoning`

These should map per harness and optionally per command mode.

Example:

```json
{
  "modelClasses": {
    "small": {
      "claude": "haiku",
      "codex": "gpt-4.2",
      "opencode": "some-fast-model"
    },
    "large": {
      "claude": "opus",
      "codex": "gpt-5.4",
      "opencode": "some-strong-model"
    }
  }
}
```

Important constraints:

- portable classes should be semantic, not marketing-derived. `small` and `planning` are stable abstractions; provider model names are not.
- model mappings are **user-owned**. `agentctl init` scaffolds sensible defaults, but the user maintains their `models.json`. agentctl does not auto-update mappings when providers ship new models.
- project `models.json` overrides global `models.json` per the standard merge rules.

## Adapter Architecture

Every harness is implemented as an adapter.

Suggested TypeScript interface:

```ts
export interface HarnessAdapter {
  id: string;
  detect(context: AdapterContext): Promise<DetectionResult>;
  capabilities(): HarnessCapabilities;
  resolveInstallPaths(context: AdapterContext): HarnessPaths;
  listInstalled(context: AdapterContext): Promise<InstalledResources>;
  listUnmanaged(context: AdapterContext): Promise<UnmanagedResource[]>;
  renderAgent(input: RenderAgentInput): Promise<RenderedFile[]>;
  importAgents(context: AdapterContext): Promise<ImportedAgent[]>;
  sync(context: SyncContext): Promise<SyncResult>;
  buildRunCommand(input: RunCommandInput): Promise<CommandSpec>;
}
```

### Adapter Responsibilities

- know where that harness installs agents/skills/plugins
- know how to translate portable resources into harness-native files
- declare supported capabilities
- know how to build interactive and headless commands
- report unsupported actions clearly

### Adapter Capabilities

Each adapter should declare a structured capability set, for example:

```ts
type HarnessCapabilities = {
  interactiveRun: boolean;
  headlessRun: boolean;
  customAgents: boolean;
  directAgentLaunch: boolean;
};
```

This matters because not all mismatches should be hidden. Example: if Codex cannot directly drop into a custom agent, `agentctl run --agent reviewer` should either:

- emulate it through a bootstrap prompt if the user allows degraded behavior, or
- fail with a clear capability error

That choice should be explicit, not silent.

## Sync Model

`agentctl` should own synchronization into harness-native directories.

Suggested commands:

```bash
agentctl sync
agentctl sync claude
agentctl sync codex --project-only
agentctl sync --dry-run
```

Behavior:

- read merged `.agentctl` state
- compute desired harness-native artifacts
- diff against existing generated files
- write changes
- warn about unmanaged agents found in harness directories that agentctl does not know about
- optionally delete stale generated files that are tracked in the sync manifest

### Ownership Rules

After import or creation, agentctl **owns** agents it manages. On sync:

- agents with the same name as an agentctl-managed agent are overwritten in the harness directory
- unmanaged agents (present in the harness directory but not in `.agentctl/`) trigger a warning, not deletion
- name collisions between an unmanaged harness agent and a new agentctl agent require `--force` or interactive confirmation

### Sync State

Sync state is stored in `~/.agentctl/state/` and tracks:

- which files were written to which harness directories
- content hashes of managed files (to detect external edits)
- project identity (keyed to avoid collisions across repos)

This directory is machine-local and should never be committed to version control.

### What Sync Does Not Touch

- harness-managed runtime state (memory, session history, task logs)
- `CLAUDE.md` and equivalent harness-specific system prompt files
- harness settings files (e.g., `.claude/settings.json`)

## Run Model

The CLI should separate normalized intent from harness-specific invocation.

Suggested commands:

```bash
agentctl run -h claude
agentctl run -h codex --agent implementer
agentctl run -h opencode --headless --prompt-file task.txt
```

Normalized flags:

- `--harness`
- `--agent`
- `--model`
- `--headless`
- `--prompt`
- `--prompt-file`
- `--cwd`
- `--env`
- `--dry-run`
- `--degraded-ok`

`--degraded-ok` is important. It gives a clean way to say "I know this harness cannot do the exact thing; give me the closest supported fallback."

## Listing Model

There are two distinct list operations and they should not be conflated:

1. `agentctl list`
   Lists resources from the canonical `.agentctl` source of truth.

2. `agentctl harness list <name>`
   Lists resources currently installed where that harness expects them.

This distinction avoids confusion between "defined" and "synced".

Examples:

```bash
agentctl list agents
agentctl list agents --global
agentctl harness list claude agents
```

## Local vs Global Semantics

Resolution order:

1. project `.agentctl/`
2. global `~/.agentctl/`
3. built-in defaults

For named resources:

- project-local shadows global by name
- commands should indicate origin in list output

Example output:

```text
implementer  project  .agentctl/agents/implementer
debugger     global   ~/.agentctl/agents/debugger
```

## File Formats

Use JSON or JSONC first, not YAML.

Reasoning:

- TypeScript/Node handles JSON trivially
- schema validation tooling is simpler
- fewer parser edge cases
- easier to keep deterministic formatting

Markdown remains correct for long-form prompts and descriptions.

Suggested rule:

- metadata in `*.json`
- long prompts/docs in `*.md`

## TypeScript/Node Rationale

This fits the problem well:

- easy cross-platform filesystem/process handling
- easy npm distribution
- consistent with existing harness ecosystems
- good schema validation ecosystem via `zod`, `typescript-json-schema`, or similar

Recommended runtime target:

- Node 20+

Recommended packaging:

- plain TypeScript source
- ship via npm
- start without bundling
- optionally add `pkg`/`ncc`/`esbuild` single-file packaging later if distribution needs it

## Internal Module Layout

Suggested layout:

```text
src/
  cli/
  config/
  models/
  resources/
    agents/
  adapters/
    base.ts
    claude.ts
  sync/
  run/
  list/
  util/
```

Additional adapters (`codex.ts`, `opencode.ts`) are added as later milestones validate the adapter interface.

## Command Surface

Suggested v1 command structure:

```bash
agentctl init [--from claude]
agentctl sync [harness]
agentctl run --harness <name> [options]
agentctl list <resource-kind>
agentctl harness list <harness> <resource-kind>
agentctl doctor
```

### `init`

Creates `.agentctl/` in the current repo with starter config, including default `models.json`.

With `--from claude`: imports existing agent definitions from `.claude/agents/` into `.agentctl/agents/`. Only Claude is supported as an import source in v1. The command should clearly report what was imported and what was skipped (e.g., settings, memory, CLAUDE.md are not imported).

### `sync`

Generates harness-native artifacts from canonical config. Reports unmanaged agents found in harness directories.

### `run`

Builds and executes the appropriate harness command.

### `list`

Lists canonical resources.

### `harness list`

Lists installed resources from the harness-native location.

### `doctor`

Checks:

- config validity
- missing adapters
- missing harness binaries
- unsupported requested capabilities
- sync drift (managed files that have been externally modified)

## Extensibility Rules

To keep the system maintainable as more harnesses arrive:

1. The portable core must not depend on one harness's schema.
2. Every harness-specific behavior must live behind the adapter interface.
3. Capability gaps must be explicit and testable.
4. Generated output paths must come from adapter logic, not hardcoded CLI code.
5. Resource schemas must be versioned.

## Versioning

Every portable manifest should include a version:

```json
{
  "version": 1
}
```

This gives a migration path when the resource model changes.

## Failure Model

The system should fail in one of three ways:

1. hard error
   The requested action is impossible or ambiguous.

2. degraded execution
   The adapter can approximate the action and the user allowed it.

3. skipped sync
   The adapter does not support that resource kind.

These states should be explicit in CLI output.

## Open Questions

1. Should headless execution return normalized JSON output where possible, or is pass-through stdout enough for v1?
2. Should degraded behavior be opt-in globally, per command, or per adapter?

## Decisions Made

These questions were considered and resolved during design:

- **Import from harness**: Yes. `agentctl init --from claude` is supported in v1 as a one-time bootstrap. Only Claude is supported as an import source initially.
- **Skills in v1**: No. v1 focuses on agents and model aliases. Skills are deferred (see `FUTURE.md`).
- **Plugins in v1**: No. Plugins are deferred (see `FUTURE.md`).
- **Memory management**: No. agentctl manages agent definitions only. Runtime state (memory, sessions, tasks) remains harness-managed.
- **Model mapping ownership**: User-owned. agentctl scaffolds defaults but the user maintains `models.json`.

## v1 Scope

Keep v1 narrow:

1. portable agent definitions
2. portable model class mappings (user-owned)
3. `init` with `--from claude` import
4. `sync` with ownership tracking and unmanaged-agent warnings
5. `run`
6. `list`
7. Claude Code adapter only
8. `doctor`

## Milestones

### Milestone 1

- scaffold TypeScript CLI
- implement config loading and layered merge
- implement portable agent manifest
- implement model class mapping
- implement `init` with starter scaffolding

### Milestone 2

- implement Claude adapter (detect, renderAgent, importAgents, listUnmanaged)
- implement `init --from claude`
- implement sync for agents with ownership tracking
- implement `list`

### Milestone 3

- implement `run` (interactive and headless)
- implement `doctor`
- implement capability reporting and degraded-mode handling

### Milestone 4

- add Codex adapter to validate the adapter interface against a second harness
- resolve any interface changes needed based on real-world usage
- add OpenCode adapter if the interface holds

See `FUTURE.md` for later-stage plans (skills, plugins, memory, registries).

## Recommendation

The right framing is not "universal wrapper around provider CLIs".

The right framing is:

`agentctl` is the canonical config and orchestration layer for coding harnesses, with adapters that generate and run harness-native artifacts.

That keeps the architecture honest:

- `.agentctl/` is the source of truth
- harness folders are targets
- adapters own incompatibilities
- the user gets one stable interface without pretending the underlying runtimes are identical
