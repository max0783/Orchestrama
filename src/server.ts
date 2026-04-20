/**
 * MCP server entry point for ollama-mcp-bridge.
 *
 * Bootstraps the MCP server with stdio transport, registers all bridge tools,
 * loads configuration, and optionally pre-loads the default model on start.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2, 6.4, 6.5, 13.5
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { OllamaClient } from "./ollama/client.js";
import { FileReader, loadIgnoreRules } from "./files/reader.js";
import { Chunker } from "./chunking/index.js";
import { CapabilityRouter } from "./routing/capability_map.js";
import { SystemPromptInjector } from "./prompts/system_prompt.js";
import { RequestQueue } from "./queue/request_queue.js";
import { ReductionLogger } from "./logging/reduction_logger.js";
import { ProgressNotifier } from "./notifications/progress.js";
import { PatternRegistry } from "./patterns/registry.js";
import { IntentDispatcher } from "./patterns/dispatcher.js";
import { SessionRegistry } from "./session/registry.js";
import { PathValidator } from "./security/path_validator.js";

import { createQueryHandler } from "./tools/query.js";
import { createPingHandler } from "./tools/ping.js";
import { createListPatternsHandler } from "./tools/list_patterns.js";
import { createRegisterPatternHandler } from "./tools/register_pattern.js";
import { createGetBridgeLimitsHandler } from "./tools/get_bridge_limits.js";
import { createSetupBridgeHandler } from "./tools/setup_bridge.js";
import { SetupTool } from "./tools/setup_bridge_tool.js";
import { createRunCommandHandler } from "./tools/run_command.js";
import { createDeclareWorkingDirsHandler } from "./tools/declare_working_dirs.js";
import { TOOL_DEFINITIONS } from "./server_tools.js";

// ---------------------------------------------------------------------------
// Main bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Load configuration from environment variables
  const config = loadConfig();

  // 2. Create module instances
  const ollamaClient = new OllamaClient(config.ollamaBaseUrl, config.keepAlive);
  
  // 2a. Create SessionRegistry and PathValidator
  const sessionRegistry = new SessionRegistry();
  const pathValidator = new PathValidator(config.allowedDirs, sessionRegistry);
  const SESSION_ID = "default";
  
  const fileReader = new FileReader(pathValidator, SESSION_ID);
  const chunker = new Chunker(ollamaClient.generate.bind(ollamaClient));
  const capabilityRouter = new CapabilityRouter(config.capabilityMap, config.defaultModel);
  const systemPromptInjector = new SystemPromptInjector(config.systemPrompt);
  const requestQueue = new RequestQueue(config.numParallel, config.queueMaxSize);
  const reductionLogger = new ReductionLogger(config.reductionLogPath);
  const ignoreRules = await loadIgnoreRules(process.cwd());

  // 2a. Create PatternRegistry and IntentDispatcher
  const patternRegistry = new PatternRegistry({
    patternsFilePath: config.patternsFilePath,
    ollamaClient,
    defaultModel: config.defaultModel,
  });
  await patternRegistry.loadFromFile();
  const intentDispatcher = new IntentDispatcher(patternRegistry);

  // 2b. Create SetupTool
  const setupTool = new SetupTool({
    registry: patternRegistry,
    ollamaClient,
    config,
  });

  // 3. Create MCP Server instance
  const server = new Server(
    { name: "ollama-mcp-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // 4. Create ProgressNotifier wrapping the server's notification API
  const progressNotifier = new ProgressNotifier(
    (notification) => {
      server.notification(notification).catch(() => {});
    },
    config.disableProgress
  );

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
    intentDispatcher,
    ignoreRules,
  });

  const pingHandler = createPingHandler(ollamaClient, config.defaultModel);
  const listPatternsHandler = createListPatternsHandler(patternRegistry);
  const registerPatternHandler = createRegisterPatternHandler(patternRegistry);
  const getBridgeLimitsHandler = createGetBridgeLimitsHandler(config, sessionRegistry, SESSION_ID);
  const setupBridgeHandler = createSetupBridgeHandler(setupTool);
  const runCommandHandler = createRunCommandHandler({
    config,
    ollamaClient,
    capabilityRouter,
    requestQueue,
    pathValidator,
    sessionId: SESSION_ID,
  });
  const declareWorkingDirsHandler = createDeclareWorkingDirsHandler({
    config,
    registry: sessionRegistry,
    sessionId: SESSION_ID,
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "query_local_model":
        return queryHandler(args);
      case "ping_model":
        return pingHandler(args);
      case "list_patterns":
        return listPatternsHandler(args);
      case "register_pattern":
        return registerPatternHandler(args);
      case "get_bridge_limits":
        return getBridgeLimitsHandler(args);
      case "setup_bridge":
        return setupBridgeHandler(args);
      case "run_command":
        return runCommandHandler(args);
      case "declare_working_dirs":
        return declareWorkingDirsHandler(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  });

  // 6. Log startup message to stderr (Req 6.1, 6.2)
  process.stderr.write(
    `ollama-mcp-bridge started. Default model: ${config.defaultModel}. Ollama URL: ${config.ollamaBaseUrl}\n`
  );

  // 7. Optionally pre-load the default model (Req 13.5)
  if (config.keepAliveOnStart) {
    process.stderr.write(
      `[ollama-mcp-bridge] BRIDGE_KEEPALIVE_ON_START=true — pinging default model: ${config.defaultModel}\n`
    );
    try {
      const pingResult = await ollamaClient.ping(config.defaultModel);
      process.stderr.write(
        `[ollama-mcp-bridge] Model ${config.defaultModel} pre-loaded (${pingResult.loaded ? "warm" : "cold"}, ${pingResult.responseTimeMs}ms)\n`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[ollama-mcp-bridge] WARNING: Failed to pre-load model ${config.defaultModel}: ${msg}\n`
      );
      // Non-fatal — continue starting the server
    }
  }

  // 8. Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(
    `[ollama-mcp-bridge] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
