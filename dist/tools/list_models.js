/**
 * list_local_models tool handler.
 *
 * Calls OllamaClient.listModels() and returns the list as text.
 *
 * Requirements: 5.4
 */
/**
 * Factory function that accepts dependencies and returns a handler function.
 */
export function createListModelsHandler(ollamaClient) {
    return async (_args) => {
        const models = await ollamaClient.listModels();
        const text = models.length > 0 ? models.join("\n") : "No models available";
        return { content: [{ type: "text", text }] };
    };
}
//# sourceMappingURL=list_models.js.map