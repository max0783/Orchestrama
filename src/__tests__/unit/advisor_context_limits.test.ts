import { afterEach, describe, expect, it } from "vitest";
import {
  applySuggestedBridgeContextLimits,
  suggestBridgeContextLimits,
} from "../../advisor/context_limits.js";
import type { BridgeConfig } from "../../types.js";

function makeConfig(): BridgeConfig {
  return {
    ollamaBaseUrl: "http://localhost:11434",
    defaultModel: "llama3",
    contextWindow: 4096,
    keepAlive: "10m",
    keepAliveOnStart: false,
    allowedDirs: [process.cwd()],
    allowedDirsExplicit: false,
    systemPrompt: "",
    capabilityMap: {},
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 300000,
    reductionLogPath: "./orchestrama-reductions.jsonl",
    logLevel: "info",
    disableProgress: false,
  };
}

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

describe("applySuggestedBridgeContextLimits", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("updates config and process env with limits derived from the context window", () => {
    const config = makeConfig();

    const result = applySuggestedBridgeContextLimits(config, 131072);

    expect(result).toEqual({
      maxContextFiles: 64,
      maxFileTokens: 32768,
      maxTotalContextTokens: 98304,
    });
    expect(config.maxContextFiles).toBe(64);
    expect(config.maxFileTokens).toBe(32768);
    expect(config.maxTotalContextTokens).toBe(98304);
    expect(process.env["BRIDGE_MAX_CONTEXT_FILES"]).toBe("64");
    expect(process.env["BRIDGE_MAX_FILE_TOKENS"]).toBe("32768");
    expect(process.env["BRIDGE_MAX_TOTAL_CONTEXT_TOKENS"]).toBe("98304");
  });
});
