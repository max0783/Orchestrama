// Feature: orchestrama, Property 13: Reduction record completeness
// For any completed query_local_model invocation (with mocked Ollama), the
// reduction log should contain exactly one new record with all required fields:
// timestamp, tool, model, inputTokens, outputTokens, reductionRatio, taskType,
// chunked.
//
// **Validates: Requirements 12.1, 12.2**

import { describe, it, expect, afterEach } from "vitest";
import * as fc from "fast-check";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import { ReductionLogger } from "../../logging/reduction_logger.js";
import type { ReductionRecord } from "../../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a unique temp file path for each test run. */
function tempLogPath(): string {
  return path.join(os.tmpdir(), `reduction_test_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
}

/** Waits long enough for the setImmediate-scheduled write to complete. */
function waitForWrite(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Cleans up a temp file if it exists. */
function cleanup(filePath: string): void {
  try {
    fsSync.unlinkSync(filePath);
  } catch {
    // ignore — file may not exist
  }
}

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Generates a valid ISO 8601 timestamp string. */
const arbTimestamp = fc.date().map((d) => d.toISOString());

/** Generates a non-empty string suitable for identifiers. */
const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 50 });

/** Generates a non-negative integer token count. */
const arbTokenCount = fc.integer({ min: 0, max: 100_000 });

/** Generates a valid reduction ratio (0 to 1 inclusive). */
const arbReductionRatio = fc.float({ min: 0, max: 1, noNaN: true });

/** Generates a complete, valid ReductionRecord. */
const arbReductionRecord: fc.Arbitrary<ReductionRecord> = fc.record({
  timestamp: arbTimestamp,
  tool: arbNonEmptyString,
  model: arbNonEmptyString,
  inputTokens: arbTokenCount,
  outputTokens: arbTokenCount,
  reductionRatio: arbReductionRatio,
  taskType: fc.constantFrom("code_review", "log_analysis", "summarization", "generic"),
  chunked: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property 13: Reduction record completeness
// ---------------------------------------------------------------------------

describe("Property 13: Reduction record completeness", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    // Clean up all temp files created during this test
    for (const f of tempFiles) {
      cleanup(f);
    }
    tempFiles.length = 0;
  });

  it(
    "appended record appears in the log with all required fields intact",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbReductionRecord, async (record) => {
          const logPath = tempLogPath();
          tempFiles.push(logPath);

          const logger = new ReductionLogger(logPath);

          // Capture stats before the append to detect exactly one new record
          const statsBefore = await logger.readStats();
          const countBefore = statsBefore.totalInvocations;

          // Fire-and-forget append
          logger.append(record);

          // Wait for the setImmediate-scheduled write to complete
          await waitForWrite();

          // Read stats after the append
          const statsAfter = await logger.readStats();

          // Exactly one new record should have been added
          expect(statsAfter.totalInvocations).toBe(countBefore + 1);

          // Read the raw JSONL file to verify all required fields are present
          const raw = fsSync.readFileSync(logPath, "utf-8");
          const lines = raw.split("\n").filter((l) => l.trim() !== "");

          // The last line is the record we just appended
          const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;

          // All required fields must be present
          expect(typeof parsed.timestamp).toBe("string");
          expect(typeof parsed.tool).toBe("string");
          expect(typeof parsed.model).toBe("string");
          expect(typeof parsed.inputTokens).toBe("number");
          expect(typeof parsed.outputTokens).toBe("number");
          expect(typeof parsed.reductionRatio).toBe("number");
          expect(typeof parsed.taskType).toBe("string");
          expect(typeof parsed.chunked).toBe("boolean");

          // Values must match what was passed in
          expect(parsed.timestamp).toBe(record.timestamp);
          expect(parsed.tool).toBe(record.tool);
          expect(parsed.model).toBe(record.model);
          expect(parsed.inputTokens).toBe(record.inputTokens);
          expect(parsed.outputTokens).toBe(record.outputTokens);
          expect(parsed.reductionRatio).toBe(record.reductionRatio);
          expect(parsed.taskType).toBe(record.taskType);
          expect(parsed.chunked).toBe(record.chunked);
        }),
        { numRuns: 100 }
      );
    },
    // Allow enough time for 100 runs × 50 ms wait each
    15_000
  );
});
