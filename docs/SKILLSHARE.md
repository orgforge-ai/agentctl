# Skillshare Integration

## Overview

Skillshare is a companion tool that manages skill distribution for coding-agent harnesses. agentctl creates the `.agentctl/skills/` directory during `init` and integrates with skillshare for syncing skills to harness directories.

agentctl owns the agents and run orchestration. Skillshare owns the skill distribution pipeline.

## Relationship to agentctl

```
.agentctl/
  agents/        ← agentctl manages (sync, run)
  skills/        ← skillshare reads from here and syncs to harness dirs
  config.json    ← agentctl config
  models.json    ← agentctl model mappings
```

```
.claude/
  agents/        ← agentctl sync writes here
  skills/        ← skillshare sync writes here

.opencode/
  agents/        ← agentctl sync writes here
  skills/        ← skillshare sync writes here
```

## Setup

### Automatic setup

```bash
agentctl init --with-skillshare
```

This:

1. Creates the standard `.agentctl/` structure
2. Detects or installs the `skillshare` binary
3. Creates `.skillshare/config.yaml` pointing at `.agentctl/skills/`
4. Auto-detects harness targets (`.claude/`, `.opencode/`)

### Manual setup

Install skillshare separately, then create `.skillshare/config.yaml`:

```yaml
source: .agentctl/skills
targets:
  - claude
  - opencode
```

## Skill Format

Skills live in `.agentctl/skills/{skill-name}/SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: Does something useful
---

# My Skill

Instructions for the skill go here.
```

The frontmatter supports:

- `name` — skill name (defaults to directory name)
- `description` — short description

## Commands

### `agentctl list skills`

Lists skills from `.agentctl/skills/` by reading SKILL.md frontmatter.

```bash
agentctl list skills
agentctl list skills --global
```

### `agentctl init --with-skillshare`

Sets up skillshare integration during project initialization.

### `agentctl doctor`

Includes skillshare health checks:

- Is skillshare installed?
- Does `.skillshare/config.yaml` exist and point at `.agentctl/skills/`?
- Are skills synced to target harness directories?

## Binary Management

agentctl handles skillshare binary availability:

1. Checks if `skillshare` is on `PATH`
2. If not found, installs via the official install script to `~/.agentctl/bin/skillshare`
3. Prefers a system-level install when available

## Scope Boundary

agentctl does **not** sync skills to harness directories. That is skillshare's responsibility. agentctl only:

- Creates the `.agentctl/skills/` directory
- Lists skills from it
- Checks sync status via `doctor`
- Sets up the skillshare config during `init --with-skillshare`

Running `skillshare sync` (separately) is required to actually distribute skills to harness directories.
