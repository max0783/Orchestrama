/**
 * query_local_model tool handler.
 *
 * Validates input, resolves model, builds system prompt, reads context files,
 * estimates tokens, enqueues the request, processes via Chunker (with OOM
 * fallback), appends a reduction record, and returns the response.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2, 7.3, 7.4, 11.9,
 *               17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { estimateTokens } from "../chunking/index.js";
import { OllamaError } from "../ollama/client.js";
function validateInput(args) {
    if (typeof args !== "object" || args === null) {
        throw new McpError(ErrorCode.InvalidParams, "Arguments must be an object");
    }
    const a = args;
    // prompt — required string
    if (typeof a["prompt"] !== "string") {
        throw new McpError(ErrorCode.InvalidParams, `"prompt" must be a string, got ${typeof a["prompt"]}`);
    }
    // model — optional string
    if (a["model"] !== undefined && typeof a["model"] !== "string") {
        throw new McpError(ErrorCode.InvalidParams, `"model" must be a string, got ${typeof a["model"]}`);
    }
    // context_files — optional array of strings
    if (a["context_files"] !== undefined) {
        if (!Array.isArray(a["context_files"])) {
            throw new McpError(ErrorCode.InvalidParams, `"context_files" must be an array, got ${typeof a["context_files"]}`);
        }
        for (const item of a["context_files"]) {
            if (typeof item !== "string") {
                throw new McpError(ErrorCode.InvalidParams, `"context_files" must be an array of strings; found element of type ${typeof item}`);
            }
        }
    }
    // system_prompt — optional string
    if (a["system_prompt"] !== undefined && typeof a["system_prompt"] !== "string") {
        throw new McpError(ErrorCode.InvalidParams, `"system_prompt" must be a string, got ${typeof a["system_prompt"]}`);
    }
    return {
        prompt: a["prompt"],
        model: a["model"],
        context_files: a["context_files"] ?? [],
        system_prompt: a["system_prompt"],
    };
}
// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------
export function createQueryHandler(deps) {
    const { config, fileReader, chunker, capabilityRouter, systemPromptInjector, requestQueue, reductionLogger, progressNotifier, ignoreRules, } = deps;
    return async (args) => {
        // -----------------------------------------------------------------------
        // 1. Validate input
        // -----------------------------------------------------------------------
        const { prompt, model: explicitModel, context_files, system_prompt } = validateInput(args);
        // -----------------------------------------------------------------------
        // 2. Resolve model
        // -----------------------------------------------------------------------
        const resolvedModel = capabilityRouter.resolveModel(prompt, explicitModel);
        // -----------------------------------------------------------------------
        // 3. Detect task type and build system prompt
        // -----------------------------------------------------------------------
        const taskType = systemPromptInjector.detect(prompt);
        const systemPrompt = systemPromptInjector.build(taskType, system_prompt);
        // -----------------------------------------------------------------------
        // 4. Read context files (if any) and send per-file progress notifications
        // -----------------------------------------------------------------------
        let filePayload = "";
        let fileCount = 0;
        if (context_files.length > 0) {
            const results = await fileReader.readContextFiles(context_files, ignoreRules);
            fileCount = results.length;
            // Send a progress notification for each file read (Req 15.5)
            for (const result of results) {
                progressNotifier.fileRead(result.path, result.tokenEstimate);
            }
            filePayload = fileReader.formatForPayload(results);
        }
        // -----------------------------------------------------------------------
        // 5. Build full payload and estimate tokens (Req 11.9)
        // -----------------------------------------------------------------------
        const fullPayload = filePayload.length > 0 ? `${filePayload}\n\n${prompt}` : prompt;
        const systemPromptTokens = estimateTokens(systemPrompt);
        const tokenEstimate = estimateTokens(fullPayload + systemPrompt);
        // -----------------------------------------------------------------------
        // 6. Log invocation details to stderr (Req 7.1)
        // -----------------------------------------------------------------------
        process.stderr.write(`[ollama-mcp-bridge] query_local_model | model=${resolvedModel} | files=${fileCount} | tokens=${tokenEstimate}\n`);
        // -----------------------------------------------------------------------
        // 7. Enqueue and process (Req 18.x)
        // -----------------------------------------------------------------------
        const invocationStart = Date.now();
        const response = await requestQueue.enqueue(async () => {
            // Send "started" progress notification (Req 15.2)
            const estimatedChunks = Math.ceil(tokenEstimate / Math.max(1, Math.floor(config.contextWindow * 0.9)));
            progressNotifier.started(Math.max(1, estimatedChunks));
            // -----------------------------------------------------------------------
            // 7a. Process via Chunker — with OOM fallback chain (Req 17)
            // -----------------------------------------------------------------------
            let chunkResult;
            let usedModel = resolvedModel;
            let fallbackWarning = null;
            const tryProcess = async (model) => {
                return chunker.process(fullPayload, systemPrompt, {
                    contextWindow: config.contextWindow,
                    systemPromptTokens,
                    model,
                }, (event) => {
                    // Forward chunker progress events to the progress notifier
                    if (event.type === "chunk_done") {
                        progressNotifier.chunkDone(event.index, event.total, event.elapsedMs);
                    }
                    else if (event.type === "reducing") {
                        progressNotifier.reducing(event.summaryCount);
                    }
                    // "started" events from the chunker are informational; we already
                    // sent our own "started" notification above.
                });
            };
            try {
                chunkResult = await tryProcess(resolvedModel);
            }
            catch (err) {
                // Check for OOM / resource exhaustion (Req 17.1)
                if (err instanceof OllamaError &&
                    err.code === "local_resource_exhausted") {
                    // Attempt fallback chain (Req 17.2 – 17.8)
                    if (config.fallbackModels.length === 0) {
                        // No fallbacks configured — re-throw immediately (Req 17.8)
                        throw err;
                    }
                    let lastError = err;
                    let succeeded = false;
                    for (const fallbackModel of config.fallbackModels) {
                        // Skip if same as the model that failed (Req 17.4)
                        if (fallbackModel === resolvedModel) {
                            continue;
                        }
                        // Log the fallback attempt (Req 17.5)
                        process.stderr.write(`[ollama-mcp-bridge] OOM on ${usedModel}, trying fallback: ${fallbackModel}\n`);
                        try {
                            chunkResult = await tryProcess(fallbackModel);
                            usedModel = fallbackModel;
                            // Build fallback warning prefix (Req 17.6)
                            fallbackWarning = `[FALLBACK: ${fallbackModel} used due to resource exhaustion on ${resolvedModel}]`;
                            succeeded = true;
                            break;
                        }
                        catch (fallbackErr) {
                            if (fallbackErr instanceof OllamaError &&
                                fallbackErr.code === "local_resource_exhausted") {
                                lastError = fallbackErr;
                                // Continue to next fallback
                            }
                            else {
                                // Non-OOM error from fallback — propagate immediately
                                throw fallbackErr;
                            }
                        }
                    }
                    if (!succeeded) {
                        // All fallbacks exhausted (Req 17.7)
                        const attempted = [resolvedModel, ...config.fallbackModels].join(", ");
                        throw new McpError(ErrorCode.InternalError, `local_resource_exhausted: all attempted models failed (${attempted}). Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
                    }
                }
                else {
                    throw err;
                }
            }
            // -----------------------------------------------------------------------
            // 7b. Log response time (Req 7.2)
            // -----------------------------------------------------------------------
            const responseTimeMs = Date.now() - invocationStart;
            process.stderr.write(`[ollama-mcp-bridge] query_local_model completed | model=${usedModel} | responseTime=${responseTimeMs}ms\n`);
            // -----------------------------------------------------------------------
            // 7c. Append reduction record (Req 12.1, 12.2)
            // -----------------------------------------------------------------------
            const outputTokens = estimateTokens(chunkResult.finalResponse);
            const reductionRatio = tokenEstimate > 0 ? outputTokens / tokenEstimate : 0;
            const record = {
                timestamp: new Date().toISOString(),
                tool: "query_local_model",
                model: usedModel,
                inputTokens: tokenEstimate,
                outputTokens,
                reductionRatio,
                taskType,
                chunked: chunkResult.wasChunked,
                ...(config.logLevel === "debug"
                    ? {
                        inputPreview: fullPayload.slice(0, 200),
                        outputPreview: chunkResult.finalResponse.slice(0, 200),
                    }
                    : {}),
            };
            reductionLogger.append(record);
            // -----------------------------------------------------------------------
            // 7d. Build final response text (Req 17.6)
            // -----------------------------------------------------------------------
            const responseText = fallbackWarning
                ? `${fallbackWarning}\n${chunkResult.finalResponse}`
                : chunkResult.finalResponse;
            return responseText;
        }, config.requestTimeoutMs);
        // -----------------------------------------------------------------------
        // 8. Return MCP response (Req 1.4)
        // -----------------------------------------------------------------------
        return {
            content: [{ type: "text", text: response }],
        };
    };
}
//# sourceMappingURL=query.js.map