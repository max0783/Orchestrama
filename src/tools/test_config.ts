/**
 * test_config tool handler.
 *
 * Runs a series of checks in order:
 *   1. Ollama connectivity — ping the service, record response time
 *   2. Default model existence — call listModels(), check if defaultModel is in the list
 *   3. End-to-end call — send "Reply only: OK" to defaultModel, verify non-empty response
 *   4. Chunking mechanism — create a synthetic payload of 5000 chars, process via Chunker
 *   5. Queue status — call requestQueue.getStatus(), report current state
 *
 * Supports dry_run: true to skip checks 1–4 (mark as SKIPPED).
 * Returns a structured report with ✅/❌/⏭️, response time, message, and
 * resolution suggestion per check.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 18.8
 */

import type { IOllamaClient } from "../ollama/client.js";
import type { Chunker, ChunkingOptions } from "../chunking/index.js";
import type { RequestQueue } from "../queue/request_queue.js";

// ---------------------------------------------------------------------------
// Check result types
// ---------------------------------------------------------------------------

export type CheckStatus = "PASS" | "FAIL" | "SKIPPED";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  responseTimeMs?: number;
  message: string;
  resolution?: string;
}

export interface TestConfigReport {
  checks: CheckResult[];
  allPassed: boolean;
}

// ---------------------------------------------------------------------------
// Individual check runners
// ---------------------------------------------------------------------------

async function checkOllamaConnectivity(
  ollamaClient: IOllamaClient,
  defaultModel: string
): Promise<CheckResult> {
  const start = Date.now();
  try {
    await ollamaClient.ping(defaultModel);
    const responseTimeMs = Date.now() - start;
    return {
      name: "Ollama connectivity",
      status: "PASS",
      responseTimeMs,
      message: `✅ Ollama is reachable (${responseTimeMs}ms)`,
    };
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Ollama connectivity",
      status: "FAIL",
      responseTimeMs,
      message: `❌ Cannot reach Ollama: ${msg}`,
      resolution:
        "Ensure Ollama is running (e.g. `ollama serve`) and OLLAMA_BASE_URL is correct.",
    };
  }
}

async function checkDefaultModelExists(
  ollamaClient: IOllamaClient,
  defaultModel: string
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const models = await ollamaClient.listModels();
    const responseTimeMs = Date.now() - start;
    if (models.includes(defaultModel)) {
      return {
        name: "Default model existence",
        status: "PASS",
        responseTimeMs,
        message: `✅ Default model "${defaultModel}" is available`,
      };
    } else {
      return {
        name: "Default model existence",
        status: "FAIL",
        responseTimeMs,
        message: `❌ Default model "${defaultModel}" not found. Available: ${models.join(", ") || "(none)"}`,
        resolution: `Pull the model with \`ollama pull ${defaultModel}\` or set OLLAMA_DEFAULT_MODEL to an available model.`,
      };
    }
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Default model existence",
      status: "FAIL",
      responseTimeMs,
      message: `❌ Failed to list models: ${msg}`,
      resolution: "Ensure Ollama is running and accessible.",
    };
  }
}

async function checkEndToEndCall(
  ollamaClient: IOllamaClient,
  defaultModel: string
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await ollamaClient.generate({
      model: defaultModel,
      prompt: "Reply only: OK",
      stream: false,
    });
    const responseTimeMs = Date.now() - start;
    if (response.response && response.response.trim().length > 0) {
      return {
        name: "End-to-end call",
        status: "PASS",
        responseTimeMs,
        message: `✅ Model responded in ${responseTimeMs}ms`,
      };
    } else {
      return {
        name: "End-to-end call",
        status: "FAIL",
        responseTimeMs,
        message: `❌ Model returned an empty response`,
        resolution: "Check that the model is functioning correctly in Ollama.",
      };
    }
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "End-to-end call",
      status: "FAIL",
      responseTimeMs,
      message: `❌ End-to-end call failed: ${msg}`,
      resolution: "Verify the model is loaded and Ollama is healthy.",
    };
  }
}

async function checkChunkingMechanism(
  chunker: Chunker,
  defaultModel: string,
  contextWindow: number
): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Create a synthetic payload of 5000 chars (exceeds typical context window)
    const syntheticPayload = "A".repeat(5000);
    const systemPrompt = "Summarize the following content concisely.";

    const opts: ChunkingOptions = {
      contextWindow,
      systemPromptTokens: Math.floor(systemPrompt.length / 4),
      model: defaultModel,
    };

    const result = await chunker.process(
      syntheticPayload,
      systemPrompt,
      opts,
      () => {} // no-op progress callback
    );

    const responseTimeMs = Date.now() - start;

    if (result.finalResponse && result.finalResponse.trim().length > 0) {
      return {
        name: "Chunking mechanism",
        status: "PASS",
        responseTimeMs,
        message: `✅ Chunking produced a non-empty result (${result.chunksUsed} chunk(s), wasChunked=${result.wasChunked})`,
      };
    } else {
      return {
        name: "Chunking mechanism",
        status: "FAIL",
        responseTimeMs,
        message: `❌ Chunking returned an empty response`,
        resolution: "Check the Chunker configuration and Ollama connectivity.",
      };
    }
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Chunking mechanism",
      status: "FAIL",
      responseTimeMs,
      message: `❌ Chunking failed: ${msg}`,
      resolution: "Verify Ollama is running and the default model is available.",
    };
  }
}

function checkQueueStatus(requestQueue: RequestQueue): CheckResult {
  const status = requestQueue.getStatus();
  return {
    name: "Queue status",
    status: "PASS",
    message: `✅ Queue: ${status.queueLength} waiting, ${status.activeRequests} active, concurrency limit ${status.concurrencyLimit}`,
  };
}

// ---------------------------------------------------------------------------
// Report formatter
// ---------------------------------------------------------------------------

function formatReport(report: TestConfigReport): string {
  const lines: string[] = ["Configuration Test Report", "=".repeat(40)];

  for (const check of report.checks) {
    const icon =
      check.status === "PASS"
        ? "✅"
        : check.status === "SKIPPED"
        ? "⏭️"
        : "❌";
    const timeStr =
      check.responseTimeMs !== undefined ? ` [${check.responseTimeMs}ms]` : "";
    lines.push(`\n${icon} ${check.name}${timeStr}`);
    lines.push(`   ${check.message}`);
    if (check.resolution) {
      lines.push(`   💡 ${check.resolution}`);
    }
  }

  lines.push("\n" + "=".repeat(40));
  lines.push(
    report.allPassed
      ? "✅ All checks passed"
      : "❌ Some checks failed — see details above"
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export interface TestConfigDeps {
  ollamaClient: IOllamaClient;
  chunker: Chunker;
  requestQueue: RequestQueue;
  defaultModel: string;
  contextWindow: number;
}

export function createTestConfigHandler(deps: TestConfigDeps) {
  const { ollamaClient, chunker, requestQueue, defaultModel, contextWindow } = deps;

  return async (args: unknown) => {
    const dryRun =
      (args as Record<string, unknown>)?.dry_run === true;

    const checks: CheckResult[] = [];

    if (dryRun) {
      // Skip checks 1–4 in dry_run mode (Req 9.8)
      checks.push({
        name: "Ollama connectivity",
        status: "SKIPPED",
        message: "⏭️ Skipped (dry_run=true)",
      });
      checks.push({
        name: "Default model existence",
        status: "SKIPPED",
        message: "⏭️ Skipped (dry_run=true)",
      });
      checks.push({
        name: "End-to-end call",
        status: "SKIPPED",
        message: "⏭️ Skipped (dry_run=true)",
      });
      checks.push({
        name: "Chunking mechanism",
        status: "SKIPPED",
        message: "⏭️ Skipped (dry_run=true)",
      });
    } else {
      // Check 1: Ollama connectivity
      checks.push(await checkOllamaConnectivity(ollamaClient, defaultModel));

      // Check 2: Default model existence
      checks.push(await checkDefaultModelExists(ollamaClient, defaultModel));

      // Check 3: End-to-end call
      checks.push(await checkEndToEndCall(ollamaClient, defaultModel));

      // Check 4: Chunking mechanism
      checks.push(await checkChunkingMechanism(chunker, defaultModel, contextWindow));
    }

    // Check 5: Queue status (always runs, even in dry_run)
    checks.push(checkQueueStatus(requestQueue));

    const allPassed = checks.every(
      (c) => c.status === "PASS" || c.status === "SKIPPED"
    );

    const report: TestConfigReport = { checks, allPassed };
    const text = formatReport(report);

    return { content: [{ type: "text" as const, text }] };
  };
}
