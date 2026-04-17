import {
  DEFAULT_MAX_CONTEXT_FILES,
  DEFAULT_MAX_FILE_TOKENS,
  DEFAULT_MAX_TOTAL_CONTEXT_TOKENS,
} from "../config.js";
import type { BridgeConfig } from "../types.js";

export function createGetBridgeLimitsHandler(config: BridgeConfig) {
  return async (_args: unknown) => {
    const limits = {
      context_window: config.contextWindow,
      max_context_files: config.maxContextFiles ?? DEFAULT_MAX_CONTEXT_FILES,
      max_file_tokens: config.maxFileTokens ?? DEFAULT_MAX_FILE_TOKENS,
      max_total_context_tokens:
        config.maxTotalContextTokens ?? DEFAULT_MAX_TOTAL_CONTEXT_TOKENS,
      allowed_dirs: config.allowedDirs,
    };

    const text = [
      "Bridge limits",
      JSON.stringify(limits, null, 2),
      "Tip: call this before query_local_model when sending context_files.",
    ].join("\n\n");

    return { content: [{ type: "text" as const, text }] };
  };
}
