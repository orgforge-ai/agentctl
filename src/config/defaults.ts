import type { Config, ModelsConfig } from "./schema.js";

export const DEFAULT_CONFIG: Config = {
  version: 1,
};

export const DEFAULT_MODELS: ModelsConfig = {
  version: 1,
  modelClasses: {
    small: {
      claude: "haiku",
    },
    medium: {
      claude: "sonnet",
    },
    large: {
      claude: "opus",
    },
    planning: {
      claude: "opus",
    },
    editing: {
      claude: "sonnet",
    },
    reasoning: {
      claude: "opus",
    },
  },
};
