/**
 * ModelCandidateFilter — estimates VRAM requirements and classifies models
 * based on available hardware budget.
 */

import type { MemoryMode, ModelVramEstimate } from "./types.js";

/**
 * Estimates the VRAM required to run a model.
 *
 * Formula: (paramB × quantBits / 8 × 1024) + overheadMb
 *
 * @param parametersBillions - Model size in billions of parameters
 * @param quantizationBits   - Bit-width of the quantization (e.g. 4, 8, 16)
 * @param overheadMb         - Fixed overhead in MB (default 512)
 * @returns Estimated VRAM in MB
 */
export function estimateModelVram(
  parametersBillions: number,
  quantizationBits: number,
  overheadMb: number = 512
): number {
  return parametersBillions * (quantizationBits / 8) * 1024 + overheadMb;
}

/**
 * Parses a parameter size string from `OllamaModelInfo.details.parameter_size`
 * and returns the value in billions.
 *
 * Examples:
 *   "7B"   → 7
 *   "13B"  → 13
 *   "70B"  → 70
 *   "7.5B" → 7.5
 *   "0.5B" → 0.5
 *   "500M" → 0.5
 *   ""     → 0
 *
 * @param parameterSize - Raw string from model details
 * @returns Parameter count in billions, or 0 if unparseable
 */
export function parseParameterSize(parameterSize: string): number {
  if (!parameterSize) return 0;

  const trimmed = parameterSize.trim().toUpperCase();

  // Match a number followed by B (billions) or M (millions)
  const match = trimmed.match(/^([\d.]+)\s*([BM])$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  if (isNaN(value)) return 0;

  const suffix = match[2];
  if (suffix === "B") return value;
  if (suffix === "M") return value / 1000;

  return 0;
}

/**
 * Parses a quantization level string from `OllamaModelInfo.details.quantization_level`
 * and returns the bit-width.
 *
 * Mapping:
 *   Q4_K_M, Q4_0, Q4_1 → 4
 *   Q5_K_M, Q5_0, Q5_1 → 5
 *   Q6_K               → 6
 *   Q8_0               → 8
 *   F16, FP16          → 16
 *   F32, FP32          → 32
 *   unknown/default    → 4 (conservative)
 *
 * @param quantizationLevel - Raw string from model details
 * @returns Bit-width as a number
 */
export function parseQuantizationBits(quantizationLevel: string): number {
  if (!quantizationLevel) return 4;

  const upper = quantizationLevel.trim().toUpperCase();

  if (upper === "F16" || upper === "FP16") return 16;
  if (upper === "F32" || upper === "FP32") return 32;

  // Match Q<digit> prefix
  const match = upper.match(/^Q(\d)/);
  if (match) {
    const bits = parseInt(match[1], 10);
    // Only accept known bit widths: 4, 5, 6, 8
    if (bits === 4 || bits === 5 || bits === 6 || bits === 8) return bits;
  }

  // Default: conservative 4-bit assumption
  return 4;
}

/**
 * Classifies a list of models into memory tiers based on the available VRAM
 * budget and system RAM, according to the selected memory mode.
 *
 * Classification rules:
 *   - estimatedVramMb <= vramBudgetMb                          → gpu_native
 *   - estimatedVramMb <= vramBudgetMb + systemRamMb (ram_assisted mode) → ram_assisted
 *   - otherwise                                                → excluded
 *
 * @param models        - Models with pre-computed VRAM estimates
 * @param vramBudgetMb  - Available GPU VRAM budget in MB
 * @param systemRamMb   - Available system RAM in MB
 * @param mode          - Memory mode: "vram_only" or "ram_assisted"
 * @returns Updated array with memoryClass and exclusionReason set
 */
export function classifyModels(
  models: ModelVramEstimate[],
  vramBudgetMb: number,
  systemRamMb: number,
  mode: MemoryMode
): ModelVramEstimate[] {
  return models.map((model) => {
    const vram = model.estimatedVramMb;

    if (vram <= vramBudgetMb) {
      return { ...model, memoryClass: "gpu_native", exclusionReason: undefined };
    }

    if (mode === "ram_assisted" && vram <= vramBudgetMb + systemRamMb) {
      return { ...model, memoryClass: "ram_assisted", exclusionReason: undefined };
    }

    const reason =
      mode === "ram_assisted"
        ? `Requires ${Math.round(vram)} MB VRAM; exceeds combined budget of ${Math.round(vramBudgetMb + systemRamMb)} MB`
        : `Requires ${Math.round(vram)} MB VRAM; exceeds VRAM budget of ${Math.round(vramBudgetMb)} MB`;

    return { ...model, memoryClass: "excluded", exclusionReason: reason };
  });
}

/**
 * Formats a human-readable candidate list showing VRAM estimate, memory class,
 * and inclusion/exclusion decision for each model.
 *
 * @param models - Classified model VRAM estimates
 * @returns Multi-line string, one line per model
 */
export function formatCandidateList(models: ModelVramEstimate[]): string {
  if (models.length === 0) {
    return "(no models)";
  }

  return models
    .map((model) => {
      const included = model.memoryClass !== "excluded";
      const decision = included ? "✓ included" : "✗ excluded";
      const classLabel = model.memoryClass;
      const vramStr = `${Math.round(model.estimatedVramMb)} MB`;
      const reasonStr = model.exclusionReason ? ` — ${model.exclusionReason}` : "";

      return `${model.modelName}  ${vramStr}  [${classLabel}]  ${decision}${reasonStr}`;
    })
    .join("\n");
}
