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
  formatBenchmarkReport,
} from "./formatters.js";
import type { BridgeConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Exported helper — testable independently of the interactive loop
// ---------------------------------------------------------------------------

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
          break;
        }

        // ------------------------------------------------------------------
        case "run_benchmark": {
          const modelsInput = (
            await prompt(rl, "Model names (comma-separated, leave blank for all): ")
          ).trim();
          const iterInput = (
            await prompt(rl, "Iterations (leave blank for 1): ")
          ).trim();

          const models = modelsInput
            ? modelsInput.split(",").map((m) => m.trim()).filter(Boolean)
            : [];
          const iterations = iterInput ? parseInt(iterInput, 10) : 1;

          process.stdout.write("Running benchmark");
          const progressInterval = setInterval(() => {
            process.stdout.write(".");
          }, 500);

          try {
            const args: Record<string, unknown> = { iterations };
            if (models.length > 0) {
              args["models"] = models;
            }
            const result = await benchmarkHandler(args);
            clearInterval(progressInterval);
            process.stdout.write("\n");

            // Extract model results from the text for formatting
            // The handler returns formatted text; we also use formatBenchmarkReport
            // by re-parsing the report structure from the handler result
            console.log("\n" + (result.content[0]?.text ?? ""));
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
