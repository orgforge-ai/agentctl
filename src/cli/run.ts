import { spawn } from "node:child_process";
import { loadConfig } from "../config/index.js";
import { getAdapter, getAdapterIds } from "../adapters/registry.js";

export interface RunOptions {
  harness: string;
  agent?: string;
  model?: string;
  headless: boolean;
  prompt?: string;
  promptFile?: string;
  cwd?: string;
  env?: string[];
  dryRun: boolean;
  degradedOk: boolean;
}

export async function runRun(options: RunOptions): Promise<void> {
  const adapter = getAdapter(options.harness);
  if (!adapter) {
    console.error(`Unknown harness: ${options.harness}`);
    console.error(`Available: ${getAdapterIds().join(", ")}`);
    process.exit(1);
  }

  const config = await loadConfig(options.cwd);
  const context = {
    projectRoot: config.projectRoot,
    globalDir: config.globalDir,
    projectDir: config.projectDir,
    models: config.models,
  };

  // Parse env flags
  const envVars: Record<string, string> = {};
  if (options.env) {
    for (const e of options.env) {
      const eqIdx = e.indexOf("=");
      if (eqIdx === -1) {
        console.error(`Invalid --env format: ${e} (expected KEY=VALUE)`);
        process.exit(1);
      }
      envVars[e.slice(0, eqIdx)] = e.slice(eqIdx + 1);
    }
  }

  // Check capabilities
  const caps = adapter.capabilities();
  if (options.headless && !caps.headlessRun) {
    if (!options.degradedOk) {
      console.error(
        `${adapter.displayName} does not support headless execution.`,
      );
      console.error("Use --degraded-ok to attempt a fallback.");
      process.exit(1);
    }
    console.log(
      `Warning: ${adapter.displayName} does not fully support headless mode. Attempting degraded execution.`,
    );
  }

  if (options.agent && !caps.customAgents) {
    if (!options.degradedOk) {
      console.error(
        `${adapter.displayName} does not support custom agents.`,
      );
      process.exit(1);
    }
    console.log(
      `Warning: ${adapter.displayName} does not support custom agents. Agent selection will be ignored.`,
    );
  }

  try {
    const spec = await adapter.buildRunCommand({
      context,
      agent: options.agent,
      model: options.model,
      headless: options.headless,
      prompt: options.prompt,
      promptFile: options.promptFile,
      cwd: options.cwd,
      env: Object.keys(envVars).length > 0 ? envVars : undefined,
      degradedOk: options.degradedOk,
    });

    if (options.dryRun) {
      const envStr = spec.env
        ? Object.entries(spec.env)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ") + " "
        : "";
      console.log(`${envStr}${spec.command} ${spec.args.join(" ")}`);
      return;
    }

    const child = spawn(spec.command, spec.args, {
      stdio: "inherit",
      env: { ...process.env, ...spec.env },
      cwd: spec.cwd,
    });

    child.on("close", (code) => {
      process.exit(code ?? 0);
    });
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
