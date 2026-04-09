# agentctl

Portable control plane for coding-agent harnesses.

`agentctl` is an early prototype. The command set, config format, generated
artifacts, and harness integrations are still being shaped. Expect rough edges,
missing features, and breaking changes while the project is proving out the
core workflow.

Today the project is focused on a small, practical loop:

- define agents once in `.agentctl/`
- sync them into supported harnesses
- launch those harnesses through one normalized CLI

Current harness support:

- Claude Code
- OpenCode

## What It Does

`agentctl` keeps a portable project-level source of truth in `.agentctl/` and
generates harness-native agent files from it.

The main commands are:

- `agentctl init` to create starter config
- `agentctl sync` to render agents into harness directories
- `agentctl list` to inspect canonical resources
- `agentctl harness list` to inspect installed harness artifacts
- `agentctl run` to launch a harness interactively or headlessly
- `agentctl doctor` to check config, harness detection, and sync drift

## Quick Start

Initialize a repo:

```bash
agentctl init
```

This creates:

```text
.agentctl/
  config.json
  models.json
  agents/
  skills/
```

Add a minimal agent:

```text
.agentctl/agents/reviewer/
  agent.json
  prompt.md
```

`agent.json`:

```json
{
  "version": 1,
  "name": "reviewer",
  "description": "Reviews code changes for bugs and regressions",
  "defaultModelClass": "large"
}
```

`prompt.md`:

```md
Review the current changes for correctness, regressions, and test gaps.
Prefer concrete findings over summaries.
```

Sync that portable definition into every detected harness:

```bash
agentctl sync
```

Or target one harness:

```bash
agentctl sync claude
agentctl sync opencode
```

Inspect what `agentctl` sees:

```bash
agentctl list agents
agentctl harness list claude agents
agentctl doctor
```

Run a harness interactively:

```bash
agentctl run --harness claude --agent reviewer
```

Run headlessly:

```bash
agentctl run --harness opencode --agent reviewer --headless --prompt "Review the staged changes"
```

Use a prompt file instead of inline text:

```bash
agentctl run --harness claude --headless --agent reviewer --prompt-file ./task.txt
```

Preview the exact launch command without executing it:

```bash
agentctl run --harness claude --agent reviewer --headless --prompt "hello" --dry-run
```

## Usage Notes

- `agentctl run --headless` requires `--prompt` or `--prompt-file`.
- `--model` accepts portable model classes such as `small`, `medium`, and `large`,
  which are mapped per harness via `.agentctl/models.json`.
- `agentctl init --from <harness>` imports existing agents from a supported
  harness into `.agentctl/`.
- `skills/` is created during init, but skill distribution is handled separately
  through skillshare integration.
- `agentctl doctor` is the fastest way to check whether a repo is initialized,
  whether supported harnesses are installed, and whether generated files have drifted.

## Status

This repository should currently be read as a working prototype rather than a
finished product:

- the core agent sync and run flow exists
- only a small set of harnesses is supported
- some design documents describe intended direction in addition to what is already implemented
- backward compatibility is not guaranteed yet

## Install

Linux-only for now. `agentctl` is distributed through GitHub Releases and installs into `~/.local/bin`.

Requirements:

- Linux
- Node 20+
- `curl`
- `tar`

Install the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/orgforge-ai/agentcli/main/install.sh | sh
```

Install a specific release:

```bash
AGENTCTL_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/orgforge-ai/agentcli/main/install.sh | sh
```

The installer places versioned files under `~/.local/share/agentctl/` and links `~/.local/bin/agentctl`.

## Local Development

Build from source:

```bash
npm install
npm run build
```

Run the CLI from the compiled output:

```bash
node dist/cli/index.js --help
```

Or during development:

```bash
npm run build
npm run start -- --help
```

## Manual Install

```bash
curl -fsSLO https://github.com/orgforge-ai/agentcli/releases/download/v0.1.0/agentctl-linux.tar.gz
tar -xzf agentctl-linux.tar.gz
mkdir -p ~/.local/share/agentctl/0.1.0 ~/.local/bin
cp -R agentctl-linux/. ~/.local/share/agentctl/0.1.0/
ln -sfn ~/.local/share/agentctl/0.1.0/bin/agentctl ~/.local/bin/agentctl
agentctl --version
```

## Maintainers

Build the release artifact locally:

```bash
npm run release:build
```

Run the release smoke test:

```bash
npm run release:smoke
```

Artifacts are written to `artifacts/`:

- `agentctl-linux.tar.gz`
- `sha256sums.txt`

## Uninstall

```bash
rm -f ~/.local/bin/agentctl
rm -rf ~/.local/share/agentctl
```
