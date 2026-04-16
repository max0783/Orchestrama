/**
 * MCP server entry point for ollama-mcp-bridge.
 *
 * Bootstraps the MCP server with stdio transport, registers only the two
 * query tools (query_local_model and ping_model), loads configuration, and
 * optionally pre-loads the default model on start.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2, 6.4, 6.5, 13.5
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { OllamaClient } from "./ollama/client.js";
import { FileReader, loadIgnoreRules } from "./files/reader.js";
import { Chunker } from "./chunking/index.js";
import { CapabilityRouter } from "./routing/capability_map.js";
import { SystemPromptInjector } from "./prompts/system_prompt.js";
import { RequestQueue } from "./queue/request_queue.js";
import { ReductionLogger } from "./logging/reduction_logger.js";
import { ProgressNotifier } from "./notifications/progress.js";
import { createQueryHandler } from "./tools/query.js";
import { createPingHandler } from "./tools/ping.js";
// ---------------------------------------------------------------------------
// Tool definitions (ListTools response)
// ---------------------------------------------------------------------------
const TOOL_DEFINITIONS = [
    {
        name: "query_local_model",
        description: "Send a prompt to a local Ollama model, optionally with context files. Supports Map-Reduce chunking for large payloads.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "The prompt to send to the local model" },
                model: { type: "string", description: "Override the model to use (optional)" },
                context_files: {
                    type: "array",
                    items: { type: "string" },
                    description: "File or directory paths to include as context (optional)",
                },
                system_prompt: {
                    type: "string",
                    description: "Override the system prompt for this invocation (optional)",
                },
            },
            required: ["prompt"],
        },
    },
    {
        name: "ping_model",
        description: "Ping a local Ollama model to check its load status (warm/cold) and measure round-trip response time.",
        inputSchema: {
            type: "object",
            properties: {
                model: { type: "string", description: "Model to ping (defaults to the configured default model)" },
            },
        },
    },
];
// ---------------------------------------------------------------------------
// Main bootstrap
// ---------------------------------------------------------------------------
async function main() {
    // 1. Load configuration from environment variables
    const config = loadConfig();
    // 2. Create module instances
    const ollamaClient = new OllamaClient(config.ollamaBaseUrl, config.keepAlive);
    const fileReader = new FileReader(config.allowedDirs);
    const chunker = new Chunker(ollamaClient.generate.bind(ollamaClient));
    const capabilityRouter = new CapabilityRouter(config.capabilityMap, config.defaultModel);
    const systemPromptInjector = new SystemPromptInjector(config.systemPrompt);
    const requestQueue = new RequestQueue(config.numParallel, config.queueMaxSize);
    const reductionLogger = new ReductionLogger(config.reductionLogPath);
    const ignoreRules = await loadIgnoreRules(process.cwd());
    // 3. Create MCP Server instance
    const server = new Server({ name: "ollama-mcp-bridge", version: "0.1.0" }, { capabilities: { tools: {} } });
    // 4. Create ProgressNotifier wrapping the server's notification API
    const progressNotifier = new ProgressNotifier((notification) => {
        server.notification(notification).catch(() => { });
    }, config.disableProgress);
    // 5. Register tool handlers
    // 5a. ListTools — return all tool definitions
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOL_DEFINITIONS };
    });
    // 5b. CallTool — dispatch to the appropriate handler
    const queryHandler = createQueryHandler({
        config,
        ollamaClient,
        fileReader,
        chunker,
        capabilityRouter,
        systemPromptInjector,
        requestQueue,
        reductionLogger,
        progressNotifier,
        ignoreRules,
    });
    const pingHandler = createPingHandler(ollamaClient, config.defaultModel);
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        switch (name) {
            case "query_local_model":
                return queryHandler(args);
            case "ping_model":
                return pingHandler(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
    });
    // 6. Log startup message to stderr (Req 6.1, 6.2)
    process.stderr.write(`ollama-mcp-bridge started. Default model: ${config.defaultModel}. Ollama URL: ${config.ollamaBaseUrl}\n`);
    // 7. Optionally pre-load the default model (Req 13.5)
    if (config.keepAliveOnStart) {
        process.stderr.write(`[ollama-mcp-bridge] BRIDGE_KEEPALIVE_ON_START=true — pinging default model: ${config.defaultModel}\n`);
        try {
            const pingResult = await ollamaClient.ping(config.defaultModel);
            process.stderr.write(`[ollama-mcp-bridge] Model ${config.defaultModel} pre-loaded (${pingResult.loaded ? "warm" : "cold"}, ${pingResult.responseTimeMs}ms)\n`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[ollama-mcp-bridge] WARNING: Failed to pre-load model ${config.defaultModel}: ${msg}\n`);
            // Non-fatal — continue starting the server
        }
    }
    // 8. Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    process.stderr.write(`[ollama-mcp-bridge] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=server.js.map