# agentctl

Portable control plane for coding-agent harnesses.

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
