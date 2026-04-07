import { z } from "zod";

export const ModelMappingSchema = z.record(z.string());

export const ModelClassesSchema = z.record(ModelMappingSchema);

export const ModelsConfigSchema = z.object({
  version: z.number().default(1),
  modelClasses: ModelClassesSchema,
});

export const ConfigSchema = z.object({
  version: z.number().default(1),
  defaultHarness: z.string().optional(),
  degradedOk: z.boolean().optional(),
});

export type ModelMapping = z.infer<typeof ModelMappingSchema>;
export type ModelClasses = z.infer<typeof ModelClassesSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
