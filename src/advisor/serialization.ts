/**
 * JSON serialisation and deserialisation for RecommendationReport.
 *
 * Produces canonical JSON (version: "1") and reconstructs reports from JSON,
 * silently ignoring unknown fields for forward-compatibility.
 */

import type {
  RecommendationReport,
  RecommendationCategory,
  Recommendation,
  BenchmarkRunResult,
  HardwareInfo,
  MemoryMode,
  SerializedRecommendationReport,
  SerializedRecommendation,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeRecommendation(rec: Recommendation): SerializedRecommendation {
  const out: SerializedRecommendation = {
    category: rec.category,
    modelName: rec.modelName,
    contextWindow: rec.contextWindow,
    throughputTokensPerSec: rec.throughputTokensPerSec,
    latencyMs: rec.latencyMs,
    vramEstimateMb: rec.vramEstimateMb,
    flashAttentionEnabled: rec.flashAttentionEnabled,
    memoryMode: rec.memoryMode,
    parametersBillions: rec.parametersBillions,
  };
  if (rec.score !== undefined) out.score = rec.score;
  if (rec.ramAssistedNotice !== undefined) out.ramAssistedNotice = rec.ramAssistedNotice;
  return out;
}

function parseRecommendation(raw: Record<string, unknown>): Recommendation {
  return {
    category: String(raw["category"] ?? "") as RecommendationCategory,
    modelName: String(raw["modelName"] ?? ""),
    contextWindow: Number(raw["contextWindow"] ?? 0),
    throughputTokensPerSec: Number(raw["throughputTokensPerSec"] ?? 0),
    latencyMs: Number(raw["latencyMs"] ?? 0),
    vramEstimateMb: Number(raw["vramEstimateMb"] ?? 0),
    flashAttentionEnabled: Boolean(raw["flashAttentionEnabled"] ?? false),
    memoryMode: (raw["memoryMode"] as "gpu_native" | "ram_assisted") ?? "gpu_native",
    parametersBillions: Number(raw["parametersBillions"] ?? 0),
    ...(raw["score"] !== undefined ? { score: Number(raw["score"]) } : {}),
    ...(raw["ramAssistedNotice"] !== undefined
      ? { ramAssistedNotice: String(raw["ramAssistedNotice"]) }
      : {}),
  };
}

function parseBenchmarkRunResult(raw: Record<string, unknown>): BenchmarkRunResult {
  return {
    modelName: String(raw["modelName"] ?? ""),
    contextWindow: Number(raw["contextWindow"] ?? 0),
    throughputTokensPerSec: Number(raw["throughputTokensPerSec"] ?? 0),
    latencyMs: Number(raw["latencyMs"] ?? 0),
    vramEstimateMb: Number(raw["vramEstimateMb"] ?? 0),
    flashAttentionEnabled: Boolean(raw["flashAttentionEnabled"] ?? false),
    memoryMode: (raw["memoryMode"] as "gpu_native" | "ram_assisted") ?? "gpu_native",
    parametersBillions: Number(raw["parametersBillions"] ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialise a `RecommendationReport` to a canonical, pretty-printed JSON string.
 *
 * The output always includes `version: "1"` and contains only the known fields
 * defined in `SerializedRecommendationReport`, making the output deterministic.
 */
export function serializeReport(report: RecommendationReport): string {
  const serialized: SerializedRecommendationReport = {
    version: "1",
    generatedAt: report.generatedAt,
    hardware: {
      gpuName: report.hardware.gpuName,
      totalVramMb: report.hardware.totalVramMb,
      safetyMarginPct: report.hardware.safetyMarginPct,
      vramBudgetMb: report.hardware.vramBudgetMb,
      systemRamMb: report.hardware.systemRamMb,
      cpuOnly: report.hardware.cpuOnly,
    },
    memoryMode: report.memoryMode,
    recommendations: {
      fastest: serializeRecommendation(report.recommendations.fastest),
      most_context: serializeRecommendation(report.recommendations.most_context),
      fa: serializeRecommendation(report.recommendations.fa),
      best_overall: serializeRecommendation(report.recommendations.best_overall),
      most_parameters: serializeRecommendation(report.recommendations.most_parameters),
    },
    exclusions: report.exclusions.map((e) => ({
      modelName: e.modelName,
      reason: e.reason,
    })),
    allResults: report.allResults.map((r) => ({
      modelName: r.modelName,
      contextWindow: r.contextWindow,
      throughputTokensPerSec: r.throughputTokensPerSec,
      latencyMs: r.latencyMs,
      vramEstimateMb: r.vramEstimateMb,
      flashAttentionEnabled: r.flashAttentionEnabled,
      memoryMode: r.memoryMode,
      parametersBillions: r.parametersBillions,
    })),
  };

  return JSON.stringify(serialized, null, 2);
}

/**
 * Parse a JSON string produced by `serializeReport` (or a compatible format)
 * back into a `RecommendationReport`.
 *
 * Unknown fields at any level are silently ignored (forward-compatibility).
 * Missing optional fields are handled gracefully with sensible defaults.
 */
export function parseReport(json: string): RecommendationReport {
  const raw = JSON.parse(json) as Record<string, unknown>;

  // Hardware
  const rawHw = (raw["hardware"] ?? {}) as Record<string, unknown>;
  const hardware: HardwareInfo = {
    gpuName: String(rawHw["gpuName"] ?? ""),
    totalVramMb: Number(rawHw["totalVramMb"] ?? 0),
    safetyMarginPct: Number(rawHw["safetyMarginPct"] ?? 10),
    vramBudgetMb: Number(rawHw["vramBudgetMb"] ?? 0),
    systemRamMb: Number(rawHw["systemRamMb"] ?? 0),
    cpuOnly: Boolean(rawHw["cpuOnly"] ?? false),
  };

  // Memory mode
  const memoryMode = (raw["memoryMode"] as MemoryMode) ?? "vram_only";

  // Recommendations
  const rawRecs = (raw["recommendations"] ?? {}) as Record<string, unknown>;
  const categories: RecommendationCategory[] = ["fastest", "most_context", "fa", "best_overall", "most_parameters"];
  const recommendations = {} as Record<RecommendationCategory, Recommendation>;
  for (const cat of categories) {
    const rawRec = (rawRecs[cat] ?? {}) as Record<string, unknown>;
    recommendations[cat] = parseRecommendation(rawRec);
  }

  // Exclusions
  const rawExclusions = Array.isArray(raw["exclusions"]) ? raw["exclusions"] : [];
  const exclusions = (rawExclusions as Record<string, unknown>[]).map((e) => ({
    modelName: String(e["modelName"] ?? ""),
    reason: String(e["reason"] ?? ""),
  }));

  // All results
  const rawAllResults = Array.isArray(raw["allResults"]) ? raw["allResults"] : [];
  const allResults = (rawAllResults as Record<string, unknown>[]).map(parseBenchmarkRunResult);

  // generatedAt
  const generatedAt = String(raw["generatedAt"] ?? new Date().toISOString());

  return {
    hardware,
    memoryMode,
    recommendations,
    exclusions,
    allResults,
    generatedAt,
  };
}
