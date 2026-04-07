import * as path from "node:path";
import {
  ConfigSchema,
  ModelsConfigSchema,
  type Config,
  type ModelsConfig,
} from "./schema.js";
import { DEFAULT_CONFIG, DEFAULT_MODELS } from "./defaults.js";
import {
  readJsonFile,
  globalConfigDir,
  findProjectRoot,
} from "../util/index.js";

function mergeConfigs(base: Config, override: Partial<Config>): Config {
  return { ...base, ...override, version: base.version };
}

function mergeModels(
  base: ModelsConfig,
  override: Partial<ModelsConfig>,
): ModelsConfig {
  const merged: ModelsConfig = {
    version: base.version,
    modelClasses: { ...base.modelClasses },
  };
  if (override.modelClasses) {
    for (const [cls, mapping] of Object.entries(override.modelClasses)) {
      merged.modelClasses[cls] = {
        ...merged.modelClasses[cls],
        ...mapping,
      };
    }
  }
  return merged;
}

export interface ResolvedConfig {
  config: Config;
  models: ModelsConfig;
  projectRoot: string;
  globalDir: string;
  projectDir: string;
}

export async function loadConfig(
  cwd?: string,
): Promise<ResolvedConfig> {
  const projectRoot = await findProjectRoot(cwd);
  const globalDir = globalConfigDir();
  const projectDir = path.join(projectRoot, ".agentctl");

  // Layer 1: built-in defaults
  let config = { ...DEFAULT_CONFIG };
  let models = { ...DEFAULT_MODELS, modelClasses: { ...DEFAULT_MODELS.modelClasses } };

  // Layer 2: global config
  const globalConfig = await readJsonFile<unknown>(
    path.join(globalDir, "config.json"),
  );
  if (globalConfig) {
    const parsed = ConfigSchema.partial().safeParse(globalConfig);
    if (parsed.success) config = mergeConfigs(config, parsed.data);
  }

  const globalModels = await readJsonFile<unknown>(
    path.join(globalDir, "models.json"),
  );
  if (globalModels) {
    const parsed = ModelsConfigSchema.partial().safeParse(globalModels);
    if (parsed.success) models = mergeModels(models, parsed.data);
  }

  // Layer 3: project config
  const projectConfig = await readJsonFile<unknown>(
    path.join(projectDir, "config.json"),
  );
  if (projectConfig) {
    const parsed = ConfigSchema.partial().safeParse(projectConfig);
    if (parsed.success) config = mergeConfigs(config, parsed.data);
  }

  const projectModels = await readJsonFile<unknown>(
    path.join(projectDir, "models.json"),
  );
  if (projectModels) {
    const parsed = ModelsConfigSchema.partial().safeParse(projectModels);
    if (parsed.success) models = mergeModels(models, parsed.data);
  }

  return { config, models, projectRoot, globalDir, projectDir };
}
