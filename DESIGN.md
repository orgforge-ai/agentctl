# agentctl Design

## Goal

`agentctl` is a portable control plane for coding-agent harnesses such as Claude Code, Codex, OpenCode, and future runtimes.

It provides:

- one cross-platform source of truth for agents, skills, and possibly plugins
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

## Core Idea

`.agentctl/` and `~/.agentctl/` become the canonical source of truth.

- `~/.agentctl/` is the global layer
- `<repo>/.agentctl/` is the project layer
- harness-native folders such as `.claude/`, `.codex/`, and `.opencode/` are generated or synchronized artifacts

This is intentionally similar to how Terraform treats provider state and generated artifacts: user-owned config lives in one place, adapter-owned outputs live elsewhere.

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
  skills/
  plugins/
  adapters/
```

Project:

```text
<repo>/.agentctl/
  config.json
  models.json
  agents/
  skills/
  plugins/
```

Generated harness artifacts:

```text
<repo>/.claude/
<repo>/.codex/
<repo>/.opencode/
```

Notes:

- project config overrides global config
- project agents/skills augment or shadow global entries by name
- generated harness directories should be safe to recreate

## Resource Model

There are three portable resource kinds:

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

### Skills

Portable unit that can be global or project-local.

Suggested shape:

```text
.agentctl/skills/<name>/
  skill.json
  SKILL.md
  assets/
  scripts/
```

This mirrors existing skill conventions closely enough that agentctl can import/export rather than inventing a totally foreign format.

### Plugins

This should be included in the design, but likely start as an experimental adapter surface rather than a hard promise.

Reason:

- plugins appear more harness-specific than agents and skills
- plugin packaging and lifecycle semantics may differ much more across harnesses

Recommendation:

- define a portable plugin manifest now
- mark plugin sync support as per-adapter and optional in v1

## Configuration Layers

There should be three config layers:

1. built-in defaults shipped with `agentctl`
2. global config in `~/.agentctl/`
3. project config in `<repo>/.agentctl/`

Merge rule:

- maps merge by key
- scalar project values override global values
- named resources shadow by name at the project level
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

Important constraint:

portable classes should be semantic, not marketing-derived. `small` and `planning` are stable abstractions; provider model names are not.

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
  renderAgent(input: RenderAgentInput): Promise<RenderedFile[]>;
  renderSkill?(input: RenderSkillInput): Promise<RenderedFile[]>;
  renderPlugin?(input: RenderPluginInput): Promise<RenderedFile[]>;
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
  skills: "native" | "emulated" | "unsupported";
  plugins: "native" | "partial" | "unsupported";
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
- optionally delete stale generated files that are marked as managed by agentctl

Important rule:

only files marked as agentctl-managed should be overwritten or deleted. This avoids destroying user-owned native config.

Suggested mechanism:

- place a management marker in generated files when the harness format allows it
- keep a small manifest under `.agentctl/state/` that tracks generated outputs

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
agentctl list skills --global
agentctl harness list claude agents
agentctl harness list codex skills
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
    skills/
    plugins/
  adapters/
    base.ts
    claude.ts
    codex.ts
    opencode.ts
  sync/
  run/
  list/
  util/
```

## Command Surface

Suggested v1 command structure:

```bash
agentctl init
agentctl sync [harness]
agentctl run --harness <name> [options]
agentctl list <resource-kind>
agentctl harness list <harness> <resource-kind>
agentctl doctor
```

### `init`

Creates `.agentctl/` in the current repo with starter config.

### `sync`

Generates harness-native artifacts from canonical config.

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
- sync drift

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

1. Should `.agentctl/` support importing harness-native definitions as a bootstrap path, or only export/sync?
2. Are skills portable enough to be first-class in v1, or should v1 focus on agents plus model aliases?
3. Do plugins belong in the portable core yet, or should they remain adapter-specific until at least two harnesses have comparable plugin semantics?
4. Should headless execution return normalized JSON output where possible, or is pass-through stdout enough for v1?
5. Should degraded behavior be opt-in globally, per command, or per adapter?

## Recommended v1 Scope

Keep v1 narrow:

1. portable agents
2. portable model classes
3. `sync`
4. `run`
5. `list`
6. adapters for Claude Code, Codex, and OpenCode

Delay to v2:

- strong plugin support
- import from native harness configs
- remote registries
- background daemons

## Recommended First Milestones

### Milestone 1

- scaffold TypeScript CLI
- implement config loading and layered merge
- implement portable agent manifest
- implement model class mapping

### Milestone 2

- implement Claude adapter
- implement sync for agents
- implement `run`
- implement `list`

### Milestone 3

- add Codex and OpenCode adapters
- add capability reporting and degraded-mode handling
- add `doctor`

### Milestone 4

- add skills
- decide whether plugins stay experimental or become first-class

## Recommendation

The right framing is not "universal wrapper around provider CLIs".

The right framing is:

`agentctl` is the canonical config and orchestration layer for coding harnesses, with adapters that generate and run harness-native artifacts.

That keeps the architecture honest:

- `.agentctl/` is the source of truth
- harness folders are targets
- adapters own incompatibilities
- the user gets one stable interface without pretending the underlying runtimes are identical
