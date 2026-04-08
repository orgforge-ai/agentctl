# agentctl Design

## Goal

`agentctl` is a portable control plane for coding-agent harnesses such as Claude Code, OpenCode, Codex, and future runtimes.

It provides:

- one cross-platform source of truth for agent definitions, skill directories, and model mappings
- one normalized CLI for interactive and headless execution
- adapter-based synchronization into harness-specific config layouts
- provider-agnostic model aliases such as `small`, `medium`, and `large`
- an extension model that makes adding new harnesses cheap

It does not try to pretend all harnesses are identical. Where capabilities differ, `agentctl` should expose a stable abstraction and surface capability gaps clearly.

## Non-Goals

- perfect feature parity across all harnesses
- lossless round-tripping from harness-native config back into `.agentctl`
- hiding every provider-specific detail
- managing arbitrary non-coding agent runtimes from day one
- managing runtime state such as session history, memory, or task logs

## Core Idea

`.agentctl/` and `~/.agentctl/` are the canonical source of truth for portable resources and model mappings.

- `~/.agentctl/` is the global layer
- `<repo>/.agentctl/` is the project layer
- harness-native folders such as `.claude/` and `.opencode/` are synchronized artifacts

This is intentionally similar to Terraform’s split between user-owned source configuration and generated provider artifacts.

### Ownership Boundary

agentctl manages static, declarative resources:

- agent definitions
- skill definitions
- model mappings

Runtime state such as session history, harness memory, task logs, and harness settings remains harness-managed. agentctl pushes definitions into harness directories; it does not sync runtime state back out.

## Primary Use Cases

1. Define portable agents once and sync them into multiple harnesses.
2. Define portable skills once and sync them into multiple harnesses.
3. Launch a harness interactively through one consistent CLI.
4. Launch a harness headlessly through one consistent CLI.
5. List what agents and skills are available from canonical config and from installed harness locations.
6. Add support for a new harness without rewriting the whole system.

## Directory Model

Global:

```text
~/.agentctl/
  config.json
  models.json
  agents/
  skills/
  state/            # sync state, keyed per project
```

Project:

```text
<repo>/.agentctl/
  config.json
  models.json
  agents/
  skills/
```

Generated harness artifacts:

```text
<repo>/.claude/
  agents/
  skills/

<repo>/.opencode/
  agents/
  skills/
```

Notes:

- project config overrides global config
- project agents shadow global agents by name
- project skills shadow global skills by name
- generated harness directories should be safe to recreate
- `~/.agentctl/state/` tracks sync metadata and is never committed

## Resource Model

v1 has two portable resource kinds: **agents** and **skills**.

### Agents

Portable unit describing a named agent persona or role.

```text
.agentctl/agents/<name>/
  agent.json
  description.md
  prompt.md
```

`agent.json` holds portable metadata, not harness-native schema.

Example fields:

- `name`
- `description`
- `defaultModelClass`
- `capabilities`
- `tools`
- `executionHints`
- `adapterOverrides`

### Skills

Portable unit describing a reusable task capability.

```text
.agentctl/skills/<name>/
  skill.json
  SKILL.md
  scripts/
  references/
  assets/
```

`skill.json` holds portable metadata. `SKILL.md` is the standard skill entrypoint. Optional bundled directories are copied through to the harness.

Example fields:

- `name`
- `description`
- `adapterOverrides`

## Configuration Layers

There are three config layers:

1. built-in defaults shipped with `agentctl`
2. global config in `~/.agentctl/`
3. project config in `<repo>/.agentctl/`

Merge rules:

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

Example:

```json
{
  "modelClasses": {
    "small": {
      "claude": "haiku",
      "opencode": "some-fast-model"
    },
    "large": {
      "claude": "opus",
      "opencode": "some-strong-model"
    }
  }
}
```

Important constraints:

- portable classes should be semantic, not marketing-derived
- model mappings are user-owned
- project `models.json` overrides global `models.json` under the standard merge rules

## Adapter Architecture

Every harness is implemented as an adapter.

Current adapters:

- Claude Code
- OpenCode

Suggested interface shape:

```ts
export interface HarnessAdapter {
  id: string;
  detect(context: AdapterContext): Promise<DetectionResult>;
  capabilities(): HarnessCapabilities;
  resolveInstallPaths(context: AdapterContext): HarnessPaths;
  listInstalled(context: AdapterContext): Promise<InstalledResources>;
  listUnmanaged(context: AdapterContext): Promise<UnmanagedResource[]>;
  renderAgent(input: RenderAgentInput): Promise<RenderedFile[]>;
  renderSkill(input: RenderSkillInput): Promise<RenderedFile[]>;
  importAgents(context: AdapterContext): Promise<ImportedAgent[]>;
  sync(context: SyncContext): Promise<SyncResult>;
  buildRunCommand(input: RunCommandInput): Promise<CommandSpec>;
}
```

### Adapter Responsibilities

- know where that harness installs agents and skills
- know how to translate portable agents into harness-native files
- know how to materialize skills into the harness skill directory
- declare supported capabilities
- know how to build interactive and headless commands
- report unsupported actions clearly

### Adapter Capabilities

Current shared capability shape:

```ts
type HarnessCapabilities = {
  interactiveRun: boolean;
  headlessRun: boolean;
  customAgents: boolean;
  directAgentLaunch: boolean;
};
```

Skills are currently treated as standard directory resources during sync. More advanced per-harness skill capability modeling can be added later if needed.

## Sync Model

`agentctl sync` owns synchronization into harness-native directories.

Examples:

```bash
agentctl sync
agentctl sync claude
agentctl sync opencode --project-only
agentctl sync --dry-run
```

Behavior:

- read merged `.agentctl` state
- compute desired harness-native artifacts
- render agents into harness-native files
- copy skills as directory trees into harness-native skill locations
- write changes
- warn about unmanaged agents or skills found in harness directories

### Ownership Rules

After creation or import, agentctl owns the resources it manages. On sync:

- managed agents are overwritten in the harness directory
- managed skills are overwritten in the harness directory
- unmanaged resources trigger warnings, not deletion
- name collisions with unmanaged harness resources require `--force`

### Sync State

Sync state is stored in `~/.agentctl/state/` and tracks:

- which files were written to which harness directories
- whether each file belongs to an agent or a skill
- content hashes of managed files
- project identity keyed from the project root

This directory is machine-local and should never be committed.

### What Sync Does Not Touch

- harness-managed runtime state
- `CLAUDE.md` and equivalent harness-specific system prompt files
- harness settings files such as `.claude/settings.json`
- credentials and trust metadata

## Run Model

The CLI separates normalized intent from harness-specific invocation.

Examples:

```bash
agentctl run -h claude
agentctl run -h opencode --agent implementer
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

Current run support is agent-oriented. Skill activation is handled by syncing skills into harness lookup directories rather than by a separate `run --skill` flag.

## Listing Model

There are two list operations:

1. `agentctl list <resource>`
   Lists canonical resources from `.agentctl`.

2. `agentctl harness list <harness> <resource>`
   Lists resources installed in the harness-native location.

Examples:

```bash
agentctl list agents
agentctl list skills
agentctl list skills --global
agentctl harness list claude agents
agentctl harness list opencode skills
```

## Local vs Global Semantics

Resolution order:

1. project `.agentctl/`
2. global `~/.agentctl/`
3. built-in defaults

For named resources:

- project-local shadows global by name
- commands indicate origin in list output

Example output:

```text
implementer        project  .agentctl/agents/implementer
postgres-migrate   global   ~/.agentctl/skills/postgres-migrate
```

## File Formats

Use JSON for metadata and Markdown for long-form content.

Rules:

- metadata in `*.json`
- long prompts/docs in `*.md`
- `SKILL.md` is preserved as the skill entrypoint

## TypeScript/Node Rationale

This fits the problem well:

- easy cross-platform filesystem and process handling
- easy npm distribution
- good schema validation ecosystem
- good fit for filesystem-heavy adapter logic

Recommended runtime target:

- Node 20+

## Internal Module Layout

Current layout:

```text
src/
  adapters/
  cli/
  config/
  resources/
    agents/
    skills/
  sync/
  util/
```

## Command Surface

Current command structure:

```bash
agentctl init [--from claude]
agentctl sync [harness]
agentctl run --harness <name> [options]
agentctl list <resource-kind>
agentctl harness list <harness> <resource-kind>
agentctl doctor
```

### `init`

Creates `.agentctl/` in the current repo with starter config:

- `config.json`
- `models.json`
- `agents/`
- `skills/`

With `--from claude`, imports existing agent definitions from `.claude/agents/` into `.agentctl/agents/`. Skill import is not implemented.

### `sync`

Generates harness-native artifacts from canonical config. Reports unmanaged agents and unmanaged skills.

### `run`

Builds and executes the appropriate harness command.

### `list`

Lists canonical agents or skills.

### `harness list`

Lists installed agents or skills from the harness-native location.

### `doctor`

Checks:

- config validity
- project setup
- canonical agent count
- canonical skill count
- harness availability
- unmanaged resources
- sync drift

## Extensibility Rules

To keep the system maintainable as more harnesses arrive:

1. The portable core must not depend on one harness's schema.
2. Harness-specific behavior lives behind the adapter interface.
3. Capability gaps must be explicit and testable.
4. Generated output paths come from adapter logic, not hardcoded CLI code.
5. Resource schemas are versioned.

## Versioning

Every portable manifest includes a version:

```json
{
  "version": 1
}
```

## Failure Model

The system should fail in one of three ways:

1. hard error
   The requested action is impossible or ambiguous.

2. degraded execution
   The adapter can approximate the action and the user allowed it.

3. skipped sync
   The adapter detects an unmanaged conflict and refuses to overwrite without `--force`.

These states should be explicit in CLI output.

## Decisions Made

- **Import from harness**: `agentctl init --from claude` is supported for agents only.
- **Skills in v1**: Yes. v1 includes first-class skill resources using `skill.json` plus `SKILL.md`.
- **Skill sync model**: Skills are synchronized as directory resources under harness `skills/` directories.
- **Plugins in v1**: No. Plugins are deferred.
- **Memory management**: No. Runtime state remains harness-managed.
- **Model mapping ownership**: User-owned.
- **Current harness support**: Claude Code and OpenCode.

## v1 Scope

Keep v1 narrow:

1. portable agent definitions
2. portable skill definitions
3. portable model class mappings
4. `init` with starter scaffolding and `--from claude` agent import
5. `sync` with ownership tracking and unmanaged-resource warnings
6. `run`
7. `list`
8. `doctor`
9. Claude Code and OpenCode adapters

## Future Work

See `FUTURE.md` for later-stage plans such as plugin portability, additional harness imports, remote registries, and more advanced skill capability modeling.

## Recommendation

The right framing is not “universal wrapper around provider CLIs.”

The right framing is:

`agentctl` is the canonical config and orchestration layer for coding harnesses, with adapters that generate and synchronize harness-native artifacts.

That keeps the architecture honest:

- `.agentctl/` is the source of truth
- harness folders are targets
- adapters own incompatibilities
- the user gets one stable interface without pretending the underlying runtimes are identical
