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
import { AgentctlError } from "../errors.js";

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
  const globalConfigPath = path.join(globalDir, "config.json");
  const globalConfig = await readJsonFile<unknown>(globalConfigPath);
  if (globalConfig) {
    const parsed = ConfigSchema.partial().safeParse(globalConfig);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AgentctlError(`Invalid config in ${globalConfigPath}: ${issues}`);
    }
    config = mergeConfigs(config, parsed.data);
  }

  const globalModelsPath = path.join(globalDir, "models.json");
  const globalModels = await readJsonFile<unknown>(globalModelsPath);
  if (globalModels) {
    const parsed = ModelsConfigSchema.partial().safeParse(globalModels);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AgentctlError(`Invalid config in ${globalModelsPath}: ${issues}`);
    }
    models = mergeModels(models, parsed.data);
  }

  // Layer 3: project config
  const projectConfigPath = path.join(projectDir, "config.json");
  const projectConfig = await readJsonFile<unknown>(projectConfigPath);
  if (projectConfig) {
    const parsed = ConfigSchema.partial().safeParse(projectConfig);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AgentctlError(`Invalid config in ${projectConfigPath}: ${issues}`);
    }
    config = mergeConfigs(config, parsed.data);
  }

  const projectModelsPath = path.join(projectDir, "models.json");
  const projectModels = await readJsonFile<unknown>(projectModelsPath);
  if (projectModels) {
    const parsed = ModelsConfigSchema.partial().safeParse(projectModels);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AgentctlError(`Invalid config in ${projectModelsPath}: ${issues}`);
    }
    models = mergeModels(models, parsed.data);
  }

  return { config, models, projectRoot, globalDir, projectDir };
}
