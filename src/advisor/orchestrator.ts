/**
 * BenchmarkAdvisor orchestrator — coordinates all advisor phases in sequence.
 *
 * Phase 1: Hardware detection + display
 * Phase 2: Memory mode selection + model candidate filtering
 * Phase 3: Context window safety check
 * Phase 4: Benchmark execution (FA-on, FA-off, RAM-assisted)
 * Phase 5: Recommendation generation + report display + log append
 * Phase 6: Configuration acceptance
 *
 * Requirements: 1.x, 2.x, 3.x, 4.x, 5.x, 6.x, 7.x
 */

import fs from "fs/promises";
import readline from "readline";
import type { IOllamaClient } from "../ollama/client.js";
import type { BridgeConfig } from "../types.js";
import type {
  BenchmarkRunResult,
  HardwareInfo,
  MemoryMode,
  ModelVramEstimate,
} from "./types.js";
import { detectHardware } from "./gpu_detector.js";
import {
  classifyModels,
  estimateModelVram,
  formatCandidateList,
  parseParameterSize,
  parseQuantizationBits,
} from "./model_filter.js";
import {
  CONTEXT_WINDOW_SIZES,
  findSafeContextWindows,
  formatContextWindowSummary,
} from "./context_checker.js";
import type { ContextWindowResult } from "./types.js";
import { generateRecommendations } from "./recommendation_engine.js";
import {
  formatHardwareSummary,
  formatRecommendationReport,
} from "./report_formatter.js";
import { applyRecommendation, formatAcceptanceConfirmation } from "./config_acceptor.js";
import {
  applySuggestedBridgeContextLimits,
} from "./context_limits.js";
import { createBenchmarkHandler } from "../tools/benchmark.js";
import type { ModelResult } from "../tools/benchmark.js";
import { selectOne, SelectorCancelledError, type SelectItem } from "../console/selector.js";
import { writeEnvKeys } from "../console/dotenv_writer.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AdvisorOptions {
  ollamaClient: IOllamaClient;
  config: BridgeConfig;
  rl: readline.Interface;
  benchmarkOutputFile?: string;
}

// ---------------------------------------------------------------------------
// Readline prompt helper
// ---------------------------------------------------------------------------

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Phase 1: Hardware detection
// ---------------------------------------------------------------------------

async function runPhase1(
  rl: readline.Interface
): Promise<{ hardware: HardwareInfo; vramBudgetMb: number }> {
  console.log("\n=== Phase 1: Hardware Detection ===\n");

  const hardware = await detectHardware({
    promptForVram: async () => {
      const raw = (await prompt(rl, "Enter your GPU VRAM in MB (or 0 for CPU-only): ")).trim();
      const val = parseInt(raw, 10);
      return !isNaN(val) && val >= 0 ? val : 0;
    },
    promptForRam: async () => {
      const raw = (await prompt(rl, "Enter your system RAM in MB: ")).trim();
      const val = parseInt(raw, 10);
      return !isNaN(val) && val > 0 ? val : 0;
    },
  });

  // Display hardware summary (mode will be shown after selection; use vram_only as placeholder)
  console.log("\n" + formatHardwareSummary(hardware, "vram_only"));

  // Offer VRAM override
  const overrideInput = (
    await prompt(rl, "\nOverride VRAM budget? (enter MB or press Enter to keep detected value): ")
  ).trim();

  let vramBudgetMb = hardware.vramBudgetMb;
  if (overrideInput !== "") {
    const override = parseInt(overrideInput, 10);
    if (!isNaN(override) && override > 0) {
      vramBudgetMb = override;
      console.log(`VRAM budget overridden to: ${vramBudgetMb} MB`);
    } else {
      console.log("Invalid override value, keeping detected VRAM budget.");
    }
  }

  return { hardware, vramBudgetMb };
}

// ---------------------------------------------------------------------------
// Phase 2: Memory mode + model candidate filtering
// ---------------------------------------------------------------------------

async function runPhase2(
  rl: readline.Interface,
  ollamaClient: IOllamaClient,
  vramBudgetMb: number,
  systemRamMb: number
): Promise<{ mode: MemoryMode; candidates: ModelVramEstimate[]; exclusions: Array<{ modelName: string; reason: string }> }> {
  console.log("\n=== Phase 2: Memory Mode & Model Filtering ===\n");

  console.log(`System RAM: ${systemRamMb.toLocaleString()} MB`);

  let mode: MemoryMode = "vram_only";
  const modeItems: SelectItem<MemoryMode>[] = [
    { label: "VRAM-only — all models run fully on GPU; maximum throughput", value: "vram_only" },
    { label: "RAM-assisted — larger models may use CPU offloading; higher latency", value: "ram_assisted" },
  ];

  try {
    mode = await selectOne(modeItems, { defaultValue: "vram_only" });
  } catch (err) {
    if (err instanceof SelectorCancelledError) {
      mode = "vram_only";
    } else {
      throw err;
    }
  }

  console.log(`Memory mode: ${mode === "ram_assisted" ? "RAM-assisted" : "VRAM-only"}`);

  // Fetch model list
  let modelNames: string[];
  try {
    modelNames = await ollamaClient.listModels();
  } catch (err) {
    process.stderr.write(
      `[advisor] Failed to list models: ${err instanceof Error ? err.message : String(err)}\n`
    );
    modelNames = [];
  }

  if (modelNames.length === 0) {
    console.log("No models found in Ollama.");
    return { mode, candidates: [], exclusions: [] };
  }

  // Build VRAM estimates
  const estimates: ModelVramEstimate[] = [];
  for (const modelName of modelNames) {
    let paramB = 0;
    let quantBits = 4;

    try {
      const info = await ollamaClient.showModel(modelName);
      paramB = parseParameterSize(info.details.parameter_size ?? "");
      quantBits = parseQuantizationBits(info.details.quantization_level ?? "");
    } catch {
      // Non-fatal — use conservative defaults
      process.stderr.write(`[advisor] showModel failed for ${modelName}, using defaults\n`);
    }

    const estimatedVramMb = estimateModelVram(paramB, quantBits);
    estimates.push({
      modelName,
      parametersBillions: paramB,
      quantizationBits: quantBits,
      estimatedVramMb,
      memoryClass: "excluded", // will be set by classifyModels
    });
  }

  // Classify models
  const classified = classifyModels(estimates, vramBudgetMb, systemRamMb, mode);

  // Display candidate list
  console.log("\n" + formatCandidateList(classified));

  // Separate candidates from exclusions
  const candidates = classified.filter((m) => m.memoryClass !== "excluded");
  const exclusions = classified
    .filter((m) => m.memoryClass === "excluded")
    .map((m) => ({
      modelName: m.modelName,
      reason: m.exclusionReason ?? "Exceeds memory budget",
    }));

  // If no candidates, offer VRAM override re-run
  if (candidates.length === 0) {
    console.log("\nNo candidate models found with current VRAM budget.");
    const retryInput = (
      await prompt(rl, "Enter a manual VRAM budget override in MB to retry (or press Enter to skip): ")
    ).trim();

    if (retryInput !== "") {
      const override = parseInt(retryInput, 10);
      if (!isNaN(override) && override > 0) {
        return runPhase2(rl, ollamaClient, override, systemRamMb);
      }
    }
  }

  return { mode, candidates, exclusions };
}

// ---------------------------------------------------------------------------
// Phase 3: Context window safety check
// ---------------------------------------------------------------------------

function runPhase3(
  candidates: ModelVramEstimate[],
  vramBudgetMb: number
): { contextResults: ContextWindowResult[]; validCandidates: ModelVramEstimate[]; additionalExclusions: Array<{ modelName: string; reason: string }> } {
  console.log("\n=== Phase 3: Context Window Safety Check ===\n");

  const contextResults: ContextWindowResult[] = [];
  const validCandidates: ModelVramEstimate[] = [];
  const additionalExclusions: Array<{ modelName: string; reason: string }> = [];

  for (const candidate of candidates) {
    const result = findSafeContextWindows(candidate.estimatedVramMb, vramBudgetMb);
    result.modelName = candidate.modelName;
    contextResults.push(result);

    if (result.maxSafeContextTokens === null) {
      additionalExclusions.push({
        modelName: candidate.modelName,
        reason: "No safe context window fits within VRAM budget",
      });
    } else {
      validCandidates.push(candidate);
    }
  }

  console.log(formatContextWindowSummary(contextResults));

  return { contextResults, validCandidates, additionalExclusions };
}

// ---------------------------------------------------------------------------
// Task 5.1 — Offload detection helper
// ---------------------------------------------------------------------------

/**
 * Checks whether a model is currently offloading layers to RAM by querying
 * Ollama's /api/ps endpoint.
 *
 * Returns `{ offloading: false, sizeVramMb: 0, sizeTotalMb: 0 }` when the
 * model is not found in the running-models list (e.g. not yet loaded).
 *
 * Requirements: 2.1
 */
async function checkOffloading(
  ollamaClient: IOllamaClient,
  modelName: string
): Promise<{ offloading: boolean; sizeVramMb: number; sizeTotalMb: number }> {
  const running = await ollamaClient.listRunningModels();
  const entry = running.find((m) => m.name === modelName);
  if (!entry) {
    return { offloading: false, sizeVramMb: 0, sizeTotalMb: 0 };
  }
  const sizeVramMb = Math.round(entry.size_vram / (1024 * 1024));
  const sizeTotalMb = Math.round(entry.size / (1024 * 1024));
  return {
    offloading: entry.size_vram < entry.size,
    sizeVramMb,
    sizeTotalMb,
  };
}

// ---------------------------------------------------------------------------
// Phase 4: Benchmark execution
// ---------------------------------------------------------------------------

async function runPhase4(
  ollamaClient: IOllamaClient,
  validCandidates: ModelVramEstimate[],
  contextResults: ContextWindowResult[],
  mode: MemoryMode,
  benchmarkOutputFile?: string
): Promise<BenchmarkRunResult[]> {
  console.log("\n=== Phase 4: Benchmark Execution ===\n");

  const handler = createBenchmarkHandler(ollamaClient, benchmarkOutputFile);
  const allResults: BenchmarkRunResult[] = [];

  // Read FA state once from env — we cannot change it here; Ollama reads it at startup.
  const flashAttentionEnabled = process.env["OLLAMA_FLASH_ATTENTION"] === "1";
  console.log(`Flash Attention: ${flashAttentionEnabled ? "ON (set in env)" : "OFF (not set in env)"}`);
  console.log("Note: to change Flash Attention, update it in Edit Bridge Limits and restart Ollama.\n");

  // Build a map from modelName → maxSafeContextTokens
  const ctxMap = new Map<string, number>();
  for (const r of contextResults) {
    if (r.maxSafeContextTokens !== null) {
      ctxMap.set(r.modelName, r.maxSafeContextTokens);
    }
  }

  const ramAssistedCandidates = validCandidates.filter((c) => c.memoryClass === "ram_assisted");

  // Single benchmark pass — one result per model at current FA state
  for (const candidate of validCandidates) {
    const initialMaxCtx = ctxMap.get(candidate.modelName);
    if (initialMaxCtx === undefined) continue;

    console.log(`  → benchmarking ${candidate.modelName}`);

    try {
      // Warm up at the initial max context size
      const contextOverrides: Record<string, number> = { [candidate.modelName]: initialMaxCtx };
      await handler(
        { models: [candidate.modelName] },
        { contextOverrides, warmUp: true }
      );

      // Offload detection for gpu_native candidates in vram_only mode
      let maxCtx = initialMaxCtx;
      let offloadingDetectedFlag = false;

      if (candidate.memoryClass === "gpu_native" && mode === "vram_only") {
        let offloadResult: { offloading: boolean; sizeVramMb: number; sizeTotalMb: number };
        try {
          offloadResult = await checkOffloading(ollamaClient, candidate.modelName);
        } catch (err) {
          process.stderr.write(
            `[advisor] checkOffloading failed for ${candidate.modelName}: ${err instanceof Error ? err.message : String(err)}\n`
          );
          offloadResult = { offloading: false, sizeVramMb: 0, sizeTotalMb: 0 };
        }

        if (offloadResult.offloading) {
          process.stdout.write(
            `  ⚠ ${candidate.modelName}: offloading detected (${offloadResult.sizeVramMb} MB in VRAM, ${offloadResult.sizeTotalMb} MB total) — auto-stepping down context...\n`
          );

          const sizes = [...CONTEXT_WINDOW_SIZES]
            .reverse()
            .filter((s) => s < maxCtx);

          for (const size of sizes) {
            maxCtx = size;
            process.stdout.write(`    ↓ trying ${size / 1024}k context...\n`);

            const newContextOverrides: Record<string, number> = { [candidate.modelName]: maxCtx };
            await handler(
              { models: [candidate.modelName] },
              { contextOverrides: newContextOverrides, warmUp: true }
            );

            let recheck: { offloading: boolean; sizeVramMb: number; sizeTotalMb: number };
            try {
              recheck = await checkOffloading(ollamaClient, candidate.modelName);
            } catch (err) {
              process.stderr.write(
                `[advisor] checkOffloading failed for ${candidate.modelName}: ${err instanceof Error ? err.message : String(err)}\n`
              );
              recheck = { offloading: false, sizeVramMb: 0, sizeTotalMb: 0 };
            }

            if (!recheck.offloading) {
              process.stdout.write(`    ✓ offloading cleared at ${size / 1024}k\n`);
              break;
            }

            if (size === 4096 && recheck.offloading) {
              process.stdout.write(`    ⚠ still offloading at minimum context (4k) — proceeding anyway\n`);
              offloadingDetectedFlag = true;
              break;
            }
          }
        }
      }

      // Run benchmark at the (possibly stepped-down) maxCtx
      const benchContextOverrides: Record<string, number> = { [candidate.modelName]: maxCtx };
      const { report } = await handler(
        { models: [candidate.modelName] },
        { contextOverrides: benchContextOverrides, warmUp: false }
      );

      const results = convertModelResults(
        report.models,
        candidate.estimatedVramMb,
        candidate.memoryClass as "gpu_native" | "ram_assisted",
        flashAttentionEnabled,
        maxCtx,
        candidate.parametersBillions
      );

      if (offloadingDetectedFlag) {
        for (const r of results) {
          r.offloadingDetected = true;
        }
      }

      allResults.push(...results);
    } catch (err) {
      process.stderr.write(
        `[advisor] Benchmark failed for ${candidate.modelName}: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  // RAM-assisted note
  if (ramAssistedCandidates.length > 0) {
    console.log("\nRAM-assisted models (CPU offload):");
    for (const candidate of ramAssistedCandidates) {
      console.log(`  ⚠ ${candidate.modelName} exceeds VRAM budget — will use CPU offloading`);
    }
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// Helper: convert ModelResult[] → BenchmarkRunResult[]
// ---------------------------------------------------------------------------

function convertModelResults(
  modelResults: ModelResult[],
  vramEstimateMb: number,
  memoryMode: "gpu_native" | "ram_assisted",
  flashAttentionEnabled: boolean,
  contextWindow: number,
  parametersBillions: number
): BenchmarkRunResult[] {
  const results: BenchmarkRunResult[] = [];

  for (const mr of modelResults) {
    if (mr.status === "ERROR") continue;
    if (mr.tasks.length === 0) continue;

    const throughputs = mr.tasks.map((t) => t.metrics.throughput);
    const latencies = mr.tasks.map((t) => t.metrics.latency);

    const meanThroughput =
      throughputs.reduce((a, b) => a + b, 0) / throughputs.length;
    const meanLatency =
      latencies.reduce((a, b) => a + b, 0) / latencies.length;

    results.push({
      modelName: mr.model,
      contextWindow,
      throughputTokensPerSec: meanThroughput,
      latencyMs: meanLatency,
      vramEstimateMb,
      flashAttentionEnabled,
      memoryMode,
      parametersBillions,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Phase 5: Recommendations + report
// ---------------------------------------------------------------------------

async function runPhase5(
  allResults: BenchmarkRunResult[],
  hardware: HardwareInfo,
  mode: MemoryMode,
  exclusions: Array<{ modelName: string; reason: string }>
): Promise<ReturnType<typeof generateRecommendations> | null> {
  console.log("\n=== Phase 5: Recommendations ===\n");

  if (allResults.length === 0) {
    console.error("All models failed benchmarking. Cannot generate recommendations.");
    return null;
  }

  let report: ReturnType<typeof generateRecommendations>;
  try {
    report = generateRecommendations(allResults, hardware, mode, exclusions);
  } catch (err) {
    console.error(
      `Failed to generate recommendations: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  const formattedReport = formatRecommendationReport(report);
  console.log(formattedReport);

  // Append to ollama-benchmark.log
  try {
    await fs.appendFile("ollama-benchmark.log", formattedReport + "\n\n", "utf-8");
    console.log("\nReport appended to ollama-benchmark.log");
  } catch (err) {
    process.stderr.write(
      `[advisor] Failed to append to ollama-benchmark.log: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  return report;
}

// ---------------------------------------------------------------------------
// Phase 6: Configuration acceptance
// ---------------------------------------------------------------------------

async function runPhase6(
  rl: readline.Interface,
  config: BridgeConfig,
  report: ReturnType<typeof generateRecommendations>
): Promise<void> {
  console.log("\n=== Phase 6: Accept Recommendation ===\n");

  const recommendationItems: SelectItem<string>[] = [
    { label: "Fastest", value: "fastest" },
    { label: "Most Context", value: "most_context" },
    { label: "FA (Flash Attention)", value: "fa" },
    { label: "Best Overall", value: "best_overall" },
    { label: "Most Parameters (largest model)", value: "most_parameters" },
    { label: "Custom", value: "custom" },
    { label: "Skip", value: "skip" },
  ];

  let sel: string;
  try {
    sel = await selectOne(recommendationItems, { defaultValue: "skip" });
  } catch (err) {
    if (err instanceof SelectorCancelledError) {
      sel = "skip";
    } else {
      throw err;
    }
  }

  switch (sel) {
    case "fastest": {
      const rec = report.recommendations.fastest;
      await applyRecommendation(config, rec);
      console.log("\n" + formatAcceptanceConfirmation(rec));
      break;
    }
    case "most_context": {
      const rec = report.recommendations.most_context;
      await applyRecommendation(config, rec);
      console.log("\n" + formatAcceptanceConfirmation(rec));
      break;
    }
    case "fa": {
      const rec = report.recommendations.fa;
      await applyRecommendation(config, rec);
      console.log("\n" + formatAcceptanceConfirmation(rec));
      break;
    }
    case "best_overall": {
      const rec = report.recommendations.best_overall;
      await applyRecommendation(config, rec);
      console.log("\n" + formatAcceptanceConfirmation(rec));
      break;
    }
    case "most_parameters": {
      const rec = report.recommendations.most_parameters;
      await applyRecommendation(config, rec);
      console.log("\n" + formatAcceptanceConfirmation(rec));
      break;
    }
    case "custom": {
      // Custom: prompt for model name and context window
      const modelName = (await prompt(rl, "Enter model name: ")).trim();
      if (!modelName) {
        console.log("No model name entered. Skipping.");
        break;
      }
      const ctxRaw = (await prompt(rl, "Enter context window (tokens): ")).trim();
      const contextWindow = parseInt(ctxRaw, 10);
      if (isNaN(contextWindow) || contextWindow <= 0) {
        console.log("Invalid context window. Skipping.");
        break;
      }

      config.defaultModel = modelName;
      process.env["OLLAMA_DEFAULT_MODEL"] = modelName;
      config.contextWindow = contextWindow;
      process.env["OLLAMA_NUM_CTX"] = String(contextWindow);
      process.env["OLLAMA_CONTEXT_WINDOW"] = String(contextWindow);
      const suggestedLimits = applySuggestedBridgeContextLimits(config, contextWindow);

      await writeEnvKeys({
        OLLAMA_DEFAULT_MODEL: modelName,
        OLLAMA_CONTEXT_WINDOW: String(contextWindow),
        BRIDGE_MAX_CONTEXT_FILES: String(suggestedLimits.maxContextFiles),
        BRIDGE_MAX_FILE_TOKENS: String(suggestedLimits.maxFileTokens),
        BRIDGE_MAX_TOTAL_CONTEXT_TOKENS: String(suggestedLimits.maxTotalContextTokens),
      });

      console.log(
        `\nConfiguration applied and saved to .env:\n` +
          `  Model:          ${modelName}\n` +
          `  Context Window: ${contextWindow.toLocaleString("en-US")} tokens\n` +
          `  MCP Context:    ${suggestedLimits.maxTotalContextTokens.toLocaleString("en-US")} total tokens, ` +
          `${suggestedLimits.maxFileTokens.toLocaleString("en-US")} per file, ` +
          `${suggestedLimits.maxContextFiles} files`
      );
      break;
    }
    case "skip":
    default:
      console.log("Skipping — configuration unchanged.");
      break;
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs the full Benchmark Advisor wizard, orchestrating all phases in sequence.
 *
 * @param opts - Advisor options including Ollama client, config, readline interface, and optional output file.
 */
export async function runBenchmarkAdvisor(opts: AdvisorOptions): Promise<void> {
  const { ollamaClient, config, rl, benchmarkOutputFile } = opts;

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║       Benchmark Advisor Wizard       ║");
  console.log("╚══════════════════════════════════════╝");

  // Phase 1: Hardware detection
  let hardware: HardwareInfo;
  let vramBudgetMb: number;
  try {
    ({ hardware, vramBudgetMb } = await runPhase1(rl));
  } catch (err) {
    process.stderr.write(
      `[advisor] Phase 1 failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  // Phase 2: Memory mode + model filtering
  let mode: MemoryMode;
  let candidates: ModelVramEstimate[];
  let exclusions: Array<{ modelName: string; reason: string }>;
  try {
    ({ mode, candidates, exclusions } = await runPhase2(
      rl,
      ollamaClient,
      vramBudgetMb,
      hardware.systemRamMb
    ));
  } catch (err) {
    process.stderr.write(
      `[advisor] Phase 2 failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  if (candidates.length === 0) {
    console.log("\nNo candidate models available. Exiting advisor.");
    return;
  }

  // Phase 3: Context window safety check
  let contextResults: ContextWindowResult[];
  let validCandidates: ModelVramEstimate[];
  let additionalExclusions: Array<{ modelName: string; reason: string }>;
  try {
    ({ contextResults, validCandidates, additionalExclusions } = runPhase3(
      candidates,
      vramBudgetMb
    ));
  } catch (err) {
    process.stderr.write(
      `[advisor] Phase 3 failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  // Merge additional exclusions
  const allExclusions = [...exclusions, ...additionalExclusions];

  if (validCandidates.length === 0) {
    console.log("\nNo models have a safe context window within the VRAM budget. Exiting advisor.");
    return;
  }

  // Phase 4: Benchmark execution
  let allResults: BenchmarkRunResult[];
  try {
    allResults = await runPhase4(
      ollamaClient,
      validCandidates,
      contextResults,
      mode,
      benchmarkOutputFile
    );
  } catch (err) {
    process.stderr.write(
      `[advisor] Phase 4 failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  // Phase 5: Recommendations + report
  let report: ReturnType<typeof generateRecommendations> | null;
  try {
    report = await runPhase5(allResults, hardware, mode, allExclusions);
  } catch (err) {
    process.stderr.write(
      `[advisor] Phase 5 failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  if (report === null) {
    return;
  }

  // Phase 6: Configuration acceptance
  try {
    await runPhase6(rl, config, report);
  } catch (err) {
    process.stderr.write(
      `[advisor] Phase 6 failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  console.log("\nBenchmark Advisor complete.\n");
}
