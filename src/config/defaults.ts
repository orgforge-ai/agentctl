import type { Config, ModelsConfig } from "./schema.js";

export const DEFAULT_CONFIG: Config = {
  version: 1,
};

export const DEFAULT_MODELS: ModelsConfig = {
  version: 1,
  modelClasses: {
    small: {
      claude: "haiku",
      opencode: "anthropic/claude-haiku-4-5",
    },
    medium: {
      claude: "sonnet",
      opencode: "anthropic/claude-sonnet-4-5",
    },
    large: {
      claude: "opus",
      opencode: "anthropic/claude-opus-4-6",
    },
    planning: {
      claude: "opus",
      opencode: "anthropic/claude-opus-4-6",
    },
    editing: {
      claude: "sonnet",
      opencode: "anthropic/claude-sonnet-4-5",
    },
    reasoning: {
      claude: "opus",
      opencode: "anthropic/claude-opus-4-6",
    },
  },
};
