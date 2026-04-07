import type { HarnessAdapter } from "./base.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenCodeAdapter } from "./opencode.js";

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
