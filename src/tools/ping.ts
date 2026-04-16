/**
 * ping_model tool handler.
 *
 * Sends a minimal keep-alive request to Ollama and returns the model's load
 * status (warm/cold) and round-trip response time in milliseconds.
 * Logs warm/cold start status to stderr.
 *
 * Requirements: 13.4, 13.6
 */

import type { IOllamaClient } from "../ollama/client.js";

/**
 * Factory function that accepts dependencies and returns a handler function.
 */
export function createPingHandler(ollamaClient: IOllamaClient, defaultModel: string) {
  return async (args: unknown) => {
    const model =
      (args as Record<string, unknown>)?.model as string | undefined ?? defaultModel;

    const start = Date.now();
    const result = await ollamaClient.ping(model);
    const status = result.loaded ? "warm" : "cold";

    // Log warm/cold start status to stderr (Req 13.6)
    process.stderr.write(
      `[ollama-mcp-bridge] ping_model: ${model} - ${status} start (${result.responseTimeMs}ms)\n`
    );

    const text = `Model: ${model}\nStatus: ${status} start\nResponse time: ${result.responseTimeMs}ms`;
    return { content: [{ type: "text" as const, text }] };
  };
}
