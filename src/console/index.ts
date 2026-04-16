/**
 * Human Console entry point for ollama-mcp-bridge.
 *
 * Interactive CLI that provides access to all administrative tools:
 * list models, ping model, set default model, run benchmarks, view
 * configuration, view capability map, view reduction statistics, and
 * run health checks.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4,
 *               4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4,
 *               6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5
 */

import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { loadConfig } from "../config.js";
import { OllamaClient } from "../ollama/client.js";
import { ReductionLogger } from "../logging/reduction_logger.js";
import { CapabilityRouter } from "../routing/capability_map.js";
import { Chunker } from "../chunking/index.js";
import { RequestQueue } from "../queue/request_queue.js";
import { createListModelsHandler } from "../tools/list_models.js";
import { createPingHandler } from "../tools/ping.js";
import { createBenchmarkHandler } from "../tools/benchmark.js";
import { createTestConfigHandler } from "../tools/test_config.js";
import { createReductionStatsHandler } from "../tools/reduction_stats.js";
import { createCapabilityMapHandler } from "../tools/capability_map.js";
import { renderMenu, parseSelection } from "./menu.js";
import {
  formatModelList,
  formatPingResult,
  formatConfig,
  formatCapabilityMap,
  formatReductionStats,
  formatCheckResults,
} from "./formatters.js";
import type { BridgeConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Benchmark log helper
// ---------------------------------------------------------------------------

const BENCHMARK_LOG_PATH = "./ollama-benchmark.log";

async function appendBenchmarkLog(text: string): Promise<void> {
  try {
    await fs.appendFile(BENCHMARK_LOG_PATH, text + "\n\n", "utf-8");
  } catch (err) {
    process.stderr.write(
      `[ollama-mcp-bridge] Failed to append benchmark log: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Context window picker helper
// ---------------------------------------------------------------------------

const CTX_PRESETS = [4096, 8192, 16384, 32768, 65536, 131072, 262144];

async function pickContextWindow(
  rl: readline.Interface,
  label: string
): Promise<number | undefined> {
  console.log(`\n${label}`);
  CTX_PRESETS.forEach((v, i) => console.log(`  ${i + 1}. ${(v / 1024).toFixed(0)}K  (${v})`));
  console.log(`  ${CTX_PRESETS.length + 1}. Enter custom value`);
  console.log(`  0. Skip (use model default)`);

  const sel = (await prompt(rl, "Choice: ")).trim();
  if (sel === "0" || sel === "") return undefined;

  const idx = parseInt(sel, 10) - 1;
  if (idx >= 0 && idx < CTX_PRESETS.length) return CTX_PRESETS[idx];

  if (idx === CTX_PRESETS.length) {
    const raw = (await prompt(rl, "Enter context window (tokens): ")).trim();
    const val = parseInt(raw, 10);
    return !isNaN(val) && val > 0 ? val : undefined;
  }

  return undefined;
}

/**
 * Sets the default model for the current session.
 * Updates both the config object and process.env.OLLAMA_DEFAULT_MODEL.
 *
 * Property 6: Set default model updates the session default
 * Validates: Requirements 3.3
 */
export function setDefaultModel(config: BridgeConfig, modelName: string): void {
  config.defaultModel = modelName;
  process.env["OLLAMA_DEFAULT_MODEL"] = modelName;
}

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Main console loop
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();

  // Instantiate shared dependencies
  const ollamaClient = new OllamaClient(config.ollamaBaseUrl, config.keepAlive);
  const reductionLogger = new ReductionLogger(config.reductionLogPath);
  const capabilityRouter = new CapabilityRouter(config.capabilityMap, config.defaultModel);
  const chunker = new Chunker((req) => ollamaClient.generate(req));
  const requestQueue = new RequestQueue(config.numParallel, config.queueMaxSize);

  // Instantiate handler factories
  const listModelsHandler = createListModelsHandler(ollamaClient);
  const pingHandler = createPingHandler(ollamaClient, config.defaultModel);
  const benchmarkHandler = createBenchmarkHandler(ollamaClient, config.benchmarkOutputFile);
  const testConfigHandler = createTestConfigHandler({
    ollamaClient,
    chunker,
    requestQueue,
    defaultModel: config.defaultModel,
    contextWindow: config.contextWindow,
  });
  const reductionStatsHandler = createReductionStatsHandler(reductionLogger);
  const capabilityMapHandler = createCapabilityMapHandler(capabilityRouter);

  // Set up readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle SIGINT (Ctrl+C) and readline close as exit requests
  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    rl.close();
  });

  // ---------------------------------------------------------------------------
  // Main menu loop
  // ---------------------------------------------------------------------------

  while (true) {
    console.log("\n" + renderMenu());
    const input = (await prompt(rl, "\nSelect an option: ")).trim();
    const action = parseSelection(input);

    if (action === null) {
      console.log("Invalid selection, please try again.");
      continue;
    }

    if (action === "exit") {
      rl.close();
      return;
    }

    try {
      switch (action) {
        // ------------------------------------------------------------------
        case "list_models": {
          const result = await listModelsHandler({});
          const text = result.content[0]?.text ?? "";
          // Parse model names from the text and format them
          const models = text === "No models available" ? [] : text.split("\n").filter(Boolean);
          console.log("\n" + formatModelList(models));
          break;
        }

        // ------------------------------------------------------------------
        case "ping_model": {
          const modelInput = (await prompt(rl, "Model name (leave blank for default): ")).trim();
          const modelName = modelInput || config.defaultModel;
          const pingResult = await ollamaClient.ping(modelName);
          console.log("\n" + formatPingResult(modelName, pingResult));
          break;
        }

        // ------------------------------------------------------------------
        case "set_default_model": {
          let modelName = "";
          while (true) {
            modelName = (await prompt(rl, "New default model name: ")).trim();
            if (modelName === "") {
              console.log("Model name cannot be empty.");
            } else {
              break;
            }
          }
          setDefaultModel(config, modelName);
          console.log(`Default model set to: ${modelName}`);

          // Optionally set a context window for this model
          const ctxVal = await pickContextWindow(rl, "Context window for this model:");
          if (ctxVal !== undefined) {
            config.contextWindow = ctxVal;
            process.env["OLLAMA_CONTEXT_WINDOW"] = String(ctxVal);
            console.log(`Context window set to: ${ctxVal}`);
          }
          break;
        }

        // ------------------------------------------------------------------
        case "run_benchmark": {
          // 1. Resolve candidate model list
          let allModels: string[];
          try {
            allModels = await ollamaClient.listModels();
          } catch {
            allModels = [];
          }

          // 2. Let the user type specific models, or show the installed list to pick from
          const modelsInput = (
            await prompt(rl, "Model names (comma-separated, leave blank to choose from installed): ")
          ).trim();

          let selectedModels: string[];
          if (modelsInput) {
            selectedModels = modelsInput.split(",").map((m) => m.trim()).filter(Boolean);
          } else if (allModels.length === 0) {
            console.log("No models available in Ollama.");
            break;
          } else {
            // Show numbered list and let the user toggle models on/off
            console.log("\nInstalled models (enter numbers to toggle, blank = use all):");
            allModels.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
            const toggleInput = (await prompt(rl, "Toggle off (e.g. 2,4) or press Enter to use all: ")).trim();
            if (toggleInput) {
              const disabled = new Set(
                toggleInput.split(",").map((s) => parseInt(s.trim(), 10) - 1)
              );
              selectedModels = allModels.filter((_, i) => !disabled.has(i));
            } else {
              selectedModels = [...allModels];
            }
          }

          if (selectedModels.length === 0) {
            console.log("No models selected.");
            break;
          }

          // 3. Context window — single for all, or custom per model
          console.log(`\nSelected: ${selectedModels.join(", ")}`);
          const ctxModeInput = (
            await prompt(rl, "Context window — same for all models or custom per model? (all/custom, blank = model default): ")
          ).trim().toLowerCase();

          const contextOverrides: Record<string, number> = {};

          if (ctxModeInput === "custom") {
            for (const m of selectedModels) {
              const val = await pickContextWindow(rl, `Context for ${m}:`);
              if (val !== undefined) contextOverrides[m] = val;
            }
          } else if (ctxModeInput === "all" || ctxModeInput === "") {
            if (ctxModeInput === "all") {
              const val = await pickContextWindow(rl, "Context window for all models:");
              if (val !== undefined) {
                for (const m of selectedModels) contextOverrides[m] = val;
              }
            }
            // blank → no overrides, use each model's default
          }

          // 4. Iterations
          const iterInput = (await prompt(rl, "Iterations (leave blank for 1): ")).trim();
          const iterations = iterInput ? parseInt(iterInput, 10) : 1;

          // 5. Warm-up (default Y)
          const warmUpInput = (await prompt(rl, "Warm up models before benchmarking? (Y/n): ")).trim().toLowerCase();
          const warmUp = warmUpInput !== "n" && warmUpInput !== "no";

          // Run benchmark — warm-up is interleaved per model inside the handler
          process.stdout.write("Running benchmark\n");
          const progressInterval = setInterval(() => process.stdout.write("."), 500);

          try {
            const args: Record<string, unknown> = { iterations, models: selectedModels };
            const result = await benchmarkHandler(args, {
              contextOverrides,
              warmUp,
              onModelStart: (model, phase) => {
                if (phase === "warmup") {
                  process.stdout.write(`\n  ♨ warming up ${model}...`);
                } else {
                  process.stdout.write(`\n  → benchmarking ${model}`);
                }
              },
              onModelInfo: (_model, summary) => {
                if (summary) process.stdout.write(`\n     ${summary}`);
              },
            });
            clearInterval(progressInterval);
            process.stdout.write("\n");

            const reportText = result.content[0]?.text ?? "";
            console.log("\n" + reportText);

            // 7. Append to benchmark log
            await appendBenchmarkLog(reportText);
            console.log(`\nReport appended to ${path.resolve(BENCHMARK_LOG_PATH)}`);
          } catch (err) {
            clearInterval(progressInterval);
            process.stdout.write("\n");
            throw err;
          }
          break;
        }

        // ------------------------------------------------------------------
        case "view_config": {
          console.log("\n" + formatConfig(config));
          break;
        }

        // ------------------------------------------------------------------
        case "view_capability_map": {
          const map = capabilityRouter.getMap();
          console.log("\n" + formatCapabilityMap(map));

          const testPromptInput = (
            await prompt(rl, "Enter a test prompt to resolve (leave blank to skip): ")
          ).trim();

          if (testPromptInput) {
            const resolvedModel = capabilityRouter.resolveModel(testPromptInput);
            console.log(
              "\n" +
                formatCapabilityMap(map, {
                  prompt: testPromptInput,
                  model: resolvedModel,
                })
            );
          }
          break;
        }

        // ------------------------------------------------------------------
        case "view_reduction_stats": {
          const result = await reductionStatsHandler({});
          const stats = await reductionLogger.readStats();
          console.log("\n" + formatReductionStats(stats));
          void result; // handler result used for side-effect check
          break;
        }

        // ------------------------------------------------------------------
        case "test_config": {
          console.log("Running configuration health check...");
          const result = await testConfigHandler({ dry_run: false });
          const text = result.content[0]?.text ?? "";
          console.log("\n" + text);
          break;
        }

        // ------------------------------------------------------------------
        case "test_config_dry": {
          console.log("Running configuration health check (dry run)...");
          const result = await testConfigHandler({ dry_run: true });
          const text = result.content[0]?.text ?? "";
          console.log("\n" + text);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`Error: ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point guard — only run when executed directly
// ---------------------------------------------------------------------------

// Check if this module is the entry point
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts"));

if (isMain) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fatal error: ${message}`);
    process.exit(1);
  });
}
