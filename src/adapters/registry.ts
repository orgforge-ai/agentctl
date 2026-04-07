import type { HarnessAdapter } from "./base.js";
import { ClaudeAdapter } from "./claude.js";

const adapters = new Map<string, HarnessAdapter>();

function register(adapter: HarnessAdapter): void {
  adapters.set(adapter.id, adapter);
}

register(new ClaudeAdapter());

export function getAdapter(id: string): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function getAllAdapters(): HarnessAdapter[] {
  return Array.from(adapters.values());
}

export function getAdapterIds(): string[] {
  return Array.from(adapters.keys());
}
