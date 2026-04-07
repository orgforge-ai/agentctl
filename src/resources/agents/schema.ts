import { z } from "zod";

export const AgentManifestSchema = z.object({
  version: z.number().default(1),
  name: z.string(),
  description: z.string().optional(),
  defaultModelClass: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  executionHints: z.record(z.unknown()).optional(),
  adapterOverrides: z.record(z.record(z.unknown())).optional(),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export interface Agent {
  manifest: AgentManifest;
  description: string | null;
  prompt: string | null;
  origin: "project" | "global" | "builtin";
  sourcePath: string;
}
