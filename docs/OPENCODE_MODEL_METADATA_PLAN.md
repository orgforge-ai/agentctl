# OpenCode Model Metadata Plan

## Goal

Allow `models.json` to define structured OpenCode-specific model metadata, not
just the OpenCode model id string.

This should support fields such as reasoning-related settings that need to be
inserted into generated OpenCode markdown frontmatter.

When there is a conflict, `models.json` should take priority over agent-level
adapter overrides.

## User-Facing Outcome

Users can keep portable model classes such as `small`, `large`, or
`reasoning`, while also attaching OpenCode-specific frontmatter to those
classes.

Existing string-only model mappings must continue to work unchanged.

## Config Shape

Current shape:

```json
{
  "modelClasses": {
    "small": {
      "opencode": "anthropic/claude-haiku-4-5"
    }
  }
}
```

Proposed backward-compatible extension:

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

## Semantics

### Compatibility

Both of these must remain valid:

- `\"opencode\": \"provider/model\"`
- `\"opencode\": { \"model\": \"provider/model\", \"frontmatter\": { ... } }`

### Precedence

Recommended frontmatter precedence order:

1. canonical fields derived from the portable agent definition
2. agent adapter overrides
3. model-class OpenCode frontmatter from `models.json`

This satisfies the requirement that model files take priority.

### Rendering Behavior

For an OpenCode agent with `defaultModelClass`, the renderer should:

1. resolve the model class
2. extract the OpenCode model id
3. extract any OpenCode frontmatter additions
4. merge them into generated frontmatter using the precedence above

## Implementation Plan

### 1. Extend schema

Update the config schema so per-harness model mappings can be either:

- a string
- a structured object for OpenCode

Primary files:

- `src/config/schema.ts`

### 2. Normalize config during load

Config loading should normalize legacy and structured forms into a consistent
internal representation so adapter code stays simple.

Primary files:

- `src/config/index.ts`

### 3. Preserve defaults

Existing built-in defaults should remain string-compatible and should not
require a migration.

Primary files:

- `src/config/defaults.ts`

### 4. Update OpenCode rendering

Teach the OpenCode adapter to consume the normalized model metadata and merge
model-derived frontmatter into the rendered markdown.

Primary files:

- `src/adapters/opencode.ts`

### 5. Reuse existing nested frontmatter rendering

The existing OpenCode renderer already supports nested object frontmatter.
Model-derived metadata should reuse that path rather than inventing a second
rendering mechanism.

Primary files:

- `src/adapters/opencode.ts`

### 6. Add tests for compatibility and precedence

Cover:

- legacy string mapping still sets `model`
- structured mapping sets `model`
- structured mapping sets scalar frontmatter fields
- structured mapping sets nested frontmatter fields
- conflicting keys prefer `models.json` over agent adapter overrides

Primary files:

- `tests/render-frontmatter.test.ts`

### 7. Document the new model format

Show that:

- old configs still work
- structured mappings are available when OpenCode-specific fields are needed

Primary files:

- `README.md`
- `docs/DESIGN.md`

## Acceptance Criteria

- Existing string-based OpenCode model mappings continue to work.
- Structured OpenCode model mappings render both `model` and additional
  frontmatter.
- Nested frontmatter fields are supported.
- Conflicting keys are resolved in favor of `models.json`.

## Testing Plan

Add rendering tests for:

- string-only compatibility
- scalar metadata injection
- nested metadata injection
- precedence over adapter overrides

## Risks

- Schema expansion could accidentally make config validation too loose if the
  object form is not constrained enough.
- If normalization is skipped, adapter code will accumulate format branches and
  become harder to maintain.
- Precedence bugs would silently generate incorrect agent frontmatter.

## Non-Goals

- Redesigning the portable model-class abstraction itself
- Forcing all harnesses to support structured model metadata immediately
- Turning `models.json` into a general-purpose adapter override system
