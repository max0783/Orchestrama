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
export class CapabilityRouter {
  constructor(
    private capabilityMap: CapabilityMap,
    private defaultModel: string
  ) {}

  /**
   * Resolve the model to use for a given prompt.
   *
   * @param prompt        The user prompt (used for capability-map matching).
   * @param explicitModel Optional model name supplied directly by the caller.
   * @returns The resolved model name.
   */
  resolveModel(prompt: string, explicitModel?: string): string {
    // 1. Explicit model wins
    if (explicitModel && explicitModel.trim() !== "") {
      process.stderr.write(
        `[ollama-mcp-bridge] Model: ${explicitModel} (explicit)\n`
      );
      return explicitModel;
    }

    // 2. Capability map first match (case-insensitive substring)
    const lowerPrompt = prompt.toLowerCase();
    for (const [pattern, model] of Object.entries(this.capabilityMap)) {
      if (lowerPrompt.includes(pattern.toLowerCase())) {
        process.stderr.write(
          `[ollama-mcp-bridge] Capability map match: pattern="${pattern}" → model="${model}"\n`
        );
        return model;
      }
    }

    // 3. Default model (or ultimate fallback "llama3.1:8b")
    const resolved =
      this.defaultModel && this.defaultModel.trim() !== ""
        ? this.defaultModel
        : "llama3.1:8b";
    process.stderr.write(`[ollama-mcp-bridge] Model: ${resolved} (default)\n`);
    return resolved;
  }

  /**
   * Return a shallow copy of the current capability map.
   */
  getMap(): CapabilityMap {
    return { ...this.capabilityMap };
  }
}
