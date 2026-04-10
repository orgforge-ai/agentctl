import * as path from "node:path";
import type { HarnessAdapter, HarnessTarget, HarnessPaths } from "./base.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenCodeAdapter } from "./opencode.js";
import type { ResolvedConfig } from "../config/index.js";
import { getHome } from "../util/index.js";
import { AgentctlError } from "../errors.js";

const adapters = new Map<string, HarnessAdapter>();

function register(adapter: HarnessAdapter): void {
  adapters.set(adapter.id, adapter);
}

register(new ClaudeAdapter());
register(new OpenCodeAdapter());

export function getAdapter(id: string): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function getAllAdapters(): HarnessAdapter[] {
  return Array.from(adapters.values());
}

export function getAdapterIds(): string[] {
  return Array.from(adapters.keys());
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(getHome(), p.slice(1));
  }
  return p;
}

function resolveProfilePath(projectRoot: string, p: string): string {
  const expanded = expandHome(p);
  return path.isAbsolute(expanded) ? expanded : path.join(projectRoot, expanded);
}

export function resolveTargets(config: ResolvedConfig): HarnessTarget[] {
  const targets: HarnessTarget[] = [];

  const profiles = config.config.harnesses ?? {};
  for (const [id, profile] of Object.entries(profiles)) {
    const adapter = getAdapter(profile.adapter);
    if (!adapter) {
      throw new AgentctlError(
        `Harness profile "${id}" references unknown adapter "${profile.adapter}"`,
      );
    }
    // For profile targets we compute one effective destination.
    // projectAgentsDir is the single dest; globalAgentsDir is accepted in
    // config but points at the same effective tree so existing sync utilities
    // write into one place.
    const projectDir = resolveProfilePath(
      config.projectRoot,
      profile.paths.projectAgentsDir,
    );
    const globalDir = profile.paths.globalAgentsDir
      ? resolveProfilePath(config.projectRoot, profile.paths.globalAgentsDir)
      : projectDir;
    const paths: HarnessPaths = {
      projectAgentsDir: projectDir,
      globalAgentsDir: globalDir,
    };
    targets.push({
      id,
      adapter,
      paths,
      runEnv: profile.run?.env,
      isProfile: true,
      displayName: `${adapter.displayName} [${id}]`,
    });
  }

  return targets;
}

export function resolveTarget(
  id: string,
  config: ResolvedConfig,
): HarnessTarget | undefined {
  return resolveTargets(config).find((t) => t.id === id);
}
