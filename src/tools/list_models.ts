/**
 * list_local_models tool handler.
 *
 * Calls OllamaClient.listModels() and returns the list as text.
 *
 * Requirements: 5.4
 */

import type { IOllamaClient } from "../ollama/client.js";

/**
 * Factory function that accepts dependencies and returns a handler function.
 */
export function createListModelsHandler(ollamaClient: IOllamaClient) {
  return async (_args: unknown) => {
    const models = await ollamaClient.listModels();
    const text = models.length > 0 ? models.join("\n") : "No models available";
    return { content: [{ type: "text" as const, text }] };
  };
}
