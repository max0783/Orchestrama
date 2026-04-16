/**
 * MCP tool definitions for the ollama-mcp-bridge server.
 *
 * Extracted to a separate module so that tests can import the tool list
 * without triggering the side-effectful `main()` call in server.ts.
 *
 * Requirements: 1.1, 1.2, 1.4
 */

export const TOOL_DEFINITIONS = [
  {
    name: "query_local_model",
    description:
      "Send a prompt to a local Ollama model, optionally with context files. Supports Map-Reduce chunking for large payloads.",
    inputSchema: {
      type: "object" as const,
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
    description:
      "Ping a local Ollama model to check its load status (warm/cold) and measure round-trip response time.",
    inputSchema: {
      type: "object" as const,
      properties: {
        model: { type: "string", description: "Model to ping (defaults to the configured default model)" },
      },
    },
  },
];
