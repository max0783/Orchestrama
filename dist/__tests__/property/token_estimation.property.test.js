// Feature: ollama-mcp-bridge, Property 7: Token estimation formula
// For any string s, estimateTokens(s) should equal Math.floor(s.length / 4).
//
// **Validates: Requirements 4.1**
import { describe, it } from "vitest";
import * as fc from "fast-check";
import { estimateTokens } from "../../chunking/index.js";
describe("Property 7: Token estimation formula", () => {
    it("estimateTokens(s) === Math.floor(s.length / 4) for any string", () => {
        fc.assert(fc.property(fc.string(), (s) => {
            return estimateTokens(s) === Math.floor(s.length / 4);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=token_estimation.property.test.js.map