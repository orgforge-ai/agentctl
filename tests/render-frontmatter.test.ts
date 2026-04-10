import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClaudeAdapter } from "../src/adapters/claude.js";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";
import type { Agent } from "../src/resources/agents/schema.js";
import type { AdapterContext } from "../src/adapters/base.js";

function makeContext(harnessId: string): AdapterContext {
  return {
    projectRoot: "/tmp/test",
    globalDir: "/tmp/global",
    projectDir: "/tmp/test/.agentctl",
    harnessId,
    models: {
      version: 1,
      modelClasses: {
        planning: {
          "claude-test": "opus",
          "opencode-test": "anthropic/claude-opus-4-6",
        },
      },
    },
  };
}

const claudeContext = makeContext("claude-test");
const opencodeContext = makeContext("opencode-test");

function makeAgent(overrides: Record<string, unknown>): Agent {
  return {
    manifest: {
      version: 1,
      name: "ideation",
      description: "Critical Ideation",
      defaultModelClass: "planning",
      adapterOverrides: { claude: overrides, opencode: overrides },
    },
    description: "Critical Ideation",
    prompt: "You are a devil's advocate.",
    origin: "project",
    sourcePath: "/tmp/test/.agentctl/agents/ideation",
  };
}

describe("renderAgent frontmatter", () => {
  describe("ClaudeAdapter", () => {
    const adapter = new ClaudeAdapter();

    it("passes scalar overrides into frontmatter", async () => {
      const agent = makeAgent({ temperature: 0.7, mode: "primary", color: "green" });
      const [file] = await adapter.renderAgent({ agent, context: claudeContext });

      assert.ok(file.content.includes("temperature: 0.7"));
      assert.ok(file.content.includes('mode: "primary"'));
      assert.ok(file.content.includes('color: "green"'));
    });

    it("renders nested objects as indented blocks", async () => {
      const agent = makeAgent({
        tools: { write: true, edit: true, bash: false },
      });
      const [file] = await adapter.renderAgent({ agent, context: claudeContext });

      assert.ok(file.content.includes("tools:"));
      assert.ok(file.content.includes("  write: true"));
      assert.ok(file.content.includes("  edit: true"));
      assert.ok(file.content.includes("  bash: false"));
    });

    it("renders both scalars and nested together", async () => {
      const agent = makeAgent({
        temperature: 0.7,
        tools: { write: true, bash: false },
      });
      const [file] = await adapter.renderAgent({ agent, context: claudeContext });

      assert.ok(file.content.includes("temperature: 0.7"));
      assert.ok(file.content.includes("tools:"));
      assert.ok(file.content.includes("  write: true"));
    });

    it("skips null and undefined values", async () => {
      const agent = makeAgent({ color: null, mode: undefined, temperature: 0.5 });
      const [file] = await adapter.renderAgent({ agent, context: claudeContext });
      const lines = file.content.split("\n");

      assert.ok(file.content.includes("temperature: 0.5"));
      assert.ok(!lines.some((l) => l.startsWith("color:")));
      assert.ok(!lines.some((l) => l.startsWith("mode:")));
    });

    it("preserves canonical fields alongside overrides", async () => {
      const agent = makeAgent({ temperature: 0.7 });
      const [file] = await adapter.renderAgent({ agent, context: claudeContext });

      assert.ok(file.content.includes('name: "ideation"'));
      assert.ok(file.content.includes('description: "Critical Ideation"'));
      assert.ok(file.content.includes("model: opus"));
      assert.ok(file.content.includes("temperature: 0.7"));
    });

    it("override can shadow a canonical field", async () => {
      const agent = makeAgent({ model: "haiku" });
      const [file] = await adapter.renderAgent({ agent, context: claudeContext });

      // The override should win — model appears once with override value
      const lines = file.content.split("\n").filter((l) => l.startsWith("model:"));
      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes("haiku"));
    });

    it("boolean overrides are unquoted", async () => {
      const agent = makeAgent({ allowEdits: true });
      const [file] = await adapter.renderAgent({ agent, context: claudeContext });

      assert.ok(file.content.includes("allowEdits: true"));
      assert.ok(!file.content.includes('"true"'));
    });
  });

  describe("OpenCodeAdapter", () => {
    const adapter = new OpenCodeAdapter();

    it("passes scalar overrides into frontmatter", async () => {
      const agent = makeAgent({ temperature: 0.7, mode: "primary" });
      const [file] = await adapter.renderAgent({ agent, context: opencodeContext });

      assert.ok(file.content.includes("temperature: 0.7"));
      assert.ok(file.content.includes('mode: "primary"'));
    });

    it("renders nested objects as indented blocks", async () => {
      const agent = makeAgent({
        tools: { write: true, bash: false },
      });
      const [file] = await adapter.renderAgent({ agent, context: opencodeContext });

      assert.ok(file.content.includes("tools:"));
      assert.ok(file.content.includes("  write: true"));
      assert.ok(file.content.includes("  bash: false"));
    });

    it("skips null and undefined values", async () => {
      const agent = makeAgent({ color: null, mode: undefined, temperature: 0.5 });
      const [file] = await adapter.renderAgent({ agent, context: opencodeContext });
      const lines = file.content.split("\n");

      assert.ok(file.content.includes("temperature: 0.5"));
      assert.ok(!lines.some((l) => l.startsWith("color:")));
      assert.ok(!lines.some((l) => l.startsWith("mode:")));
    });
  });
});
