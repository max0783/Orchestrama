import { describe, expect, it, vi } from "vitest";
import { createRunCommandHandler } from "../../tools/run_command.js";
import { CapabilityRouter } from "../../routing/capability_map.js";
import { RequestQueue } from "../../queue/request_queue.js";
import { PathValidator } from "../../security/path_validator.js";
import { SessionRegistry } from "../../session/registry.js";
import type { BridgeConfig } from "../../types.js";
import type { IOllamaClient } from "../../ollama/client.js";

function createConfig(): BridgeConfig {
  return {
    ollamaBaseUrl: "http://localhost:11434",
    defaultModel: "llama3",
    contextWindow: 4096,
    keepAlive: "10m",
    keepAliveOnStart: false,
    allowedDirs: [process.cwd()],
    allowedDirsExplicit: false,
    systemPrompt: "",
    capabilityMap: {},
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 30_000,
    reductionLogPath: "./test-reductions.jsonl",
    logLevel: "info",
    disableProgress: true,
  };
}

describe("run_command handler", () => {
  it("returns raw output without calling Ollama when interpret=false", async () => {
    const generate = vi.fn();
    const handler = createRunCommandHandler({
      config: createConfig(),
      ollamaClient: { generate } as unknown as IOllamaClient,
      capabilityRouter: new CapabilityRouter({}, "llama3"),
      requestQueue: new RequestQueue(1, 10),
      pathValidator: new PathValidator([process.cwd()], new SessionRegistry()),
      sessionId: "test",
    });

    const result = await handler({
      prompt: "Return raw node version",
      command: "node --version",
      interpret: false,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Exit code: 0");
    expect(result.content[0].text).toContain("v");
  });
});
