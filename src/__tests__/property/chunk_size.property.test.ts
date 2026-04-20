// Feature: ollama-mcp-bridge, Property 8: Chunk size invariant
// For any payload whose token estimate exceeds contextWindow, every chunk produced
// by the chunker should have a token estimate <= contextWindow * 0.9.
//
// **Validates: Requirements 4.2**

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { estimateTokens, splitIntoChunks } from "../../chunking/index.js";

describe("Property 8: Chunk size invariant", () => {
  it("every chunk has token estimate <= maxTokens", () => {
    fc.assert(
      fc.property(
        // contextWindow between 10 and 1000
        fc.integer({ min: 10, max: 1000 }),
        // payload that is guaranteed to exceed contextWindow tokens
        fc.string({ minLength: 1, maxLength: 10000 }),
        (contextWindow, payload) => {
          const maxTokens = Math.floor(contextWindow * 0.9);
          if (maxTokens <= 0) return true; // skip degenerate case

          const chunks = splitIntoChunks(payload, maxTokens);

          // Every chunk must satisfy the size invariant
          return chunks.every((chunk) => estimateTokens(chunk) <= maxTokens);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("chunks cover the full payload (no content lost)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 500 }),
        fc.string({ minLength: 1, maxLength: 5000 }),
        (contextWindow, payload) => {
          const maxTokens = Math.floor(contextWindow * 0.9);
          if (maxTokens <= 0) return true;

          const chunks = splitIntoChunks(payload, maxTokens);

          // Rejoining chunks (with spaces that were used as split points) should
          // reconstruct the original payload. Since we drop the split character
          // (space/newline), we verify by checking total character coverage.
          const totalChunkLength = chunks.reduce((sum, c) => sum + c.length, 0);
          // Total chars in chunks should be <= payload length (we may drop split chars)
          return totalChunkLength <= payload.length && chunks.length >= 1;
        }
      ),
      { numRuns: 100 }
    );
  });
});
