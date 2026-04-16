/**
 * get_capability_map tool handler.
 *
 * Returns the current capability map configuration and optionally resolves
 * the model for a given prompt parameter.
 *
 * Requirements: 14.6
 */
/**
 * Factory function that accepts dependencies and returns a handler function.
 */
export function createCapabilityMapHandler(capabilityRouter) {
    return async (args) => {
        const prompt = args?.prompt;
        const map = capabilityRouter.getMap();
        const mapText = Object.entries(map).length > 0
            ? Object.entries(map)
                .map(([p, m]) => `  "${p}" → ${m}`)
                .join("\n")
            : "  (empty)";
        let resolvedText = "";
        if (prompt) {
            const resolved = capabilityRouter.resolveModel(prompt);
            resolvedText = `\nResolved model for prompt: ${resolved}`;
        }
        const text = `Capability map:\n${mapText}${resolvedText}`;
        return { content: [{ type: "text", text }] };
    };
}
//# sourceMappingURL=capability_map.js.map