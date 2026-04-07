#!/usr/bin/env node

import { Command } from "commander";
import { runInit } from "./init.js";
import { runSync } from "./sync.js";
import { runList, runHarnessList } from "./list.js";
import { runRun } from "./run.js";
import { runDoctor } from "./doctor.js";

const program = new Command();

program
  .name("agentctl")
  .description("Portable control plane for coding-agent harnesses")
  .version("0.1.0");

program
  .command("init")
  .description("Create .agentctl/ with starter config")
  .option("--from <harness>", "Import agents from an existing harness")
  .action(async (options) => {
    await runInit({ from: options.from });
  });

program
  .command("sync [harness]")
  .description("Generate harness-native artifacts from canonical config")
  .option("--dry-run", "Show what would change without writing", false)
  .option("--force", "Overwrite conflicting unmanaged agents", false)
  .option("--project-only", "Only sync project-level agents", false)
  .action(async (harness, options) => {
    await runSync(harness, {
      dryRun: options.dryRun,
      force: options.force,
      projectOnly: options.projectOnly,
    });
  });

program
  .command("list <resource>")
  .description("List canonical resources")
  .option("--global", "Show only global resources", false)
  .action(async (resource, options) => {
    await runList(resource, { global: options.global });
  });

const harness = program
  .command("harness")
  .description("Harness-specific operations");

harness
  .command("list <harness> <resource>")
  .description("List resources installed in a harness")
  .action(async (harnessId, resource) => {
    await runHarnessList(harnessId, resource);
  });

program
  .command("run")
  .description("Execute via a harness")
  .requiredOption("-h, --harness <name>", "Harness to use")
  .option("--agent <name>", "Agent to run")
  .option("--model <class>", "Model class to use")
  .option("--headless", "Run in headless mode", false)
  .option("--prompt <text>", "Prompt text (headless mode)")
  .option("--prompt-file <path>", "Prompt file (headless mode)")
  .option("--cwd <dir>", "Working directory")
  .option("--env <KEY=VALUE...>", "Environment variables", (val: string, prev: string[]) => {
    prev.push(val);
    return prev;
  }, [])
  .option("--dry-run", "Print command without executing", false)
  .option("--degraded-ok", "Allow degraded execution", false)
  .action(async (options) => {
    await runRun({
      harness: options.harness,
      agent: options.agent,
      model: options.model,
      headless: options.headless,
      prompt: options.prompt,
      promptFile: options.promptFile,
      cwd: options.cwd,
      env: options.env,
      dryRun: options.dryRun,
      degradedOk: options.degradedOk,
    });
  });

program
  .command("doctor")
  .description("Check config validity, harness availability, and sync state")
  .action(async () => {
    await runDoctor();
  });

program.parse();
