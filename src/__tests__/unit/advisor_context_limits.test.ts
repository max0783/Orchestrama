import { describe, expect, it } from "vitest";
import { suggestBridgeContextLimits } from "../../advisor/context_limits.js";

describe("suggestBridgeContextLimits", () => {
  it("keeps the existing defaults for the baseline 4k context", () => {
    expect(suggestBridgeContextLimits(4096)).toEqual({
      maxContextFiles: 20,
      maxFileTokens: 1024,
      maxTotalContextTokens: 4096,
    });
  });

  it("scales file context limits for large benchmarked context windows", () => {
    expect(suggestBridgeContextLimits(131072)).toEqual({
      maxContextFiles: 64,
      maxFileTokens: 32768,
      maxTotalContextTokens: 98304,
    });
  });
});
