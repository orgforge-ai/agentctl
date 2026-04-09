# Skillshare Integration

## Context

Skills are directory-based resources (SKILL.md + optional scripts/references/assets) that get placed into harness-specific directories like `.claude/skills/` or `.opencode/skills/`. Unlike agents, skills require **no per-harness transformation** — the same files go into every target verbatim.

Rather than building and maintaining skill sync infrastructure inside agentctl, agentctl delegates skill distribution to [skillshare](https://github.com/runkids/skillshare), a mature Go CLI purpose-built for this exact task. skillshare supports 50+ targets, symlink/copy/merge modes, security auditing, install-from-git, and project-level configuration.

agentctl focuses on what it uniquely provides: portable agent definitions with per-harness rendering, model class resolution, and run orchestration.

## Ownership Split

```
agentctl owns:    agents  (schema → per-harness rendering → sync → run)
skillshare owns:  skills  (source directory → symlink/copy to any target)
```

Both tools operate on the same project. agentctl writes to `agents/` in harness directories. skillshare writes to `skills/` in harness directories. No overlap.

## Project Layout

```
my-project/
  .agentctl/
    config.json
    models.json
    agents/
      reviewer/
        agent.json
        prompt.md
    skills/                    ← skillshare reads from here
      smoke-check/
        SKILL.md
        scripts/
          verify.sh
  .skillshare/                 ← skillshare project config
    config.yaml
  .claude/                     ← generated harness artifacts
    agents/                    ← agentctl sync writes here
      reviewer.md
    skills/                    ← skillshare sync writes here
      smoke-check/             ← symlink or copy from .agentctl/skills/
  .opencode/
    agents/
      reviewer.md
    skills/
      smoke-check/
```

Both `.agentctl/` and `.skillshare/` are committed to the repo. The `.claude/` and `.opencode/` harness directories are generated artifacts (gitignored).

## Skillshare Config

`.skillshare/config.yaml` points at `.agentctl/skills/` as its source:

```yaml
source: .agentctl/skills
targets:
  - claude
  - opencode
```

skillshare auto-detects target paths based on known target names. The `claude` target resolves to `.claude/skills/`, `opencode` resolves to `.opencode/skills/`. No custom path configuration needed.

skillshare defaults to symlink mode. If symlinks cause issues with a specific tool, the user can override per-target:

```yaml
targets:
  - name: claude
    skills:
      mode: copy
  - opencode
```

## Daily Workflow

```bash
# Add a skill
mkdir -p .agentctl/skills/my-skill
# ... write SKILL.md, scripts/, etc.

# Distribute skills
skillshare sync

# Add/edit an agent
# ... edit .agentctl/agents/reviewer/prompt.md

# Render agents
agentctl sync

# Run with both agents and skills active
agentctl run -h claude --agent reviewer
```

## Setup

### Manual setup

```bash
# 1. Install skillshare (if not already installed)
# macOS/Linux:
curl -fsSL https://raw.githubusercontent.com/runkids/skillshare/main/install.sh | sh
# Or: brew install skillshare

# 2. Initialize agentctl
agentctl init

# 3. Initialize skillshare in project mode, pointed at agentctl's skills dir
skillshare init -p --source .agentctl/skills --targets "claude,opencode"

# 4. Sync both
agentctl sync
skillshare sync
```

### Integrated setup (future)

`agentctl init --with-skillshare` does all of the above in one step:

1. Normal `agentctl init` (creates `.agentctl/` with agents/, skills/, config.json, models.json)
2. Detect or download skillshare binary
3. Write `.skillshare/config.yaml` with `source: .agentctl/skills` and auto-detected targets
4. Print next steps

## Skillshare Binary Management

When using `--with-skillshare`, agentctl handles skillshare installation:

1. **Check PATH first.** If `skillshare` is already installed (brew, manual, etc.), use that.
2. **Download to `~/.agentctl/bin/skillshare`** if not found on PATH. Pin a specific version.
3. **Prefer system copy forever.** The local copy is a fallback, not a replacement.

```typescript
const SKILLSHARE_VERSION = "v0.18.9";
const LOCAL_BIN = path.join(os.homedir(), ".agentctl", "bin", "skillshare");

async function ensureSkillshare(): Promise<string> {
  // 1. System PATH
  const system = await which("skillshare");
  if (system) return system;

  // 2. Local fallback
  if (await fileExists(LOCAL_BIN)) return LOCAL_BIN;

  // 3. Download
  return downloadSkillshare(SKILLSHARE_VERSION, LOCAL_BIN);
}
```

Download URLs follow skillshare's release pattern:
```
https://github.com/runkids/skillshare/releases/download/{version}/skillshare-{platform}-{arch}
```

agentctl does not silently download. The download only happens when the user explicitly runs `agentctl init --with-skillshare` or agrees to a prompt from `agentctl doctor --fix`.

## Doctor Integration

`agentctl doctor` gains a skillshare awareness check:

```
[  ok] Skills source          .agentctl/skills/ (2 skills found)
[  ok] Skillshare             installed (v0.18.9)
[  ok] .skillshare/config     source → .agentctl/skills
[warn] Skillshare sync        skills not synced — run `skillshare sync`
```

Behavior:

- If `.agentctl/skills/` exists and contains skills → check status is `ok`
- If `.skillshare/config.yaml` exists and points at `.agentctl/skills/` → `ok`
- If skillshare binary is not installed → `warn` with install instructions
- If skills exist but skillshare sync hasn't been run (harness skill dirs empty) → `warn`

Doctor does not error on skillshare issues. Skills are optional. agentctl works fine without them.

## What Changed in agentctl

The following was removed from agentctl:

- `src/resources/skills/` — skill schema, loader, and types
- `renderSkill()` from all adapters — skills don't need per-harness rendering
- Skill sync from `src/sync/index.ts` — skill distribution is skillshare's job
- Skill-related CLI commands (`list skills`, skill counts in doctor)
- `adapterOverrides` concept for skills — no adapter-specific behavior needed
- `HarnessPaths.globalSkillsDir` — skill paths are skillshare's concern
- `skill.json` manifest format — skillshare uses SKILL.md frontmatter

## What Stays in agentctl

- `.agentctl/skills/` directory — agentctl creates it during init, skillshare reads from it
- Awareness of skills in `agentctl list` — reads `.agentctl/skills/` to show what's available
- `agentctl doctor` checks that skillshare is configured and synced
- SKILL.md with standard frontmatter — the format skillshare expects natively

## Skill Format

Skills in `.agentctl/skills/` use SKILL.md with YAML frontmatter, matching skillshare's native format:

```markdown
---
name: my-skill
description: Brief description of what this skill does.
metadata:
  version: "1.0.0"
---

# My Skill

Instructions for the AI agent go here.

## Steps

1. Do the thing
2. Check the result
```

Optional directories alongside SKILL.md:

```
.agentctl/skills/my-skill/
  SKILL.md
  scripts/
    setup.sh
  references/
    api-docs.md
  assets/
    config-template.json
```

skillshare copies or symlinks the entire directory tree into each target's `skills/` directory. No agentctl involvement in that process.

## Global Skills

Global skills live in `~/.agentctl/skills/`. skillshare can be configured globally to read from this directory:

```yaml
# ~/.config/skillshare/config.yaml
source: ~/.agentctl/skills
targets:
  claude:
    skills:
      mode: symlink
  opencode:
    skills:
      mode: symlink
```

This is optional and configured by the user outside of agentctl. agentctl does not modify global skillshare config by default — only project-level `.skillshare/config.yaml`.

## Open Questions

- **Should `agentctl sync` also run `skillshare sync`?** Convenience vs. separation. Leaning toward no — keep the tools independent. The user can alias or script this.
- **Should `agentctl list skills` exist?** Useful for discovery. Reads `.agentctl/skills/` and lists directories containing SKILL.md. Low cost to implement.
- **Should agentctl install skills from remote repos?** No. Delegate to `skillshare install github.com/user/repo`. agentctl does not wrap skillshare's install command.
- **Version pinning.** Should agentctl pin a specific skillshare version or always use whatever is installed? Leaning toward "use whatever is installed, warn if version looks too old."
- **What if the user doesn't want skillshare?** Skills still work as plain directories. The user can manually copy `.agentctl/skills/` into harness directories, or use any other tool. skillshare is the recommended path, not a hard requirement.

## Why This Approach

1. **No duplicated effort.** skillshare's skill sync is mature (130 releases, 1.4k stars, 50+ targets). Reimplementing it in agentctl would be a permanent maintenance burden for an inferior result.

2. **Clean ownership boundary.** agentctl transforms and writes agents. skillshare places skill directories. Neither tool edits files the other owns.

3. **Single source of truth.** Skills live in `.agentctl/skills/`. Both tools read from the same place. No sync between agentctl and skillshare — they share a directory.

4. **No runtime coupling.** agentctl never shells out to skillshare during normal operation. The integration is through a shared directory and a config file. skillshare can be installed, uninstalled, or replaced without agentctl caring.

5. **Interchangeable.** If skillshare disappears or a better tool arrives, the skills are just directories with SKILL.md files. Any tool that can copy or symlink them works.
