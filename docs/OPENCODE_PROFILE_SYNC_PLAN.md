# OpenCode Profile Sync Plan

## Goal

Support profile-specific OpenCode targets where global canonical agents are the
base layer, project canonical agents override them, and both resolve into the
same effective destination tree.

This is specific to OpenCode's documented config model:

- OpenCode loads built-in global and project directories
- OpenCode supports one custom directory via `OPENCODE_CONFIG_DIR`
- OpenCode does not document support for a list of custom directories

Because of that, `agentctl` should compute one effective destination per
OpenCode profile instead of trying to hand OpenCode multiple directories.

## User-Facing Outcome

Users can define OpenCode profiles such as:

- `opencode-zai`
- `opencode-oai`
- `opencode-gh-oai`

Each profile resolves to:

- one effective agent destination
- optional run-time environment overrides
- the standard global-then-project layering semantics already used by
  canonical `agentctl` resources

## Config Shape

Add OpenCode profile configuration in `.agentctl/config.json` and
`~/.agentctl/config.json`.

Example:

```json
{
  "version": 1,
  "harnesses": {
    "opencode-zai": {
      "adapter": "opencode",
      "paths": {
        "projectAgentsDir": ".opencode-zai/agents",
        "globalAgentsDir": "~/.config/opencode-zai/agents"
      },
      "run": {
        "env": {
          "OPENCODE_CONFIG": "/path/to/opencode-zai.json",
          "OPENCODE_CONFIG_DIR": "/path/to/opencode-zai"
        }
      }
    }
  }
}
```

## Semantics

### Effective Harness Targets

Keep built-in adapters such as `opencode`, but allow config-defined profile ids
to resolve to that adapter plus profile-specific settings.

This affects:

- `agentctl sync`
- `agentctl run`
- `agentctl doctor`
- harness lookup and manifest keys

### Layering Rules

The sync model for an OpenCode profile is:

1. Load global canonical agents.
2. Overlay project canonical agents by name.
3. Render the final winning agent set once.
4. Sync that final set into the profile destination.

Important: this should not be implemented as two destructive filesystem sync
passes. The layering is logical, not operational.

### Conflict Resolution

- Global agents are the base layer.
- Project agents override global agents with the same name.
- If a project override is removed, the global version should reappear on the
  next sync.
- If both are removed, the generated file should be deleted.

## Implementation Plan

### 1. Add profile schema

Extend config schema to allow named harness profiles with:

- `adapter`
- destination paths
- run-time env overrides

Primary files:

- `src/config/schema.ts`
- `src/config/index.ts`

### 2. Add resolved profile targets

Introduce a resolved "effective harness target" concept so a profile id like
`opencode-zai` can behave like a first-class harness target without duplicating
adapter implementations.

Primary files:

- `src/adapters/base.ts`
- `src/adapters/registry.ts`

### 3. Merge canonical agents before sync

Change sync orchestration so OpenCode profiles receive one final merged map of
agents before any writes occur.

This should preserve existing canonical precedence:

- global first
- project wins by name

Primary files:

- `src/sync/index.ts`
- `src/adapters/opencode.ts`

### 4. Update manifest behavior

Sync state must reflect the final winner for each generated file rather than a
naive source-by-source write history.

Manifest handling must support:

- project shadows global
- project removal reveals global fallback
- deletion only when no source remains

Primary files:

- `src/sync/state.ts`
- `src/sync/index.ts`

### 5. Apply profile env during run

`agentctl run -h opencode-zai` should resolve the profile and apply its env
overrides when constructing the OpenCode command.

Primary files:

- `src/cli/run.ts`
- `src/adapters/opencode.ts`

### 6. Expose profiles in CLI and doctor

`sync` and `doctor` output should distinguish:

- built-in `opencode`
- configured OpenCode profiles
- effective destination paths

Primary files:

- `src/cli/sync.ts`
- `src/cli/doctor.ts`

### 7. Document profile behavior

Update docs to describe OpenCode profiles as:

- one effective destination per profile
- canonical layering performed by `agentctl`
- OpenCode consuming the materialized result

Primary files:

- `README.md`
- `docs/DESIGN.md`

## Acceptance Criteria

- A project agent overrides a global agent with the same name when both target
  the same OpenCode profile destination.
- Removing the project override restores the global generated file on the next
  sync.
- Removing both removes the generated file.
- `agentctl run -h <profile>` applies the configured env overrides.
- Sync state is isolated per effective harness target id.

## Testing Plan

Add tests for:

- merged final-state sync into one destination
- project-over-global precedence
- fallback restoration when a project override is removed
- deletion when both layers disappear
- profile-specific run env injection
- doctor output for configured profile targets

Likely files:

- `tests/doctor.test.ts`
- `tests/helpers.ts`
- `tests/cases/*.json`

## Risks

- Manifest bugs could cause incorrect deletion or prevent global fallback from
  reappearing.
- Treating layering as two physical sync passes would introduce subtle state
  corruption.
- Over-generalizing this design across adapters too early would create coupling
  to OpenCode-specific directory behavior.

## Non-Goals

- Generalizing multi-destination profile sync for all adapters in the first
  pass
- Managing arbitrary OpenCode resources beyond the agent sync path unless they
  are needed for the profile launch flow
- Hiding the fact that OpenCode still has its own built-in config precedence

