/**
 * RecommendationEngine — ranks benchmark results across four categories and
 * produces a complete RecommendationReport.
 *
 * Categories:
 *   - fastest:      highest mean throughput (tie-break: lower VRAM)
 *   - most_context: largest max safe context window (tie-break: lower VRAM)
 *   - fa:           greatest FA-on vs FA-off throughput improvement (tie-break: lower VRAM)
 *   - best_overall: weighted rank score 50% throughput + 30% context + 20% FA (tie-break: lower VRAM)
 */

import type {
  BenchmarkRunResult,
  HardwareInfo,
  MemoryMode,
  Recommendation,
  RecommendationCategory,
  RecommendationReport,
} from "./types.js";
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Annotate a recommendation with a `ramAssistedNotice` when the model runs
 * in RAM-assisted (CPU offload) mode.
 */
function annotateRamAssisted(rec: Recommendation): Recommendation {
  if (rec.memoryMode === "ram_assisted") {
    return {
      ...rec,
      ramAssistedNotice:
        "This model runs with CPU offloading and will exhibit higher latency than a GPU-native model of equivalent size.",
    };
  }
  return rec;
}

/**
 * Get the unique model names present in a result set.
 */
function uniqueModelNames(results: BenchmarkRunResult[]): string[] {
  return [...new Set(results.map((r) => r.modelName))];
}

/**
 * For a given model, return the result with the highest throughput.
 * When multiple results share the same throughput, prefer lower VRAM.
 */
function bestResultForModel(
  results: BenchmarkRunResult[],
  modelName: string
): BenchmarkRunResult | undefined {
  const modelResults = results.filter((r) => r.modelName === modelName);
  if (modelResults.length === 0) return undefined;

  return modelResults.reduce((best, cur) => {
    if (cur.throughputTokensPerSec > best.throughputTokensPerSec) return cur;
    if (
      cur.throughputTokensPerSec === best.throughputTokensPerSec &&
      cur.vramEstimateMb < best.vramEstimateMb
    )
      return cur;
    return best;
  });
}

/**
 * Assign dense ranks to an array of (modelName, value) pairs.
 * Rank 1 = best (highest value). Ties share the same rank.
 */
function rankDescending(entries: Array<{ modelName: string; value: number }>): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const rankMap = new Map<string, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]!.value < sorted[i - 1]!.value) {
      rank = i + 1;
    }
    rankMap.set(sorted[i]!.modelName, rank);
  }
  return rankMap;
}

// ---------------------------------------------------------------------------
// 5.1 selectFastest
// ---------------------------------------------------------------------------

/**
 * Select the model with the highest throughput.
 *
 * - Considers FA-enabled results first; falls back to all results if none exist.
 * - For each model, uses the maximum throughput across all its qualifying results.
 * - Tie-break: lower VRAM wins.
 *
 * @param results Non-empty array of benchmark run results.
 * @returns A Recommendation for the "fastest" category.
 */
export function selectFastest(results: BenchmarkRunResult[]): Recommendation {
  // Prefer FA-enabled results; fall back to all results
  const faResults = results.filter((r) => r.flashAttentionEnabled);
  const pool = faResults.length > 0 ? faResults : results;

  const models = uniqueModelNames(pool);

  // For each model, find the result with the highest throughput (tie-break: lower VRAM)
  let best: BenchmarkRunResult | null = null;

  for (const modelName of models) {
    const candidate = bestResultForModel(pool, modelName);
    if (!candidate) continue;

    if (best === null) {
      best = candidate;
      continue;
    }

    if (candidate.throughputTokensPerSec > best.throughputTokensPerSec) {
      best = candidate;
    } else if (
      candidate.throughputTokensPerSec === best.throughputTokensPerSec &&
      candidate.vramEstimateMb < best.vramEstimateMb
    ) {
      best = candidate;
    }
  }

  // best is guaranteed non-null because results is non-empty
  const winner = best!;

  return annotateRamAssisted({
    category: "fastest",
    modelName: winner.modelName,
    contextWindow: winner.contextWindow,
    throughputTokensPerSec: winner.throughputTokensPerSec,
    latencyMs: winner.latencyMs,
    vramEstimateMb: winner.vramEstimateMb,
    flashAttentionEnabled: winner.flashAttentionEnabled,
    memoryMode: winner.memoryMode,
    parametersBillions: winner.parametersBillions,
  });
}

// ---------------------------------------------------------------------------
// 5.2 selectMostContext
// ---------------------------------------------------------------------------

/**
 * Select the model with the largest context window.
 *
 * - Uses the maximum context window across all results for each model.
 * - Tie-break: lower VRAM wins.
 *
 * @param results Non-empty array of benchmark run results.
 * @returns A Recommendation for the "most_context" category.
 */
export function selectMostContext(results: BenchmarkRunResult[]): Recommendation {
  const models = uniqueModelNames(results);

  let best: BenchmarkRunResult | null = null;

  for (const modelName of models) {
    const modelResults = results.filter((r) => r.modelName === modelName);

    // Find the result with the largest context window; tie-break by lower VRAM
    const candidate = modelResults.reduce((acc, cur) => {
      if (cur.contextWindow > acc.contextWindow) return cur;
      if (cur.contextWindow === acc.contextWindow && cur.vramEstimateMb < acc.vramEstimateMb)
        return cur;
      return acc;
    });

    if (best === null) {
      best = candidate;
      continue;
    }

    if (candidate.contextWindow > best.contextWindow) {
      best = candidate;
    } else if (
      candidate.contextWindow === best.contextWindow &&
      candidate.vramEstimateMb < best.vramEstimateMb
    ) {
      best = candidate;
    }
  }

  const winner = best!;

  return annotateRamAssisted({
    category: "most_context",
    modelName: winner.modelName,
    contextWindow: winner.contextWindow,
    throughputTokensPerSec: winner.throughputTokensPerSec,
    latencyMs: winner.latencyMs,
    vramEstimateMb: winner.vramEstimateMb,
    flashAttentionEnabled: winner.flashAttentionEnabled,
    memoryMode: winner.memoryMode,
    parametersBillions: winner.parametersBillions,
  });
}

// ---------------------------------------------------------------------------
// 5.3 selectBestFa
// ---------------------------------------------------------------------------

/**
 * Select the model with the greatest throughput improvement when FA is enabled
 * compared to disabled.
 *
 * - Only considers models that have BOTH a FA-enabled and FA-disabled result.
 * - Improvement = max(FA throughput) - max(no-FA throughput) for that model.
 * - Falls back to selectFastest if no model has both FA-on and FA-off results.
 * - Tie-break: lower VRAM wins.
 *
 * @param results Non-empty array of benchmark run results.
 * @returns A Recommendation for the "fa" category.
 */
export function selectBestFa(results: BenchmarkRunResult[]): Recommendation {
  const models = uniqueModelNames(results);

  interface FaCandidate {
    modelName: string;
    improvement: number;
    faResult: BenchmarkRunResult;
  }

  const candidates: FaCandidate[] = [];

  for (const modelName of models) {
    const modelResults = results.filter((r) => r.modelName === modelName);
    const faResults = modelResults.filter((r) => r.flashAttentionEnabled);
    const noFaResults = modelResults.filter((r) => !r.flashAttentionEnabled);

    if (faResults.length === 0 || noFaResults.length === 0) continue;

    const maxFaThroughput = Math.max(...faResults.map((r) => r.throughputTokensPerSec));
    const maxNoFaThroughput = Math.max(...noFaResults.map((r) => r.throughputTokensPerSec));
    const improvement = maxFaThroughput - maxNoFaThroughput;

    // Pick the FA result that achieved the max throughput (tie-break: lower VRAM)
    const bestFaResult = faResults
      .filter((r) => r.throughputTokensPerSec === maxFaThroughput)
      .reduce((acc, cur) => (cur.vramEstimateMb < acc.vramEstimateMb ? cur : acc));

    candidates.push({ modelName, improvement, faResult: bestFaResult });
  }

  // Fall back to selectFastest if no model has both FA-on and FA-off results
  if (candidates.length === 0) {
    const fastest = selectFastest(results);
    return { ...fastest, category: "fa" };
  }

  // Select the candidate with the greatest improvement; tie-break by lower VRAM
  const winner = candidates.reduce((best, cur) => {
    if (cur.improvement > best.improvement) return cur;
    if (
      cur.improvement === best.improvement &&
      cur.faResult.vramEstimateMb < best.faResult.vramEstimateMb
    )
      return cur;
    return best;
  });

  return annotateRamAssisted({
    category: "fa",
    modelName: winner.faResult.modelName,
    contextWindow: winner.faResult.contextWindow,
    throughputTokensPerSec: winner.faResult.throughputTokensPerSec,
    latencyMs: winner.faResult.latencyMs,
    vramEstimateMb: winner.faResult.vramEstimateMb,
    flashAttentionEnabled: winner.faResult.flashAttentionEnabled,
    memoryMode: winner.faResult.memoryMode,
    parametersBillions: winner.faResult.parametersBillions,
  });
}

// ---------------------------------------------------------------------------
// 5.5 selectMostParameters
// ---------------------------------------------------------------------------

/**
 * Select the model with the most parameters (largest model by size).
 *
 * - Uses parametersBillions from the benchmark result.
 * - Tie-break: higher throughput wins, then lower VRAM.
 * - Falls back to selectFastest if all results have parametersBillions === 0.
 *
 * @param results Non-empty array of benchmark run results.
 * @returns A Recommendation for the "most_parameters" category.
 */
export function selectMostParameters(results: BenchmarkRunResult[]): Recommendation {
  const models = uniqueModelNames(results);

  // If no parameter info available, fall back to fastest
  const hasParamInfo = results.some((r) => r.parametersBillions > 0);
  if (!hasParamInfo) {
    const fastest = selectFastest(results);
    return { ...fastest, category: "most_parameters" };
  }

  let best: BenchmarkRunResult | null = null;

  for (const modelName of models) {
    const modelResults = results.filter((r) => r.modelName === modelName);
    // Use the max parametersBillions seen for this model (should all be equal)
    const maxParams = Math.max(...modelResults.map((r) => r.parametersBillions));
    // Pick the result with the best throughput for display metrics
    const candidate = modelResults.reduce((acc, cur) => {
      if (cur.throughputTokensPerSec > acc.throughputTokensPerSec) return cur;
      if (cur.throughputTokensPerSec === acc.throughputTokensPerSec &&
          cur.vramEstimateMb < acc.vramEstimateMb) return cur;
      return acc;
    });
    // Attach the max params to the candidate for comparison
    const candidateWithParams = { ...candidate, parametersBillions: maxParams };

    if (best === null) {
      best = candidateWithParams;
      continue;
    }

    if (candidateWithParams.parametersBillions > best.parametersBillions) {
      best = candidateWithParams;
    } else if (candidateWithParams.parametersBillions === best.parametersBillions) {
      if (candidateWithParams.throughputTokensPerSec > best.throughputTokensPerSec) {
        best = candidateWithParams;
      } else if (candidateWithParams.throughputTokensPerSec === best.throughputTokensPerSec &&
                 candidateWithParams.vramEstimateMb < best.vramEstimateMb) {
        best = candidateWithParams;
      }
    }
  }

  const winner = best!;

  return annotateRamAssisted({
    category: "most_parameters",
    modelName: winner.modelName,
    contextWindow: winner.contextWindow,
    throughputTokensPerSec: winner.throughputTokensPerSec,
    latencyMs: winner.latencyMs,
    vramEstimateMb: winner.vramEstimateMb,
    flashAttentionEnabled: winner.flashAttentionEnabled,
    memoryMode: winner.memoryMode,
    parametersBillions: winner.parametersBillions,
  });
}

// ---------------------------------------------------------------------------
// 5.6 computeBestOverall
// ---------------------------------------------------------------------------

/**
 * Compute the Best Overall recommendation using a weighted rank score.
 *
 * For each model:
 *   - throughput metric: max throughput across all results
 *   - context metric:    max context window across all results
 *   - FA improvement:    max(FA throughput) - max(no-FA throughput), or 0 if unavailable
 *
 * Ranks are assigned descending (rank 1 = best).
 * Score = 0.5 × (1/throughputRank) + 0.3 × (1/contextRank) + 0.2 × (1/faRank)
 *
 * Tie-break: lower VRAM wins.
 *
 * @param results Non-empty array of benchmark run results.
 * @returns A Recommendation for the "best_overall" category, including `score`.
 */
export function computeBestOverall(results: BenchmarkRunResult[]): Recommendation {
  const models = uniqueModelNames(results);

  // Compute per-model metrics
  const throughputEntries: Array<{ modelName: string; value: number }> = [];
  const contextEntries: Array<{ modelName: string; value: number }> = [];
  const faEntries: Array<{ modelName: string; value: number }> = [];

  for (const modelName of models) {
    const modelResults = results.filter((r) => r.modelName === modelName);

    const maxThroughput = Math.max(...modelResults.map((r) => r.throughputTokensPerSec));
    const maxContext = Math.max(...modelResults.map((r) => r.contextWindow));

    const faResults = modelResults.filter((r) => r.flashAttentionEnabled);
    const noFaResults = modelResults.filter((r) => !r.flashAttentionEnabled);
    let faImprovement = 0;
    if (faResults.length > 0 && noFaResults.length > 0) {
      const maxFa = Math.max(...faResults.map((r) => r.throughputTokensPerSec));
      const maxNoFa = Math.max(...noFaResults.map((r) => r.throughputTokensPerSec));
      faImprovement = maxFa - maxNoFa;
    }

    throughputEntries.push({ modelName, value: maxThroughput });
    contextEntries.push({ modelName, value: maxContext });
    faEntries.push({ modelName, value: faImprovement });
  }

  const throughputRanks = rankDescending(throughputEntries);
  const contextRanks = rankDescending(contextEntries);
  const faRanks = rankDescending(faEntries);

  // Compute scores and find the winner
  let bestModelName: string | null = null;
  let bestScore = -Infinity;
  let bestVram = Infinity;

  for (const modelName of models) {
    const tRank = throughputRanks.get(modelName) ?? models.length;
    const cRank = contextRanks.get(modelName) ?? models.length;
    const fRank = faRanks.get(modelName) ?? models.length;

    const score = 0.5 * (1 / tRank) + 0.3 * (1 / cRank) + 0.2 * (1 / fRank);

    // Get the VRAM for this model (use the best result's VRAM for tie-breaking)
    const modelResults = results.filter((r) => r.modelName === modelName);
    const minVram = Math.min(...modelResults.map((r) => r.vramEstimateMb));

    if (
      score > bestScore ||
      (score === bestScore && minVram < bestVram)
    ) {
      bestScore = score;
      bestModelName = modelName;
      bestVram = minVram;
    }
  }

  // Get the representative result for the winner (best throughput, tie-break lower VRAM)
  const winnerResult = bestResultForModel(results, bestModelName!)!;

  return annotateRamAssisted({
    category: "best_overall",
    modelName: winnerResult.modelName,
    contextWindow: winnerResult.contextWindow,
    throughputTokensPerSec: winnerResult.throughputTokensPerSec,
    latencyMs: winnerResult.latencyMs,
    vramEstimateMb: winnerResult.vramEstimateMb,
    flashAttentionEnabled: winnerResult.flashAttentionEnabled,
    memoryMode: winnerResult.memoryMode,
    score: bestScore,
    parametersBillions: winnerResult.parametersBillions,
  });
}

// ---------------------------------------------------------------------------
// 5.5 generateRecommendations
// ---------------------------------------------------------------------------

/**
 * Generate a complete RecommendationReport from benchmark run results.
 *
 * @param results    Benchmark run results (must be non-empty).
 * @param hardware   Hardware info from the detection phase.
 * @param memoryMode Memory mode used during the benchmark run.
 * @param exclusions Models excluded before benchmarking, with reasons.
 * @returns A complete RecommendationReport.
 * @throws Error if results is empty.
 */
export function generateRecommendations(
  results: BenchmarkRunResult[],
  hardware: HardwareInfo,
  memoryMode: MemoryMode,
  exclusions: Array<{ modelName: string; reason: string }>
): RecommendationReport {
  if (results.length === 0) {
    throw new Error(
      "Cannot generate recommendations: no benchmark results provided. " +
        "All candidate models may have failed or been excluded."
    );
  }

  const fastest = selectFastest(results);
  const mostContext = selectMostContext(results);
  const fa = selectBestFa(results);
  const bestOverall = computeBestOverall(results);
  const mostParameters = selectMostParameters(results);

  const recommendations: Record<RecommendationCategory, Recommendation> = {
    fastest,
    most_context: mostContext,
    fa,
    best_overall: bestOverall,
    most_parameters: mostParameters,
  };

  return {
    hardware,
    memoryMode,
    recommendations,
    exclusions,
    allResults: results,
    generatedAt: new Date().toISOString(),
  };
}
