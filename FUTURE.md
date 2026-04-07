# agentctl Future Stages

This document covers features deferred from v1. See `DESIGN.md` for the current scope.

## Stage 2: Skills

### Rationale for Deferral

Skills are deeply coupled to harness-specific tool surfaces. A Claude Code skill that references `Read`, `Edit`, and `Bash` tools cannot be trivially ported to Codex or OpenCode, which have different tool names and execution models. Attempting to generalize skills before understanding real cross-harness usage patterns would produce a leaky abstraction.

### When to Revisit

After v1 ships and at least two adapters (Claude + Codex) are in use, observe:

- which skills users actually want to share across harnesses
- whether the portable parts of a skill (prompt text, description) are sufficient without tool portability
- whether "emulated" skill support (injecting skill prompts as system context) is good enough

### Proposed Approach

```text
.agentctl/skills/<name>/
  skill.json
  SKILL.md
  assets/
  scripts/
```

Adapter capabilities would expand:

```ts
type HarnessCapabilities = {
  // ...existing fields
  skills: "native" | "emulated" | "unsupported";
};
```

"Emulated" means the adapter injects the skill's prompt content into the agent context rather than registering it as a native skill. This is a reasonable fallback for harnesses without native skill support.

## Stage 2: Plugins

### Rationale for Deferral

Plugin packaging and lifecycle semantics vary significantly across harnesses. MCP servers, Claude Code plugins, and Codex extensions have fundamentally different installation, configuration, and execution models. Portable plugin abstraction requires at least two harnesses with comparable plugin semantics.

### When to Revisit

When at least two supported harnesses have plugin/extension systems mature enough to compare. Currently Claude Code has MCP and plugins; Codex and OpenCode plugin models are less mature.

### Proposed Approach

- define a portable plugin manifest
- mark plugin sync as per-adapter and optional
- adapters declare plugin support level in capabilities

```ts
type HarnessCapabilities = {
  // ...existing fields
  plugins: "native" | "partial" | "unsupported";
};
```

## Stage 3: Memory Portability

### Rationale for Deferral

Memory is fundamentally different from agent definitions:

- **Definitions are static and declarative.** A prompt file doesn't change during a session.
- **Memory is dynamic and temporal.** It accumulates during sessions and reflects harness-specific learnings.
- **Memory flows the wrong direction.** Definitions flow from agentctl into harnesses. Memory flows from harnesses back out. Bolting bidirectional sync onto a one-directional model adds significant complexity.
- **Memory may not be portable.** Learnings accumulated in Claude Code (e.g., "the Bash tool requires quoting paths with spaces") may be meaningless or harmful in a different harness.

### Current State

Claude Code stores per-project memory at `~/.claude/projects/<path-encoded-name>/memory/`. Other harnesses have their own memory locations and formats.

### When to Revisit

After observing real multi-harness usage:

- do users actually switch the same project between harnesses?
- is there memory that is genuinely portable (project architecture knowledge vs. harness-specific tips)?
- can memory be cleanly split into "project knowledge" (portable) and "harness knowledge" (not portable)?

### Possible Approaches

1. **Sync-back model**: On `agentctl sync --collect`, pull memory from harness directories into `.agentctl/`. Harness remains the writer; agentctl is the aggregator.

2. **Shared memory layer**: agentctl owns a memory directory, adapters symlink or copy to/from it. Requires solving merge semantics for free-form markdown.

3. **Memory tagging**: Memory entries are tagged with source harness. Portable entries are synced; harness-specific entries stay local.

None of these are ready for implementation without real usage data.

## Stage 3: Import from Additional Harnesses

v1 supports `agentctl init --from claude` only. Extending import to other harnesses requires:

- understanding each harness's native agent/config format
- mapping harness-specific fields to the portable manifest
- deciding what to do with harness-specific fields that have no portable equivalent

Add import support for each harness as its adapter matures.

## Stage 4: Remote Registries

### Concept

A registry for sharing portable agents and (eventually) skills across teams or publicly.

```bash
agentctl registry search "code reviewer"
agentctl registry install @org/reviewer
agentctl registry publish ./agents/reviewer
```

### Prerequisites

- stable resource manifest schema (v1 must prove the schema works)
- versioning strategy for published resources
- authentication and access control model
- decision on hosting (npm registry, custom, GitHub releases, etc.)

### Open Questions

- is this a package registry (like npm) or a catalog (like Terraform Registry)?
- should published agents include model mappings or leave those to the consumer?
- how are agent updates handled (pinned versions vs. floating)?

## Stage 4: Background Daemons

### Concept

A long-running process that watches `.agentctl/` for changes and auto-syncs into harness directories.

```bash
agentctl watch
agentctl watch --harness claude
```

### Risks

- re-entrancy: harness file watchers could detect changes from sync, triggering cascading updates
- resource usage on large repos
- complexity of daemon lifecycle management

### Prerequisites

- sync must be proven idempotent and safe to run repeatedly
- clear re-entrancy guards (e.g., lockfiles, debouncing, marker-file detection)

## Stage 5: Normalized Headless Output

### Concept

`agentctl run --headless` could return structured JSON output normalized across harnesses, rather than passing through raw harness stdout.

### Open Questions

- what does a "normalized result" look like for a coding agent run?
- is this even desirable, or do CI/CD consumers prefer harness-native output?
- how do you normalize success/failure when different harnesses define it differently?

This should be driven by real CI/CD integration needs, not designed speculatively.
