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
import type { BridgeConfig } from "../types.js";
import type { IOllamaClient } from "../ollama/client.js";
import type { IFileReader, IgnoreInstance } from "../files/reader.js";
import type { Chunker } from "../chunking/index.js";
import type { CapabilityRouter } from "../routing/capability_map.js";
import type { SystemPromptInjector } from "../prompts/system_prompt.js";
import type { RequestQueue } from "../queue/request_queue.js";
import type { IReductionLogger } from "../logging/reduction_logger.js";
import type { ProgressNotifier } from "../notifications/progress.js";
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
    ignoreRules?: IgnoreInstance;
}
export declare function createQueryHandler(deps: QueryHandlerDeps): (args: unknown) => Promise<{
    content: Array<{
        type: "text";
        text: string;
    }>;
}>;
//# sourceMappingURL=query.d.ts.map