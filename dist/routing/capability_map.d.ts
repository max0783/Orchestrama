import type { CapabilityMap } from "../types.js";
/**
 * Routes prompts to the appropriate Ollama model based on a capability map
 * and a configurable default model.
 *
 * Resolution order:
 *  1. Explicit `model` parameter (if non-empty)
 *  2. First capability-map pattern that is a case-insensitive substring of the prompt
 *  3. Configured `defaultModel` (if non-empty)
 *  4. Hard-coded fallback `"llama3.1:8b"`
 *
 * Note: Pattern iteration order follows JavaScript's own-enumerable-property
 * order for plain objects (`Record<string, string>`).  For non-integer-like
 * keys this matches insertion order.  Integer-like keys (e.g. "0", "1") are
 * sorted numerically by the JS engine before other string keys.
 */
export declare class CapabilityRouter {
    private capabilityMap;
    private defaultModel;
    constructor(capabilityMap: CapabilityMap, defaultModel: string);
    /**
     * Resolve the model to use for a given prompt.
     *
     * @param prompt        The user prompt (used for capability-map matching).
     * @param explicitModel Optional model name supplied directly by the caller.
     * @returns The resolved model name.
     */
    resolveModel(prompt: string, explicitModel?: string): string;
    /**
     * Return a shallow copy of the current capability map.
     */
    getMap(): CapabilityMap;
}
//# sourceMappingURL=capability_map.d.ts.map