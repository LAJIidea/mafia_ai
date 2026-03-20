// Shared AI configuration store (singleton)

interface AIConfigData {
  apiToken: string;
  models: string[];
}

let globalAIConfig: AIConfigData | null = null;

export function setGlobalAIConfig(config: AIConfigData): void {
  globalAIConfig = config;
}

export function getGlobalAIConfig(): AIConfigData | null {
  return globalAIConfig;
}

export function resetGlobalAIConfig(): void {
  globalAIConfig = null;
}
