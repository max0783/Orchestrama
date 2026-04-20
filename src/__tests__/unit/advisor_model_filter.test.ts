/**
 * Unit tests for src/advisor/model_filter.ts
 */

import { describe, it, expect } from "vitest";
import {
  parseParameterSize,
  parseQuantizationBits,
  estimateModelVram,
  classifyModels,
  formatCandidateList,
} from "../../advisor/model_filter.js";
import type { ModelVramEstimate } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// parseParameterSize
// ---------------------------------------------------------------------------

describe("parseParameterSize", () => {
  it('"7B" → 7', () => expect(parseParameterSize("7B")).toBe(7));
  it('"13B" → 13', () => expect(parseParameterSize("13B")).toBe(13));
  it('"70B" → 70', () => expect(parseParameterSize("70B")).toBe(70));
  it('"7.5B" → 7.5', () => expect(parseParameterSize("7.5B")).toBe(7.5));
  it('"0.5B" → 0.5', () => expect(parseParameterSize("0.5B")).toBe(0.5));
  it('"500M" → 0.5', () => expect(parseParameterSize("500M")).toBe(0.5));
  it('"" → 0', () => expect(parseParameterSize("")).toBe(0));
  it('"invalid" → 0', () => expect(parseParameterSize("invalid")).toBe(0));
});

// ---------------------------------------------------------------------------
// parseQuantizationBits
// ---------------------------------------------------------------------------

describe("parseQuantizationBits", () => {
  it('"Q4_K_M" → 4', () => expect(parseQuantizationBits("Q4_K_M")).toBe(4));
  it('"Q4_0" → 4', () => expect(parseQuantizationBits("Q4_0")).toBe(4));
  it('"Q5_K_M" → 5', () => expect(parseQuantizationBits("Q5_K_M")).toBe(5));
  it('"Q6_K" → 6', () => expect(parseQuantizationBits("Q6_K")).toBe(6));
  it('"Q8_0" → 8', () => expect(parseQuantizationBits("Q8_0")).toBe(8));
  it('"F16" → 16', () => expect(parseQuantizationBits("F16")).toBe(16));
  it('"FP16" → 16', () => expect(parseQuantizationBits("FP16")).toBe(16));
  it('"F32" → 32', () => expect(parseQuantizationBits("F32")).toBe(32));
  it('"" → 4 (default)', () => expect(parseQuantizationBits("")).toBe(4));
  it('"unknown" → 4 (default)', () => expect(parseQuantizationBits("unknown")).toBe(4));
});

// ---------------------------------------------------------------------------
// estimateModelVram
// ---------------------------------------------------------------------------

describe("estimateModelVram", () => {
  it("7B Q4 → 7 * 0.5 * 1024 + 512 = 4096", () => {
    expect(estimateModelVram(7, 4)).toBe(4096);
  });

  it("13B Q8 → 13 * 1 * 1024 + 512 = 13824", () => {
    expect(estimateModelVram(13, 8)).toBe(13824);
  });

  it("70B F16 → 70 * 2 * 1024 + 512 = 143872", () => {
    expect(estimateModelVram(70, 16)).toBe(143872);
  });

  it("custom overhead: 7B Q4 with 256 MB overhead → 7 * 0.5 * 1024 + 256 = 3840", () => {
    expect(estimateModelVram(7, 4, 256)).toBe(3840);
  });
});

// ---------------------------------------------------------------------------
// classifyModels
// ---------------------------------------------------------------------------

function makeModel(
  modelName: string,
  estimatedVramMb: number,
  memoryClass: ModelVramEstimate["memoryClass"] = "gpu_native"
): ModelVramEstimate {
  return {
    modelName,
    parametersBillions: 7,
    quantizationBits: 4,
    estimatedVramMb,
    memoryClass,
  };
}

describe("classifyModels", () => {
  it("VRAM-only mode: model within budget → gpu_native", () => {
    const models = [makeModel("llama3:7b", 4096)];
    const result = classifyModels(models, 8192, 32768, "vram_only");
    expect(result[0]!.memoryClass).toBe("gpu_native");
  });

  it("VRAM-only mode: model exceeds budget → excluded", () => {
    const models = [makeModel("llama3:70b", 16384)];
    const result = classifyModels(models, 8192, 32768, "vram_only");
    expect(result[0]!.memoryClass).toBe("excluded");
  });

  it("RAM-assisted mode: model exceeds VRAM but fits in VRAM+RAM → ram_assisted", () => {
    const models = [makeModel("llama3:13b", 16384)];
    const result = classifyModels(models, 8192, 32768, "ram_assisted");
    expect(result[0]!.memoryClass).toBe("ram_assisted");
  });

  it("RAM-assisted mode: model exceeds combined VRAM+RAM budget → excluded", () => {
    const models = [makeModel("llama3:huge", 100000)];
    const result = classifyModels(models, 8192, 32768, "ram_assisted");
    expect(result[0]!.memoryClass).toBe("excluded");
  });

  it("empty model list → empty result", () => {
    const result = classifyModels([], 8192, 32768, "vram_only");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatCandidateList
// ---------------------------------------------------------------------------

describe("formatCandidateList", () => {
  it("empty list → '(no models)'", () => {
    expect(formatCandidateList([])).toBe("(no models)");
  });

  it("single gpu_native model → contains model name, 'gpu_native', '✓ included'", () => {
    const models: ModelVramEstimate[] = [
      {
        modelName: "llama3:7b",
        parametersBillions: 7,
        quantizationBits: 4,
        estimatedVramMb: 4096,
        memoryClass: "gpu_native",
      },
    ];
    const result = formatCandidateList(models);
    expect(result).toContain("llama3:7b");
    expect(result).toContain("gpu_native");
    expect(result).toContain("✓ included");
  });

  it("single excluded model → contains model name, 'excluded', '✗ excluded', exclusion reason", () => {
    const models: ModelVramEstimate[] = [
      {
        modelName: "llama3:70b",
        parametersBillions: 70,
        quantizationBits: 4,
        estimatedVramMb: 36352,
        memoryClass: "excluded",
        exclusionReason: "Requires 36352 MB VRAM; exceeds VRAM budget of 8192 MB",
      },
    ];
    const result = formatCandidateList(models);
    expect(result).toContain("llama3:70b");
    expect(result).toContain("excluded");
    expect(result).toContain("✗ excluded");
    expect(result).toContain("Requires 36352 MB VRAM");
  });
});
