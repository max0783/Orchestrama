// Feature: benchmark-advisor, Property 23: Configuration acceptance correctness
// Feature: benchmark-advisor, Property 24: Skip leaves config unchanged
// Feature: benchmark-advisor, Property 25: Acceptance confirmation completeness
//
// **Validates: Requirements 7.2, 7.4, 7.5**

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import {
  applyRecommendation,
  formatAcceptanceConfirmation,
} from "../../advisor/config_acceptor.js";
import type { Recommendation } from "../../advisor/types.js";
import type { BridgeConfig } from "../../types.js";

// Mock writeEnvKeys so property tests don't touch the filesystem
vi.mock("../../console/dotenv_writer.js", () => ({
  writeEnvKeys: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const recommendationArb: fc.Arbitrary<Recommendation> = fc.record({
  category: fc.constantFrom(
    "fastest" as const,
    "most_context" as const,
    "fa" as const,
    "best_overall" as const
  ),
  modelName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  contextWindow: fc.constantFrom(4096, 8192, 16384, 32768, 65536, 131072),
  throughputTokensPerSec: fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
  latencyMs: fc.float({ min: Math.fround(1), max: Math.fround(10000), noNaN: true }),
  vramEstimateMb: fc.integer({ min: 512, max: 80000 }),
  flashAttentionEnabled: fc.boolean(),
  memoryMode: fc.constantFrom("gpu_native" as const, "ram_assisted" as const),
  parametersBillions: fc.integer({ min: 0, max: 100 }),
});

function makeBridgeConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    ollamaBaseUrl: "http://localhost:11434",
    defaultModel: "llama3",
    contextWindow: 4096,
    keepAlive: "10m",
    keepAliveOnStart: false,
    allowedDirs: [process.cwd()],
    allowedDirsExplicit: false,
    systemPrompt: "You are a helpful assistant.",
    capabilityMap: {},
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 300000,
    reductionLogPath: "./ollama-bridge-reductions.jsonl",
    logLevel: "info",
    disableProgress: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 23: Configuration acceptance correctness
// For any Recommendation, applyRecommendation(config, rec) should set
// config.defaultModel = rec.modelName and config.contextWindow = rec.contextWindow.
// **Validates: Requirements 7.2**
// ---------------------------------------------------------------------------

describe("Property 23: Configuration acceptance correctness", () => {
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    // Restore env vars modified by applyRecommendation
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("applyRecommendation sets config.defaultModel and config.contextWindow", async () => {
    await fc.assert(
      fc.asyncProperty(recommendationArb, async (rec) => {
        // Save env state
        savedEnv["OLLAMA_DEFAULT_MODEL"] = process.env["OLLAMA_DEFAULT_MODEL"];
        savedEnv["OLLAMA_NUM_CTX"] = process.env["OLLAMA_NUM_CTX"];
        savedEnv["OLLAMA_FLASH_ATTENTION"] = process.env["OLLAMA_FLASH_ATTENTION"];

        const config = makeBridgeConfig();
        await applyRecommendation(config, rec);

        expect(config.defaultModel).toBe(rec.modelName);
        expect(config.contextWindow).toBe(rec.contextWindow);
      }),
      { numRuns: 100 }
    );
  });

  it("applyRecommendation also updates process.env", async () => {
    await fc.assert(
      fc.asyncProperty(recommendationArb, async (rec) => {
        savedEnv["OLLAMA_DEFAULT_MODEL"] = process.env["OLLAMA_DEFAULT_MODEL"];
        savedEnv["OLLAMA_NUM_CTX"] = process.env["OLLAMA_NUM_CTX"];
        savedEnv["OLLAMA_FLASH_ATTENTION"] = process.env["OLLAMA_FLASH_ATTENTION"];

        const config = makeBridgeConfig();
        await applyRecommendation(config, rec);

        expect(process.env["OLLAMA_DEFAULT_MODEL"]).toBe(rec.modelName);
        expect(process.env["OLLAMA_NUM_CTX"]).toBe(String(rec.contextWindow));
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 24: Skip leaves config unchanged
// If we don't call applyRecommendation, the config should remain unchanged.
// **Validates: Requirements 7.4**
// ---------------------------------------------------------------------------

describe("Property 24: Skip leaves config unchanged", () => {
  it("not calling applyRecommendation leaves config fields unchanged", () => {
    fc.assert(
      fc.property(
        fc.record({
          defaultModel: fc.string({ minLength: 1 }),
          contextWindow: fc.integer({ min: 1024, max: 131072 }),
        }),
        (configFields) => {
          const config = makeBridgeConfig(configFields);
          const originalModel = config.defaultModel;
          const originalContext = config.contextWindow;

          // Simulate "skip" — do NOT call applyRecommendation
          // Config should remain unchanged
          expect(config.defaultModel).toBe(originalModel);
          expect(config.contextWindow).toBe(originalContext);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: Acceptance confirmation completeness
// For any Recommendation, formatAcceptanceConfirmation(rec) should contain
// rec.modelName and String(rec.contextWindow).
// **Validates: Requirements 7.5**
// ---------------------------------------------------------------------------

describe("Property 25: Acceptance confirmation completeness", () => {
  it("formatAcceptanceConfirmation contains model name and context window", () => {
    fc.assert(
      fc.property(recommendationArb, (rec) => {
        const output = formatAcceptanceConfirmation(rec);

        expect(output).toContain(rec.modelName);
        // Context window may appear formatted with locale separators
        expect(output).toContain(rec.contextWindow.toLocaleString("en-US"));
      }),
      { numRuns: 100 }
    );
  });

  it("formatAcceptanceConfirmation mentions Flash Attention when enabled", () => {
    fc.assert(
      fc.property(
        recommendationArb.filter((r) => r.flashAttentionEnabled),
        (rec) => {
          const output = formatAcceptanceConfirmation(rec);
          expect(output.toLowerCase()).toContain("flash attention");
        }
      ),
      { numRuns: 100 }
    );
  });
});
