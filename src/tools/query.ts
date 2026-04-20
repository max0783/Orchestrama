/**
 * query_local_model tool handler.
 *
 * Validates input, resolves model, builds system prompt, reads context files,
 * estimates tokens, enqueues the request, processes via Chunker (with OOM
 * fallback), appends a reduction record, and returns the response.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.1, 7.2, 7.3, 7.4, 11.9,
 *               17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { estimateTokens } from "../chunking/index.js";
import { OllamaError } from "../ollama/client.js";
import {
  DEFAULT_MAX_CONTEXT_FILES,
  DEFAULT_MAX_FILE_TOKENS,
  DEFAULT_MAX_TOTAL_CONTEXT_TOKENS,
} from "../config.js";
import type { BridgeConfig, TaskType, ModelOptions } from "../types.js";
import type { IOllamaClient } from "../ollama/client.js";
import type { IFileReader, IgnoreInstance } from "../files/reader.js";
import type { Chunker } from "../chunking/index.js";
import type { CapabilityRouter } from "../routing/capability_map.js";
import type { SystemPromptInjector } from "../prompts/system_prompt.js";
import type { RequestQueue } from "../queue/request_queue.js";
import type { IReductionLogger } from "../logging/reduction_logger.js";
import type { ProgressNotifier } from "../notifications/progress.js";
import type { IntentDispatcher } from "../patterns/dispatcher.js";

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface QueryHandlerDeps {
  config: BridgeConfig;
  ollamaClient: IOllamaClient;
  fileReader: IFileReader;
  chunker: Chunker;
  capabilityRouter: CapabilityRouter;
  systemPromptInjector: SystemPromptInjector;
  requestQueue: RequestQueue;
  reductionLogger: IReductionLogger;
  progressNotifier: ProgressNotifier;
  intentDispatcher: IntentDispatcher;
  ignoreRules?: IgnoreInstance;
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

interface ValidatedInput {
  prompt: string;
  model: string | undefined;
  context_files: string[];
  system_prompt: string | undefined;
  intent: string | undefined;
  options: ModelOptions | undefined;
}

function validateInput(args: unknown): ValidatedInput {
  if (typeof args !== "object" || args === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Arguments must be an object"
    );
  }

  const a = args as Record<string, unknown>;

  // prompt — required string
  if (typeof a["prompt"] !== "string") {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"prompt" must be a string, got ${typeof a["prompt"]}`
    );
  }

  // model — optional string
  if (a["model"] !== undefined && typeof a["model"] !== "string") {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"model" must be a string, got ${typeof a["model"]}`
    );
  }

  // context_files — optional array of strings
  if (a["context_files"] !== undefined) {
    if (!Array.isArray(a["context_files"])) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `"context_files" must be an array, got ${typeof a["context_files"]}`
      );
    }
    for (const item of a["context_files"]) {
      if (typeof item !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          `"context_files" must be an array of strings; found element of type ${typeof item}`
        );
      }
    }
  }

  // system_prompt — optional string
  if (a["system_prompt"] !== undefined && typeof a["system_prompt"] !== "string") {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"system_prompt" must be a string, got ${typeof a["system_prompt"]}`
    );
  }

  // intent — optional string
  if (a["intent"] !== undefined && typeof a["intent"] !== "string") {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"intent" must be a string, got ${typeof a["intent"]}`
    );
  }

  // options — optional object with known numeric fields
  let options: ModelOptions | undefined;
  if (a["options"] !== undefined) {
    if (typeof a["options"] !== "object" || a["options"] === null || Array.isArray(a["options"])) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `"options" must be an object, got ${typeof a["options"]}`
      );
    }
    const o = a["options"] as Record<string, unknown>;
    const parsed: ModelOptions = {};
    const numFields: (keyof ModelOptions)[] = [
      "temperature", "top_p", "top_k", "repeat_penalty", "seed", "num_predict", "min_p", "tfs_z",
    ];
    for (const key of numFields) {
      if (key in o) {
        if (typeof o[key] !== "number") {
          throw new McpError(
            ErrorCode.InvalidParams,
            `"options.${key}" must be a number, got ${typeof o[key]}`
          );
        }
        (parsed as Record<string, unknown>)[key] = o[key];
      }
    }
    options = Object.keys(parsed).length > 0 ? parsed : undefined;
  }

  return {
    prompt: a["prompt"] as string,
    model: a["model"] as string | undefined,
    context_files: (a["context_files"] as string[] | undefined) ?? [],
    system_prompt: a["system_prompt"] as string | undefined,
    intent: a["intent"] as string | undefined,
    options,
  };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createQueryHandler(
  deps: QueryHandlerDeps
): (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const {
    config,
    fileReader,
    chunker,
    capabilityRouter,
    systemPromptInjector,
    requestQueue,
    reductionLogger,
    progressNotifier,
    intentDispatcher,
    ignoreRules,
  } = deps;

  return async (args: unknown) => {
    // -----------------------------------------------------------------------
    // 1. Validate input
    // -----------------------------------------------------------------------
    const { prompt, model: explicitModel, context_files, system_prompt, intent, options: callOptions } =
      validateInput(args);
    const maxContextFiles =
      config.maxContextFiles ?? DEFAULT_MAX_CONTEXT_FILES;
    const maxFileTokens =
      config.maxFileTokens ?? DEFAULT_MAX_FILE_TOKENS;
    const maxTotalContextTokens =
      config.maxTotalContextTokens ?? DEFAULT_MAX_TOTAL_CONTEXT_TOKENS;

    if (context_files.length > maxContextFiles) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `"context_files" exceeds limit: received ${context_files.length}, maximum is ${maxContextFiles}`
      );
    }

    // -----------------------------------------------------------------------
    // 2. Resolve model and system prompt using priority table:
    //    Priority 1 (highest): explicit system_prompt param / explicit model param
    //    Priority 2:           matched pattern's systemPrompt / modelPreference
    //    Priority 3 (lowest):  SystemPromptInjector detection / CapabilityRouter
    // -----------------------------------------------------------------------

    let patternSystemPrompt: string | undefined;
    let patternModelPreference: string | undefined;

    // Attempt intent dispatch when intent is present and non-empty (Req 1.1, 1.2)
    if (intent && intent.trim() !== "") {
      const dispatchResult = intentDispatcher.resolve(intent);
      if (dispatchResult !== null) {
        patternSystemPrompt = dispatchResult.pattern.systemPrompt;
        patternModelPreference = dispatchResult.pattern.modelPreference;
      }
      // If dispatchResult is null, fall through to existing path (Req 1.2)
    }

    // Resolve model: explicit param > pattern preference > CapabilityRouter (Req 1.4)
    const resolvedModel = capabilityRouter.resolveModel(
      prompt,
      explicitModel ?? patternModelPreference
    );

    // -----------------------------------------------------------------------
    // 3. Detect task type and build system prompt
    // -----------------------------------------------------------------------
    // Priority: explicit system_prompt > pattern systemPrompt > SystemPromptInjector
    let systemPrompt: string;
    let taskType: TaskType;

    if (system_prompt !== undefined) {
      // Priority 1: explicit system_prompt param
      taskType = systemPromptInjector.detect(prompt);
      systemPrompt = systemPromptInjector.build(taskType, system_prompt);
    } else if (patternSystemPrompt !== undefined) {
      // Priority 2: matched pattern's systemPrompt (Req 1.3)
      taskType = systemPromptInjector.detect(prompt);
      systemPrompt = patternSystemPrompt;
    } else {
      // Priority 3: SystemPromptInjector task-type detection
      taskType = systemPromptInjector.detect(prompt);
      systemPrompt = systemPromptInjector.build(taskType, undefined);
    }

    // -----------------------------------------------------------------------
    // 4. Read context files (if any) and send per-file progress notifications
    // -----------------------------------------------------------------------
    let filePayload = "";
    let fileCount = 0;

    if (context_files.length > 0) {
      const results = await fileReader.readContextFiles(context_files, ignoreRules);
      fileCount = results.length;

      const oversizedFile = results.find(
        (result) => result.content !== null && result.tokenEstimate > maxFileTokens
      );
      if (oversizedFile) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Context file too large: "${oversizedFile.path}" estimated at ${oversizedFile.tokenEstimate} tokens (limit ${maxFileTokens})`
        );
      }

      const totalContextTokens = results.reduce(
        (sum, result) => (result.content !== null ? sum + result.tokenEstimate : sum),
        0
      );
      if (totalContextTokens > maxTotalContextTokens) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Combined context files exceed token limit: ${totalContextTokens} tokens (limit ${maxTotalContextTokens})`
        );
      }

      // Send a progress notification for each file read (Req 15.5)
      for (const result of results) {
        progressNotifier.fileRead(result.path, result.tokenEstimate);
      }

      filePayload = fileReader.formatForPayload(results);
    }

    // -----------------------------------------------------------------------
    // 5. Build full payload and estimate tokens (Req 11.9)
    // -----------------------------------------------------------------------
    const fullPayload =
      filePayload.length > 0 ? `${filePayload}\n\n${prompt}` : prompt;

    const systemPromptTokens = estimateTokens(systemPrompt);
    const tokenEstimate = estimateTokens(fullPayload + systemPrompt);

    // -----------------------------------------------------------------------
    // 5a. Token budget guard — refuse before queuing if payload is too large
    //     to be useful even with chunking.
    //
    //     Chunking handles payloads larger than the context window by splitting
    //     and reducing, but if the prompt alone (without any file content)
    //     already exceeds the context window there is nothing chunking can do —
    //     the model will never see the full question. Refuse early with a clear
    //     message so the caller can rethink rather than getting a garbled reply.
    //
    //     When config.autoRetryOnOverflow is true we instead halve the context
    //     window and retry (up to 3 halvings) before giving up.
    // -----------------------------------------------------------------------
    const promptOnlyTokens = estimateTokens(prompt + systemPrompt);

    // Determine effective context window, potentially reduced by auto-retry
    let effectiveContextWindow = config.contextWindow;
    const MAX_HALVINGS = 3;

    if (promptOnlyTokens > effectiveContextWindow) {
      if (config.autoRetryOnOverflow) {
        let halvings = 0;
        while (promptOnlyTokens > effectiveContextWindow && halvings < MAX_HALVINGS) {
          effectiveContextWindow = Math.floor(effectiveContextWindow / 2);
          halvings++;
          process.stderr.write(
            `[ollama-mcp-bridge] auto_retry_overflow: prompt ~${promptOnlyTokens} tokens > context ${effectiveContextWindow * 2}, ` +
              `retrying with context=${effectiveContextWindow} (halving ${halvings}/${MAX_HALVINGS})\n`
          );
        }
        if (promptOnlyTokens > effectiveContextWindow) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `token_budget_exceeded: the prompt alone is ~${promptOnlyTokens} tokens which still exceeds ` +
              `the minimum context window of ${effectiveContextWindow} after ${MAX_HALVINGS} halvings. ` +
              `Shorten the prompt or increase OLLAMA_CONTEXT_WINDOW.`
          );
        }
      } else {
        throw new McpError(
          ErrorCode.InvalidParams,
          `token_budget_exceeded: the prompt alone is ~${promptOnlyTokens} tokens which exceeds ` +
            `the context window of ${effectiveContextWindow}. ` +
            `Shorten the prompt, increase OLLAMA_CONTEXT_WINDOW / Edit Bridge Limits in the console, ` +
            `or enable auto-retry on overflow (BRIDGE_AUTO_RETRY_OVERFLOW=true).`
        );
      }
    }

    // Warn (stderr only) when the full payload is large but chunking will handle it
    if (tokenEstimate > effectiveContextWindow) {
      process.stderr.write(
        `[ollama-mcp-bridge] token_budget: payload ~${tokenEstimate} tokens exceeds context window ` +
          `${effectiveContextWindow} — Map-Reduce chunking will be used\n`
      );
    }

    // -----------------------------------------------------------------------
    // 6. Log invocation details to stderr (Req 7.1)
    // -----------------------------------------------------------------------
    process.stderr.write(
      `[ollama-mcp-bridge] query_local_model | model=${resolvedModel} | files=${fileCount} | tokens=${tokenEstimate}\n`
    );

    // -----------------------------------------------------------------------
    // 7. Enqueue and process (Req 18.x)
    // -----------------------------------------------------------------------
    const invocationStart = Date.now();

    const response = await requestQueue.enqueue(async (signal) => {
      // Send "started" progress notification (Req 15.2)
      const estimatedChunks = Math.ceil(
        tokenEstimate / Math.max(1, Math.floor(config.contextWindow * 0.9))
      );
      progressNotifier.started(Math.max(1, estimatedChunks));

      // -----------------------------------------------------------------------
      // 7a. Process via Chunker — with OOM fallback chain (Req 17)
      // -----------------------------------------------------------------------
      let chunkResult: Awaited<ReturnType<typeof chunker.process>>;
      let usedModel = resolvedModel;
      let fallbackWarning: string | null = null;

      const tryProcess = async (model: string) => {
        // Merge: call-level options override config-level defaults
        const mergedOptions: ModelOptions | undefined =
          callOptions || config.modelOptions
            ? { ...config.modelOptions, ...callOptions }
            : undefined;

        return chunker.process(
          fullPayload,
          systemPrompt,
            {
              contextWindow: effectiveContextWindow,
              systemPromptTokens,
              model,
              modelOptions: mergedOptions,
            },
          (event) => {
            // Forward chunker progress events to the progress notifier
            if (event.type === "chunk_done") {
              progressNotifier.chunkDone(event.index, event.total, event.elapsedMs);
            } else if (event.type === "reducing") {
              progressNotifier.reducing(event.summaryCount);
            }
            // "started" events from the chunker are informational; we already
            // sent our own "started" notification above.
          },
          0,
          signal
        );
      };

      try {
        chunkResult = await tryProcess(resolvedModel);
      } catch (err) {
        // Check for OOM / resource exhaustion (Req 17.1)
        if (
          err instanceof OllamaError &&
          err.code === "local_resource_exhausted"
        ) {
          // Attempt fallback chain (Req 17.2 – 17.8)
          if (config.fallbackModels.length === 0) {
            // No fallbacks configured — re-throw immediately (Req 17.8)
            throw err;
          }

          let lastError: unknown = err;
          let succeeded = false;

          for (const fallbackModel of config.fallbackModels) {
            // Skip if same as the model that failed (Req 17.4)
            if (fallbackModel === resolvedModel) {
              continue;
            }

            // Log the fallback attempt (Req 17.5)
            process.stderr.write(
              `[ollama-mcp-bridge] OOM on ${usedModel}, trying fallback: ${fallbackModel}\n`
            );

            try {
              chunkResult = await tryProcess(fallbackModel);
              usedModel = fallbackModel;
              // Build fallback warning prefix (Req 17.6)
              fallbackWarning = `[FALLBACK: ${fallbackModel} used due to resource exhaustion on ${resolvedModel}]`;
              succeeded = true;
              break;
            } catch (fallbackErr) {
              if (
                fallbackErr instanceof OllamaError &&
                fallbackErr.code === "local_resource_exhausted"
              ) {
                lastError = fallbackErr;
                // Continue to next fallback
              } else {
                // Non-OOM error from fallback — propagate immediately
                throw fallbackErr;
              }
            }
          }

          if (!succeeded) {
            // All fallbacks exhausted (Req 17.7)
            const attempted = [resolvedModel, ...config.fallbackModels].join(", ");
            throw new McpError(
              ErrorCode.InternalError,
              `local_resource_exhausted: all attempted models failed (${attempted}). Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
            );
          }
        } else {
          throw err;
        }
      }

      // -----------------------------------------------------------------------
      // 7b. Log response time (Req 7.2)
      // -----------------------------------------------------------------------
      const responseTimeMs = Date.now() - invocationStart;
      process.stderr.write(
        `[ollama-mcp-bridge] query_local_model completed | model=${usedModel} | responseTime=${responseTimeMs}ms\n`
      );

      // -----------------------------------------------------------------------
      // 7c. Append reduction record (Req 12.1, 12.2)
      // -----------------------------------------------------------------------
      const outputTokens = estimateTokens(chunkResult!.finalResponse);
      const reductionRatio =
        tokenEstimate > 0 ? outputTokens / tokenEstimate : 0;

      const record = {
        timestamp: new Date().toISOString(),
        tool: "query_local_model",
        model: usedModel,
        inputTokens: tokenEstimate,
        outputTokens,
        reductionRatio,
        taskType,
        chunked: chunkResult!.wasChunked,
        ...(config.logLevel === "debug"
          ? {
              inputPreview: fullPayload.slice(0, 200),
              outputPreview: chunkResult!.finalResponse.slice(0, 200),
            }
          : {}),
      };
      reductionLogger.append(record);

      // -----------------------------------------------------------------------
      // 7d. Build final response text (Req 17.6)
      // -----------------------------------------------------------------------
      const responseText = fallbackWarning
        ? `${fallbackWarning}\n${chunkResult!.finalResponse}`
        : chunkResult!.finalResponse;

      return responseText;
    }, config.requestTimeoutMs);

    // -----------------------------------------------------------------------
    // 8. Return MCP response (Req 1.4)
    // -----------------------------------------------------------------------
    return {
      content: [{ type: "text" as const, text: response }],
    };
  };
}
