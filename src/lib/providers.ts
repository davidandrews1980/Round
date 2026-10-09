export type ProviderKind = "openai" | "anthropic" | "gemini";

export type AiProvider = {
  id: string;
  name: string;
  vendor: string;
  model: string;
  kind: ProviderKind;
  baseUrl?: string;
  docs: string;
  keyHint: string;
};

export const AI_PROVIDERS: readonly AiProvider[] = [
  {
    id: "xai",
    name: "Grok",
    vendor: "xAI",
    model: "grok-4.5",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    docs: "https://console.x.ai",
    keyHint: "Starts with xai-",
  },
  {
    id: "openai",
    name: "GPT",
    vendor: "OpenAI",
    model: "gpt-4o",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    docs: "https://platform.openai.com/api-keys",
    keyHint: "Starts with sk-",
  },
  {
    id: "anthropic",
    name: "Claude",
    vendor: "Anthropic",
    model: "claude-sonnet-4-5",
    kind: "anthropic",
    docs: "https://console.anthropic.com/settings/keys",
    keyHint: "Starts with sk-ant-",
  },
  {
    id: "google",
    name: "Gemini",
    vendor: "Google",
    model: "gemini-2.0-flash",
    kind: "gemini",
    docs: "https://aistudio.google.com/apikey",
    keyHint: "Google AI Studio key",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    vendor: "DeepSeek",
    model: "deepseek-chat",
    kind: "openai",
    baseUrl: "https://api.deepseek.com",
    docs: "https://platform.deepseek.com/api_keys",
    keyHint: "Starts with sk-",
  },
  {
    id: "groq",
    name: "Llama",
    vendor: "Groq",
    model: "llama-3.3-70b-versatile",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    docs: "https://console.groq.com/keys",
    keyHint: "Starts with gsk_",
  },
] as const;

export function providerById(id: string) {
  return AI_PROVIDERS.find((p) => p.id === id);
}
