/**
 * Property-based tests for the set_default_model action.
 *
 * // Feature: dual-console-separation, Property 6: Set default model updates the session default
 *
 * Validates: Requirements 3.3
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { setDefaultModel } from "../../console/index.js";
import type { BridgeConfig } from "../../types.js";

// ---------------------------------------------------------------------------
// Minimal BridgeConfig factory for testing
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    ollamaBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1:8b",
    contextWindow: 4096,
    keepAlive: "10m",
    keepAliveOnStart: false,
    allowedDirs: ["/tmp"],
    allowedDirsExplicit: false,
    systemPrompt: "",
    capabilityMap: {},
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 300000,
    reductionLogPath: "./test-reductions.jsonl",
    logLevel: "info",
    disableProgress: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 6: Set default model updates the session default
// ---------------------------------------------------------------------------

describe("Property 6: Set default model updates the session default", () => {
  // Feature: dual-console-separation, Property 6: Set default model updates the session default
  it("process.env.OLLAMA_DEFAULT_MODEL equals the model name after setDefaultModel", () => {
    const originalEnv = process.env["OLLAMA_DEFAULT_MODEL"];

    try {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (modelName) => {
          const config = makeConfig();
          setDefaultModel(config, modelName);

          // The env var must equal the model name
          expect(process.env["OLLAMA_DEFAULT_MODEL"]).toBe(modelName);
          // The config object must also be updated
          expect(config.defaultModel).toBe(modelName);
        })
      );
    } finally {
      // Restore the original env var after each test run
      if (originalEnv === undefined) {
        delete process.env["OLLAMA_DEFAULT_MODEL"];
      } else {
        process.env["OLLAMA_DEFAULT_MODEL"] = originalEnv;
      }
    }
  });
});
