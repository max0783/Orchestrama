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
export declare function createListModelsHandler(ollamaClient: IOllamaClient): (_args: unknown) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=list_models.d.ts.map