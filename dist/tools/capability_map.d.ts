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
export declare function createCapabilityMapHandler(capabilityRouter: CapabilityRouter): (args: unknown) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=capability_map.d.ts.map