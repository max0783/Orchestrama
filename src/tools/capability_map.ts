/**
 * get_capability_map tool handler.
 *
 * Returns the current capability map configuration and optionally resolves
 * the model for a given prompt parameter.
 *
 * Requirements: 14.6
 */

import type { CapabilityRouter } from "../routing/capability_map.js";

/**
 * Factory function that accepts dependencies and returns a handler function.
 */
export function createCapabilityMapHandler(capabilityRouter: CapabilityRouter) {
  return async (args: unknown) => {
    const prompt = (args as Record<string, unknown>)?.prompt as string | undefined;

    const map = capabilityRouter.getMap();
    const mapText =
      Object.entries(map).length > 0
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
    return { content: [{ type: "text" as const, text }] };
  };
}
