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
import type { Chunker } from "../chunking/index.js";
import type { RequestQueue } from "../queue/request_queue.js";
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
export interface TestConfigDeps {
    ollamaClient: IOllamaClient;
    chunker: Chunker;
    requestQueue: RequestQueue;
    defaultModel: string;
    contextWindow: number;
}
export declare function createTestConfigHandler(deps: TestConfigDeps): (args: unknown) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=test_config.d.ts.map