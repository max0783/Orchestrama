import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../config.js";
describe("loadConfig", () => {
    let savedEnv;
    beforeEach(() => {
        savedEnv = { ...process.env };
        // Clear all relevant env vars before each test
        const keys = [
            "OLLAMA_BASE_URL",
            "OLLAMA_DEFAULT_MODEL",
            "OLLAMA_CONTEXT_WINDOW",
            "OLLAMA_KEEP_ALIVE",
            "OLLAMA_NUM_PARALLEL",
            "BRIDGE_ALLOWED_DIRS",
            "BRIDGE_SYSTEM_PROMPT",
            "BRIDGE_CAPABILITY_MAP",
            "BRIDGE_FALLBACK_MODELS",
            "BRIDGE_QUEUE_MAX_SIZE",
            "BRIDGE_REQUEST_TIMEOUT_MS",
            "BRIDGE_REDUCTION_LOG",
            "BRIDGE_LOG_LEVEL",
            "BRIDGE_DISABLE_PROGRESS",
            "BRIDGE_KEEPALIVE_ON_START",
            "BENCHMARK_OUTPUT_FILE",
        ];
        for (const key of keys) {
            delete process.env[key];
        }
    });
    afterEach(() => {
        process.env = savedEnv;
    });
    // 1. Returns all defaults when no env vars are set
    it("returns all defaults when no env vars are set", () => {
        const config = loadConfig();
        expect(config.ollamaBaseUrl).toBe("http://localhost:11434");
        expect(config.defaultModel).toBe("llama3.1:8b");
        expect(config.contextWindow).toBe(4096);
        expect(config.keepAlive).toBe("10m");
        expect(config.numParallel).toBe(1);
        expect(config.allowedDirs).toEqual([process.cwd()]);
        expect(config.systemPrompt).toBe("");
        expect(config.capabilityMap).toEqual({});
        expect(config.fallbackModels).toEqual([]);
        expect(config.queueMaxSize).toBe(10);
        expect(config.requestTimeoutMs).toBe(300000);
        expect(config.reductionLogPath).toBe("./ollama-bridge-reductions.jsonl");
        expect(config.logLevel).toBe("info");
        expect(config.disableProgress).toBe(false);
        expect(config.keepAliveOnStart).toBe(false);
        expect(config.benchmarkOutputFile).toBeUndefined();
    });
    // 2. Reads OLLAMA_BASE_URL override
    it("reads OLLAMA_BASE_URL override", () => {
        process.env["OLLAMA_BASE_URL"] = "http://myhost:9999";
        expect(loadConfig().ollamaBaseUrl).toBe("http://myhost:9999");
    });
    // 3. Reads OLLAMA_DEFAULT_MODEL override
    it("reads OLLAMA_DEFAULT_MODEL override", () => {
        process.env["OLLAMA_DEFAULT_MODEL"] = "mistral";
        expect(loadConfig().defaultModel).toBe("mistral");
    });
    // 4. Reads OLLAMA_CONTEXT_WINDOW as number
    it("reads OLLAMA_CONTEXT_WINDOW as number", () => {
        process.env["OLLAMA_CONTEXT_WINDOW"] = "8192";
        expect(loadConfig().contextWindow).toBe(8192);
    });
    // 5. Reads OLLAMA_KEEP_ALIVE override
    it("reads OLLAMA_KEEP_ALIVE override", () => {
        process.env["OLLAMA_KEEP_ALIVE"] = "30m";
        expect(loadConfig().keepAlive).toBe("30m");
    });
    // 6. Reads OLLAMA_NUM_PARALLEL as number
    it("reads OLLAMA_NUM_PARALLEL as number", () => {
        process.env["OLLAMA_NUM_PARALLEL"] = "4";
        expect(loadConfig().numParallel).toBe(4);
    });
    // 7. Reads BRIDGE_ALLOWED_DIRS as comma-separated array
    it("reads BRIDGE_ALLOWED_DIRS as comma-separated array", () => {
        process.env["BRIDGE_ALLOWED_DIRS"] = "/tmp/a, /tmp/b, /tmp/c";
        expect(loadConfig().allowedDirs).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
    });
    // 8. Reads BRIDGE_SYSTEM_PROMPT override
    it("reads BRIDGE_SYSTEM_PROMPT override", () => {
        process.env["BRIDGE_SYSTEM_PROMPT"] = "You are a helpful assistant.";
        expect(loadConfig().systemPrompt).toBe("You are a helpful assistant.");
    });
    // 9. Parses valid BRIDGE_CAPABILITY_MAP JSON
    it("parses valid BRIDGE_CAPABILITY_MAP JSON", () => {
        process.env["BRIDGE_CAPABILITY_MAP"] = JSON.stringify({ code: "codellama", logs: "mistral" });
        expect(loadConfig().capabilityMap).toEqual({ code: "codellama", logs: "mistral" });
    });
    // 10. Falls back to {} on invalid JSON BRIDGE_CAPABILITY_MAP (logs to stderr, does NOT exit)
    it("falls back to {} on invalid JSON BRIDGE_CAPABILITY_MAP and logs to stderr", () => {
        process.env["BRIDGE_CAPABILITY_MAP"] = "not-valid-json{{{";
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { }));
        const config = loadConfig();
        expect(config.capabilityMap).toEqual({});
        expect(stderrSpy).toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
    });
    // 11. Reads BRIDGE_FALLBACK_MODELS as comma-separated array
    it("reads BRIDGE_FALLBACK_MODELS as comma-separated array", () => {
        process.env["BRIDGE_FALLBACK_MODELS"] = "mistral, phi3, gemma";
        expect(loadConfig().fallbackModels).toEqual(["mistral", "phi3", "gemma"]);
    });
    // 12. Reads BRIDGE_QUEUE_MAX_SIZE as number
    it("reads BRIDGE_QUEUE_MAX_SIZE as number", () => {
        process.env["BRIDGE_QUEUE_MAX_SIZE"] = "20";
        expect(loadConfig().queueMaxSize).toBe(20);
    });
    // 13. Reads BRIDGE_REQUEST_TIMEOUT_MS as number
    it("reads BRIDGE_REQUEST_TIMEOUT_MS as number", () => {
        process.env["BRIDGE_REQUEST_TIMEOUT_MS"] = "60000";
        expect(loadConfig().requestTimeoutMs).toBe(60000);
    });
    // 14. Reads BRIDGE_REDUCTION_LOG override
    it("reads BRIDGE_REDUCTION_LOG override", () => {
        process.env["BRIDGE_REDUCTION_LOG"] = "/var/log/reductions.jsonl";
        expect(loadConfig().reductionLogPath).toBe("/var/log/reductions.jsonl");
    });
    // 15. Reads BRIDGE_LOG_LEVEL "debug"
    it('reads BRIDGE_LOG_LEVEL "debug"', () => {
        process.env["BRIDGE_LOG_LEVEL"] = "debug";
        expect(loadConfig().logLevel).toBe("debug");
    });
    // 16. Reads BRIDGE_DISABLE_PROGRESS "true" as boolean
    it('reads BRIDGE_DISABLE_PROGRESS "true" as boolean true', () => {
        process.env["BRIDGE_DISABLE_PROGRESS"] = "true";
        expect(loadConfig().disableProgress).toBe(true);
    });
    // 17. Reads BRIDGE_KEEPALIVE_ON_START "true" as boolean
    it('reads BRIDGE_KEEPALIVE_ON_START "true" as boolean true', () => {
        process.env["BRIDGE_KEEPALIVE_ON_START"] = "true";
        expect(loadConfig().keepAliveOnStart).toBe(true);
    });
    // 18. Reads BENCHMARK_OUTPUT_FILE
    it("reads BENCHMARK_OUTPUT_FILE", () => {
        process.env["BENCHMARK_OUTPUT_FILE"] = "/tmp/bench.json";
        expect(loadConfig().benchmarkOutputFile).toBe("/tmp/bench.json");
    });
    // 19. Calls process.exit(1) on invalid (NaN) OLLAMA_CONTEXT_WINDOW
    it("calls process.exit(1) on invalid OLLAMA_CONTEXT_WINDOW", () => {
        process.env["OLLAMA_CONTEXT_WINDOW"] = "not-a-number";
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { }));
        loadConfig();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stderrSpy).toHaveBeenCalled();
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
    });
    // 20. Calls process.exit(1) on non-positive OLLAMA_NUM_PARALLEL (e.g. "0")
    it("calls process.exit(1) on non-positive OLLAMA_NUM_PARALLEL", () => {
        process.env["OLLAMA_NUM_PARALLEL"] = "0";
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { }));
        loadConfig();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stderrSpy).toHaveBeenCalled();
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
    });
    // 21. Calls process.exit(1) on invalid BRIDGE_QUEUE_MAX_SIZE
    it("calls process.exit(1) on invalid BRIDGE_QUEUE_MAX_SIZE", () => {
        process.env["BRIDGE_QUEUE_MAX_SIZE"] = "abc";
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { }));
        loadConfig();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stderrSpy).toHaveBeenCalled();
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
    });
    // 22. Calls process.exit(1) on invalid BRIDGE_REQUEST_TIMEOUT_MS
    it("calls process.exit(1) on invalid BRIDGE_REQUEST_TIMEOUT_MS", () => {
        process.env["BRIDGE_REQUEST_TIMEOUT_MS"] = "-500";
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { }));
        loadConfig();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stderrSpy).toHaveBeenCalled();
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
    });
});
//# sourceMappingURL=config.test.js.map