# agentctl Design

This document mixes current implementation details with intended direction.
`agentctl` is still an early prototype, so treat this as design guidance rather
than a stability guarantee for the CLI, config schema, or generated artifacts.

## Goal

`agentctl` is a portable control plane for coding-agent harnesses such as Claude Code, OpenCode, Codex, and future runtimes.

It provides:

- one cross-platform source of truth for agent definitions and model mappings
- one normalized CLI for interactive and headless execution
- adapter-based synchronization into harness-specific config layouts
- provider-agnostic model aliases such as `small`, `medium`, and `large`
- an extension model that makes adding new harnesses cheap

Skill distribution is handled by [skillshare](./SKILLSHARE.md), which reads from `.agentctl/skills/` and syncs to all target harnesses. agentctl focuses on agents and run orchestration.

It does not try to pretend all harnesses are identical. Where capabilities differ, `agentctl` should expose a stable abstraction and surface capability gaps clearly.

## Non-Goals

- perfect feature parity across all harnesses
- lossless round-tripping from harness-native config back into `.agentctl`
- hiding every provider-specific detail
- managing arbitrary non-coding agent runtimes from day one
- managing runtime state such as session history, memory, or task logs
- skill distribution and synchronization (delegated to [skillshare](./SKILLSHARE.md))

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
2. Launch a harness interactively through one consistent CLI.
3. Launch a harness headlessly through one consistent CLI.
4. List what agents are available from canonical config and from installed harness locations.
5. Add support for a new harness without rewriting the whole system.
6. Optionally integrate with skillshare for skill distribution (see [SKILLSHARE.md](./SKILLSHARE.md)).

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
  skills/              ← skillshare reads from here (see SKILLSHARE.md)
```

Generated harness artifacts:

```text
<repo>/.claude/
  agents/              ← agentctl sync writes here
  skills/              ← skillshare sync writes here

<repo>/.opencode/
  agents/
  skills/
```

Notes:

- project config overrides global config
- project agents shadow global agents by name
- generated harness directories should be safe to recreate
- `~/.agentctl/state/` tracks sync metadata and is never committed
- skill directories are managed by skillshare, not agentctl

## Resource Model

v1 has one portable resource kind: **agents**. Skills are stored in `.agentctl/skills/` using standard SKILL.md format and distributed by [skillshare](./SKILLSHARE.md).

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

- `version` (required, default 1)
- `name` (required, must match `^[a-zA-Z0-9_-]+$`)
- `description`
- `defaultModelClass`
- `capabilities` (string array)
- `tools` (string array)
- `executionHints` (record of arbitrary key-value pairs)
- `adapterOverrides` (nested record keyed by adapter id)

### Skills

Skills live in `.agentctl/skills/` as directories containing `SKILL.md` with YAML frontmatter. agentctl creates this directory but does not sync skills to harness directories — that is skillshare's job. See [SKILLSHARE.md](./SKILLSHARE.md) for the full integration design.

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
- model classes merge per-class: each class is a record of harness→model mappings that deep-merges across layers
- harness profiles deep-merge across layers (project profiles override global profiles by key)

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

Per-harness entries may be either a plain string or a structured object. The
structured form lets a model class carry harness-specific frontmatter (e.g.
OpenCode reasoning settings) that gets merged into rendered agent files:

```json
{
  "modelClasses": {
    "reasoning": {
      "opencode": {
        "model": "openai/gpt-5.4",
        "frontmatter": {
          "reasoning_effort": "high"
        }
      }
    }
  }
}
```

Both forms are interchangeable: string mappings are normalized to
`{ "model": "…" }` at load time. Frontmatter from `models.json` takes
precedence over agent-level adapter overrides.

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
  displayName: string;
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

- know where that harness installs agents
- know how to translate portable agents into harness-native files
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

Skills are managed by skillshare, not by adapter sync. See [SKILLSHARE.md](./SKILLSHARE.md).

### Harness Profiles

Config may define named harness profiles that extend a built-in adapter with custom paths and run-time settings:

```json
{
  "harnesses": {
    "opencode-zai": {
      "adapter": "opencode",
      "paths": {
        "projectAgentsDir": ".opencode-zai/agents",
        "globalAgentsDir": "~/.config/opencode-zai/agents"
      },
      "run": {
        "env": {
          "OPENCODE_CONFIG": "/path/to/opencode-zai.json"
        }
      }
    }
  }
}
```

Profile resolution:

- `adapter` specifies which built-in adapter to use (e.g. `"opencode"`).
- `paths.projectAgentsDir` is required; `paths.globalAgentsDir` is optional.
- `run.env` sets environment variables applied during `agentctl run`. CLI `--env` flags override profile env.
- Profile targets flatten all agents (global + project) to `projectAgentsDir` to avoid multi-directory conflicts.

See [OPENCODE_PROFILE_SYNC_PLAN.md](./OPENCODE_PROFILE_SYNC_PLAN.md) for the design rationale.

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
- write changes
- warn about unmanaged agents found in harness directories

### Ownership Rules

After creation or import, agentctl owns the resources it manages. On sync:

- managed agents are overwritten in the harness directory
- unmanaged agents trigger warnings, not deletion
- name collisions with unmanaged harness resources require `--force`
- skill directories are not touched (managed by skillshare)

### Sync State

Sync state is stored in `~/.agentctl/state/` and tracks:

- which files were written to which harness directories
- whether each file belongs to an agent
- content hashes of managed files
- project identity keyed from the project root

This directory is machine-local and should never be committed.

### What Sync Does Not Touch

- harness-managed runtime state
- `CLAUDE.md` and equivalent harness-specific system prompt files
- harness settings files such as `.claude/settings.json`
- credentials and trust metadata
- skill directories (managed by skillshare)

## Run Model

The CLI separates normalized intent from harness-specific invocation.

Examples:

```bash
agentctl run -h claude
agentctl run -h opencode --agent implementer
agentctl run -h opencode --headless --prompt-file task.txt
```

Normalized flags:

- `--harness` (required)
- `--agent`
- `--model`
- `--headless`
- `--prompt`
- `--prompt-file`
- `--cwd`
- `--env` (repeatable, `KEY=VALUE` format)
- `--dry-run`
- `--degraded-ok`

Current run support is agent-oriented. Skills are available to the harness via skillshare sync but are not activated or selected by agentctl.

## Listing Model

There are two list operations:

1. `agentctl list <resource>`
    Lists canonical resources from `.agentctl`.

    Supported resource kinds: `agents`.

    Skills can be listed via `skillshare list`.

2. `agentctl harness list <harness> <resource>`
   Lists resources installed in the harness-native location.

Examples:

```bash
agentctl list agents
agentctl harness list claude agents
agentctl harness list opencode agents
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
- skills use `SKILL.md` with YAML frontmatter (see [SKILLSHARE.md](./SKILLSHARE.md))

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
    base.ts          HarnessAdapter interface and shared types
    claude.ts        Claude Code adapter
    opencode.ts      OpenCode adapter
    registry.ts      Adapter registration and target resolution
    sync-utils.ts    Shared sync logic
  cli/
    index.ts         Commander entry point
    init.ts          agentctl init
    sync.ts          agentctl sync
    run.ts           agentctl run
    list.ts          agentctl list / harness list
    doctor.ts        agentctl doctor
  config/
    schema.ts        Zod schemas for config and models
    defaults.ts      Built-in default values
    index.ts         Config loading and merging
  resources/
    agents/
      schema.ts      AgentManifest schema and Agent type
      index.ts       Agent loading (global + project)
    skills/          (empty — managed by skillshare)
  sync/
    index.ts         Sync orchestration
    state.ts         Sync manifest tracking (content hashes, file index)
  skillshare/
    index.ts         Skillshare binary management and skill listing
  util/
    index.ts         File I/O, hashing, path resolution
  errors.ts          AgentctlError base class
```

## Command Surface

Current command structure:

```bash
agentctl init [--from <harness>] [--with-skillshare]
agentctl sync [harness] [--dry-run] [--force]
agentctl run --harness <name> [options]
agentctl list <resource-kind> [--global]
agentctl harness list <harness> <resource-kind>
agentctl doctor
```

### `init`

Creates `.agentctl/` in the current repo with starter config:

- `config.json`
- `models.json`
- `agents/`
- `skills/` (empty, for skillshare to read from)

With `--from <harness>`, imports existing agent definitions from the harness's native agents directory into `.agentctl/agents/`.

With `--with-skillshare`, also installs skillshare (if needed) and creates `.skillshare/config.yaml` pointing at `.agentctl/skills/`. See [SKILLSHARE.md](./SKILLSHARE.md).

### `sync`

Generates harness-native artifacts from canonical config. Reports unmanaged agents and unmanaged skills.

Flags:

- `--dry-run` — preview changes without writing
- `--force` — overwrite conflicting unmanaged agents

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
- harness availability
- unmanaged agents
- sync drift
- skillshare installation and configuration (if skills exist)

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
- **Skill distribution**: Delegated to skillshare. agentctl creates `.agentctl/skills/` but does not sync skills to harness directories. See [SKILLSHARE.md](./SKILLSHARE.md).
- **Skill format**: SKILL.md with YAML frontmatter (compatible with skillshare and the emerging Agent Skills standard).
- **Plugins in v1**: No. Plugins are deferred.
- **Memory management**: No. Runtime state remains harness-managed.
- **Model mapping ownership**: User-owned.
- **Current harness support**: Claude Code and OpenCode.

## v1 Scope

Keep v1 narrow:

1. portable agent definitions
2. portable model class mappings
3. `init` with starter scaffolding and `--from claude` agent import
4. `init --with-skillshare` for integrated skill setup
5. `sync` with ownership tracking and unmanaged-resource warnings (agents only)
6. `run`
7. `list`
8. `doctor`

## Future Work

See `FUTURE.md` for later-stage plans such as plugin portability, additional harness imports, remote registries, and more.

## Recommendation

The right framing is not “universal wrapper around provider CLIs.”

The right framing is:

`agentctl` is the canonical config and orchestration layer for coding harnesses, with adapters that generate and synchronize harness-native artifacts.

That keeps the architecture honest:

- `.agentctl/` is the source of truth
- harness folders are targets
- adapters own incompatibilities
- the user gets one stable interface without pretending the underlying runtimes are identical
