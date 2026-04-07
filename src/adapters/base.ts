import type { Agent } from "../resources/agents/schema.js";
import type { ModelsConfig } from "../config/schema.js";

export interface AdapterContext {
  projectRoot: string;
  globalDir: string;
  projectDir: string;
  models: ModelsConfig;
  managedNames?: Set<string>;
}

export interface DetectionResult {
  installed: boolean;
  version?: string;
  binaryPath?: string;
}

export interface HarnessCapabilities {
  interactiveRun: boolean;
  headlessRun: boolean;
  customAgents: boolean;
  directAgentLaunch: boolean;
}

export interface HarnessPaths {
  projectAgentsDir: string;
  globalAgentsDir?: string;
}

export interface InstalledResource {
  name: string;
  path: string;
  managed: boolean;
}

export interface InstalledResources {
  agents: InstalledResource[];
}

export interface UnmanagedResource {
  kind: "agent";
  name: string;
  path: string;
}

export interface RenderedFile {
  relativePath: string;
  content: string;
}

export interface RenderAgentInput {
  agent: Agent;
  context: AdapterContext;
}

export interface ImportedAgent {
  name: string;
  description: string | null;
  prompt: string | null;
  modelClass?: string;
  metadata: Record<string, unknown>;
}

export interface SyncContext extends AdapterContext {
  agents: Map<string, Agent>;
  managedNames: Set<string>;
  dryRun: boolean;
  force: boolean;
}

export interface SyncFileAction {
  path: string;
  action: "write" | "skip" | "delete";
  reason?: string;
}

export interface SyncResult {
  actions: SyncFileAction[];
  warnings: string[];
}

export interface RunCommandInput {
  context: AdapterContext;
  agent?: string;
  model?: string;
  headless: boolean;
  prompt?: string;
  promptFile?: string;
  cwd?: string;
  env?: Record<string, string>;
  degradedOk: boolean;
}

export interface CommandSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HarnessAdapter {
  id: string;
  displayName: string;
  detect(context: AdapterContext): Promise<DetectionResult>;
  capabilities(): HarnessCapabilities;
  resolveInstallPaths(context: AdapterContext): HarnessPaths;
  listInstalled(context: AdapterContext): Promise<InstalledResources>;
  listUnmanaged(context: AdapterContext): Promise<UnmanagedResource[]>;
  renderAgent(input: RenderAgentInput): Promise<RenderedFile[]>;
  importAgents(context: AdapterContext): Promise<ImportedAgent[]>;
  sync(context: SyncContext): Promise<SyncResult>;
  buildRunCommand(input: RunCommandInput): Promise<CommandSpec>;
}
