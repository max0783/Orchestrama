/**
 * Derives bridge-side context limits from the selected model context window.
 *
 * The advisor benchmarks a safe Ollama context window, but query_local_model
 * also enforces separate file-count and file-token guards. These guards should
 * scale with the chosen window so a 128k-capable model can actually receive
 * large file context through the MCP.
 */

import {
  DEFAULT_MAX_CONTEXT_FILES,
  DEFAULT_MAX_FILE_TOKENS,
  DEFAULT_MAX_TOTAL_CONTEXT_TOKENS,
} from "../config.js";
import type { BridgeConfig } from "../types.js";

export interface SuggestedBridgeContextLimits {
  maxContextFiles: number;
  maxFileTokens: number;
  maxTotalContextTokens: number;
}

export function suggestBridgeContextLimits(
  contextWindow: number
): SuggestedBridgeContextLimits {
  const safeContextWindow = Math.max(1, Math.floor(contextWindow));

  const maxTotalContextTokens = Math.max(
    DEFAULT_MAX_TOTAL_CONTEXT_TOKENS,
    Math.floor(safeContextWindow * 0.75)
  );
  const maxFileTokens = Math.max(
    DEFAULT_MAX_FILE_TOKENS,
    Math.min(maxTotalContextTokens, Math.floor(safeContextWindow * 0.25))
  );
  const maxContextFiles = Math.max(
    DEFAULT_MAX_CONTEXT_FILES,
    Math.min(200, Math.ceil(safeContextWindow / 2048))
  );

  return {
    maxContextFiles,
    maxFileTokens,
    maxTotalContextTokens,
  };
}

export function applySuggestedBridgeContextLimits(
  config: BridgeConfig,
  contextWindow: number
): SuggestedBridgeContextLimits {
  const suggestedLimits = suggestBridgeContextLimits(contextWindow);

  config.maxContextFiles = suggestedLimits.maxContextFiles;
  config.maxFileTokens = suggestedLimits.maxFileTokens;
  config.maxTotalContextTokens = suggestedLimits.maxTotalContextTokens;

  process.env["BRIDGE_MAX_CONTEXT_FILES"] = String(suggestedLimits.maxContextFiles);
  process.env["BRIDGE_MAX_FILE_TOKENS"] = String(suggestedLimits.maxFileTokens);
  process.env["BRIDGE_MAX_TOTAL_CONTEXT_TOKENS"] = String(
    suggestedLimits.maxTotalContextTokens
  );

  return suggestedLimits;
}
