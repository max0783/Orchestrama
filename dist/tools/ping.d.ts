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
export declare function createPingHandler(ollamaClient: IOllamaClient, defaultModel: string): (args: unknown) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=ping.d.ts.map