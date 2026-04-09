import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { loadConfig } from "../config/index.js";
import { getAdapter, getAdapterIds } from "../adapters/registry.js";
import { AgentctlError } from "../errors.js";
import { fileExists } from "../util/index.js";

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
    throw new AgentctlError(
      `Unknown harness: ${options.harness}. Available: ${getAdapterIds().join(", ")}`,
    );
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
        throw new AgentctlError(`Invalid --env format: ${e} (expected KEY=VALUE)`);
      }
      envVars[e.slice(0, eqIdx)] = e.slice(eqIdx + 1);
    }
  }

  // Check capabilities
  const caps = adapter.capabilities();
  if (options.headless && !caps.headlessRun) {
    if (!options.degradedOk) {
      throw new AgentctlError(
        `${adapter.displayName} does not support headless execution. Use --degraded-ok to attempt a fallback.`,
      );
    }
    console.log(
      `Warning: ${adapter.displayName} does not fully support headless mode. Attempting degraded execution.`,
    );
  }

  if (options.agent && !caps.customAgents) {
    if (!options.degradedOk) {
      throw new AgentctlError(
        `${adapter.displayName} does not support custom agents.`,
      );
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
      const stdinStr = spec.promptFile ? ` < ${spec.promptFile}` : "";
      console.log(`${envStr}${spec.command} ${spec.args.join(" ")}${stdinStr}`);
      return;
    }

    if (spec.promptFile && !(await fileExists(spec.promptFile))) {
      throw new AgentctlError(`Cannot read prompt file: ${spec.promptFile}`);
    }

    const child = spawn(spec.command, spec.args, {
      stdio: spec.promptFile ? ["pipe", "inherit", "inherit"] : "inherit",
      env: { ...process.env, ...spec.env },
      cwd: spec.cwd,
    });

    if (spec.promptFile) {
      const stream = createReadStream(spec.promptFile);
      stream.pipe(child.stdin!);
    }

    child.on("close", (code) => {
      process.exit(code ?? 0);
    });
  } catch (err) {
    if (err instanceof AgentctlError) throw err;
    throw new AgentctlError(
      err instanceof Error ? err.message : String(err),
    );
  }
}
