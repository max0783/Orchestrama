/**
 * Unit tests for src/advisor/config_acceptor.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyRecommendation, formatAcceptanceConfirmation } from "../../advisor/config_acceptor.js";
import type { Recommendation } from "../../advisor/types.js";
import type { BridgeConfig } from "../../types.js";

// Mock writeEnvKeys so tests don't touch the filesystem
vi.mock("../../console/dotenv_writer.js", () => ({
  writeEnvKeys: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): BridgeConfig {
  return {
    ollamaBaseUrl: "http://localhost:11434",
    defaultModel: "old-model",
    contextWindow: 4096,
    keepAlive: "10m",
    keepAliveOnStart: false,
    allowedDirs: ["/home/user"],
    allowedDirsExplicit: false,
    systemPrompt: "",
    capabilityMap: {},
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 300000,
    reductionLogPath: "./ollama-bridge-reductions.jsonl",
    logLevel: "info",
    disableProgress: false,
  };
}

function makeRecommendation(flashAttentionEnabled = false): Recommendation {
  return {
    category: "fastest",
    modelName: "llama3:7b",
    contextWindow: 32768,
    throughputTokensPerSec: 45.5,
    latencyMs: 220,
    vramEstimateMb: 4096,
    flashAttentionEnabled,
    memoryMode: "gpu_native",
    parametersBillions: 7,
  };
}

// ---------------------------------------------------------------------------
// applyRecommendation
// ---------------------------------------------------------------------------

describe("applyRecommendation", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env["OLLAMA_DEFAULT_MODEL"];
    delete process.env["OLLAMA_NUM_CTX"];
    delete process.env["OLLAMA_FLASH_ATTENTION"];
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("sets config.defaultModel to recommendation's model name", async () => {
    const config = makeConfig();
    await applyRecommendation(config, makeRecommendation());
    expect(config.defaultModel).toBe("llama3:7b");
  });

  it("sets config.contextWindow to recommendation's context window", async () => {
    const config = makeConfig();
    await applyRecommendation(config, makeRecommendation());
    expect(config.contextWindow).toBe(32768);
  });

  it("sets process.env OLLAMA_DEFAULT_MODEL", async () => {
    const config = makeConfig();
    await applyRecommendation(config, makeRecommendation());
    expect(process.env["OLLAMA_DEFAULT_MODEL"]).toBe("llama3:7b");
  });

  it("sets process.env OLLAMA_NUM_CTX", async () => {
    const config = makeConfig();
    await applyRecommendation(config, makeRecommendation());
    expect(process.env["OLLAMA_NUM_CTX"]).toBe("32768");
  });

  it("sets OLLAMA_FLASH_ATTENTION=1 when flashAttentionEnabled is true", async () => {
    const config = makeConfig();
    await applyRecommendation(config, makeRecommendation(true));
    expect(process.env["OLLAMA_FLASH_ATTENTION"]).toBe("1");
  });

  it("does NOT set OLLAMA_FLASH_ATTENTION when flashAttentionEnabled is false", async () => {
    const config = makeConfig();
    await applyRecommendation(config, makeRecommendation(false));
    expect(process.env["OLLAMA_FLASH_ATTENTION"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatAcceptanceConfirmation
// ---------------------------------------------------------------------------

describe("formatAcceptanceConfirmation", () => {
  it("contains the model name", () => {
    const result = formatAcceptanceConfirmation(makeRecommendation());
    expect(result).toContain("llama3:7b");
  });

  it("contains the context window (locale formatted)", () => {
    const result = formatAcceptanceConfirmation(makeRecommendation());
    expect(result).toContain("32,768");
  });

  it("contains 'Flash Attention' and persistence notice when FA is enabled", () => {
    const result = formatAcceptanceConfirmation(makeRecommendation(true));
    expect(result).toContain("Flash Attention");
    expect(result).toContain("OLLAMA_FLASH_ATTENTION");
  });

  it("does NOT contain OLLAMA_FLASH_ATTENTION when FA is disabled", () => {
    const result = formatAcceptanceConfirmation(makeRecommendation(false));
    expect(result).not.toContain("OLLAMA_FLASH_ATTENTION");
  });
});
