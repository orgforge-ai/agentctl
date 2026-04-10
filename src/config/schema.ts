import { z } from "zod";

export const ModelMappingSchema = z.record(z.string());

export const ModelClassesSchema = z.record(ModelMappingSchema);

export const ModelsConfigSchema = z.object({
  version: z.number().default(1),
  modelClasses: ModelClassesSchema,
});

export const HarnessProfilePathsSchema = z.object({
  projectAgentsDir: z.string(),
  globalAgentsDir: z.string().optional(),
});

export const HarnessProfileRunSchema = z.object({
  env: z.record(z.string()).optional(),
});

export const HarnessProfileSchema = z.object({
  adapter: z.string(),
  paths: HarnessProfilePathsSchema,
  run: HarnessProfileRunSchema.optional(),
});

export const ConfigSchema = z.object({
  version: z.number().default(1),
  defaultHarness: z.string().optional(),
  degradedOk: z.boolean().optional(),
  harnesses: z.record(HarnessProfileSchema).optional(),
});

export type ModelMapping = z.infer<typeof ModelMappingSchema>;
export type ModelClasses = z.infer<typeof ModelClassesSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type HarnessProfile = z.infer<typeof HarnessProfileSchema>;
export type HarnessProfilePaths = z.infer<typeof HarnessProfilePathsSchema>;
