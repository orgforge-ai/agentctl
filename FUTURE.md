# agentctl Future Stages

This document covers features deferred from the current implementation in `DESIGN.md`.

## Stage 2: Advanced Skill Support

Basic skill resources now exist in the portable model. The next layer of work is not “whether skills exist,” but how deeply agentctl should model harness-specific skill behavior.

### Open Questions

- should adapters expose explicit skill capability levels such as `native`, `emulated`, or `unsupported`
- should agentctl model per-harness skill permissions and allow/ask/deny states
- should skill activation be purely directory-based, or should `agentctl run` eventually support explicit skill selection
- should skill import from existing harness directories be supported the same way agent import is supported today

### Possible Directions

1. **Capability modeling**
   Extend adapter capabilities with a dedicated skill support field.

2. **Permission modeling**
   Add optional per-adapter settings for harnesses that support skill enable/disable controls.

3. **Explicit activation**
   Add `run --skill <name>` only if multiple harnesses can support equivalent behavior cleanly.

4. **Skill import**
   Support importing existing skill directories from harness-native locations into `.agentctl/skills/`.

## Stage 3: Plugins

### Rationale for Deferral

Plugin packaging and lifecycle semantics vary significantly across harnesses. MCP servers, Claude Code plugins, and future Codex/OpenCode extension systems have different installation, configuration, and execution models.

### When to Revisit

When at least two supported harnesses have plugin systems mature enough to compare directly.

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

## Stage 4: Memory Portability

### Rationale for Deferral

Memory is fundamentally different from agents and skills:

- **Definitions are static and declarative.**
- **Memory is dynamic and temporal.**
- **Memory flows the wrong direction.** Definitions flow from agentctl into harnesses. Memory would have to flow back out.
- **Memory may not be portable.** Harness-specific learnings can be meaningless or harmful elsewhere.

### Current State

Claude Code stores per-project memory under `~/.claude/projects/...`. Other harnesses have their own locations and formats.

### When to Revisit

After observing real multi-harness usage:

- do users switch the same repo between harnesses often enough to justify memory sync
- is there a useful subset of memory that is genuinely portable
- can memory be split into project knowledge versus harness knowledge

### Possible Approaches

1. **Sync-back model**
   On `agentctl sync --collect`, pull memory from harness directories into agentctl-managed storage.

2. **Shared memory layer**
   agentctl owns a memory directory and adapters copy or link to it.

3. **Tagged memory**
   Memory entries are tagged by source harness and only portable entries are shared.

## Stage 5: Import from Additional Harnesses

Current import support is `agentctl init --from claude` for agents only.

Future import work includes:

- agent import from additional harnesses
- skill import from harness-native `skills/` directories
- mapping harness-specific metadata into portable manifests
- deciding what to do with harness-native fields that have no portable equivalent

## Stage 6: Remote Registries

### Concept

A registry for sharing portable agents and skills across teams or publicly.

```bash
agentctl registry search "code reviewer"
agentctl registry install @org/reviewer
agentctl registry publish ./agents/reviewer
agentctl registry publish ./skills/postgres-migrate
```

### Prerequisites

- stable resource manifest schemas
- versioning strategy for published resources
- authentication and access control model
- decision on hosting

### Open Questions

- is this a package registry or a catalog
- should published resources include model mappings or leave those to the consumer
- how are updates handled

## Stage 7: Background Daemons

### Concept

A long-running process that watches `.agentctl/` for changes and auto-syncs into harness directories.

```bash
agentctl watch
agentctl watch --harness claude
```

### Risks

- re-entrancy between agentctl and harness file watchers
- resource usage on large repos
- daemon lifecycle complexity

### Prerequisites

- sync must be proven idempotent and safe to run repeatedly
- clear re-entrancy guards

## Stage 8: Normalized Headless Output

### Concept

`agentctl run --headless` could eventually return structured JSON output normalized across harnesses instead of passing through raw harness stdout.

### Open Questions

- what does a normalized result look like for coding-agent runs
- is this desirable, or do CI/CD consumers prefer harness-native output
- how should success and failure be normalized across harnesses

This should be driven by real CI/CD integration needs rather than designed speculatively.
