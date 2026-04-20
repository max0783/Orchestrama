#!/usr/bin/env node
/**
 * ollama-mcp-bridge benchmark advisor CLI
 *
 * Runs the full Benchmark Advisor wizard:
 *   1. Detects GPU/RAM hardware
 *   2. Filters model candidates by memory budget
 *   3. Checks safe context windows
 *   4. Benchmarks candidates (FA-on, FA-off, RAM-assisted)
 *   5. Generates recommendations and displays report
 *   6. Applies selected configuration
 */

import { createInterface } from "readline";
import { loadConfig } from "../config.js";
import { OllamaClient } from "../ollama/client.js";
import { runBenchmarkAdvisor } from "../advisor/index.js";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const config = loadConfig();
    const ollamaClient = new OllamaClient(config.ollamaBaseUrl, config.keepAlive);

    await runBenchmarkAdvisor({
      ollamaClient,
      config,
      rl,
      benchmarkOutputFile: config.benchmarkOutputFile,
    });
  } catch (err) {
    console.error(
      "\nFatal error:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
