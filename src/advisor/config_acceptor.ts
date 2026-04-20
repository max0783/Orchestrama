/**
 * config_acceptor — applies a chosen Recommendation to BridgeConfig.
 *
 * Equivalent to the existing setDefaultModel + context window update in
 * console/index.ts, extended to handle Flash Attention.
 *
 * Requirements: 7.2, 7.4, 7.5
 */

import type { BridgeConfig } from "../types.js";
import type { Recommendation } from "./types.js";
import { writeEnvKeys } from "../console/dotenv_writer.js";

/**
 * Applies a recommendation to the live BridgeConfig, updates process.env,
 * and persists all changed keys to .env so the settings survive a restart.
 *
 * - Sets config.defaultModel and process.env["OLLAMA_DEFAULT_MODEL"]
 * - Sets config.contextWindow and process.env["OLLAMA_NUM_CTX"]
 * - If recommendation.flashAttentionEnabled, sets OLLAMA_FLASH_ATTENTION=1
 *
 * Property 23: Configuration acceptance correctness
 * Validates: Requirements 7.2
 */
export async function applyRecommendation(
  config: BridgeConfig,
  recommendation: Recommendation
): Promise<void> {
  config.defaultModel = recommendation.modelName;
  process.env["OLLAMA_DEFAULT_MODEL"] = recommendation.modelName;

  config.contextWindow = recommendation.contextWindow;
  process.env["OLLAMA_NUM_CTX"] = String(recommendation.contextWindow);
  process.env["OLLAMA_CONTEXT_WINDOW"] = String(recommendation.contextWindow);

  const envKeys: Record<string, string> = {
    OLLAMA_DEFAULT_MODEL: recommendation.modelName,
    OLLAMA_CONTEXT_WINDOW: String(recommendation.contextWindow),
  };

  if (recommendation.flashAttentionEnabled) {
    config.flashAttention = true;
    process.env["OLLAMA_FLASH_ATTENTION"] = "1";
    envKeys["OLLAMA_FLASH_ATTENTION"] = "1";
  }

  await writeEnvKeys(envKeys);
}

/**
 * Returns a human-readable confirmation message for the applied recommendation.
 */
export function formatAcceptanceConfirmation(recommendation: Recommendation): string {
  const contextFormatted = recommendation.contextWindow.toLocaleString("en-US");

  let message =
    `Configuration applied and saved to .env:\n` +
    `  Model:          ${recommendation.modelName}\n` +
    `  Context Window: ${contextFormatted} tokens`;

  if (recommendation.flashAttentionEnabled) {
    message +=
      `\n  Flash Attention: enabled` +
      `\n\nNote: OLLAMA_FLASH_ATTENTION=1 written to .env — restart Ollama to activate it.`;
  }

  return message;
}
