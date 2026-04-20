/**
 * run_command tool handler.
 *
 * Executes a shell command, captures its output, then sends the output to the
 * local Ollama model along with the caller's prompt and expected_output
 * description. The model interprets and summarises the result.
 *
 * Security: the working directory for command execution is validated against
 * BRIDGE_ALLOWED_DIRS. Commands that attempt to escape via `cd` or absolute
 * paths outside allowed dirs are rejected before execution.
 *
 * Token budget: if the command output + prompt exceeds the context window the
 * tool refuses with a clear error rather than silently chunking or failing.
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { estimateTokens } from "../chunking/index.js";
import type { BridgeConfig } from "../types.js";
import type { IOllamaClient } from "../ollama/client.js";
import type { CapabilityRouter } from "../routing/capability_map.js";
import type { RequestQueue } from "../queue/request_queue.js";
import type { IPathValidator } from "../security/path_validator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on raw command output fed to the model (characters). */
const MAX_OUTPUT_CHARS = 32_000;

/** Timeout for command execution in ms. */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Shell execution helper
// ---------------------------------------------------------------------------

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function execCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // Use shell: true so the caller can pass full shell expressions
    const child = spawn(command, [], {
      shell: true,
      cwd,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: null, timedOut: false });
    });
  });
}

// ---------------------------------------------------------------------------
// Security: validate cwd is within an allowed directory
// (Now handled by PathValidator)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

interface ValidatedInput {
  prompt: string;
  command: string;
  expected_output: string;
  cwd: string;
  model: string | undefined;
}

function validateInput(args: unknown, defaultCwd: string): ValidatedInput {
  if (typeof args !== "object" || args === null) {
    throw new McpError(ErrorCode.InvalidParams, "Arguments must be an object");
  }
  const a = args as Record<string, unknown>;

  if (typeof a["prompt"] !== "string" || a["prompt"].trim() === "") {
    throw new McpError(ErrorCode.InvalidParams, '"prompt" must be a non-empty string');
  }
  if (typeof a["command"] !== "string" || a["command"].trim() === "") {
    throw new McpError(ErrorCode.InvalidParams, '"command" must be a non-empty string');
  }
  if (typeof a["expected_output"] !== "string" || a["expected_output"].trim() === "") {
    throw new McpError(
      ErrorCode.InvalidParams,
      '"expected_output" must be a non-empty string describing what the command output should contain'
    );
  }
  if (a["model"] !== undefined && typeof a["model"] !== "string") {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"model" must be a string, got ${typeof a["model"]}`
    );
  }

  const cwd =
    typeof a["cwd"] === "string" && a["cwd"].trim() !== ""
      ? a["cwd"].trim()
      : defaultCwd;

  return {
    prompt: (a["prompt"] as string).trim(),
    command: (a["command"] as string).trim(),
    expected_output: (a["expected_output"] as string).trim(),
    cwd,
    model: a["model"] as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export interface RunCommandHandlerDeps {
  config: BridgeConfig;
  ollamaClient: IOllamaClient;
  capabilityRouter: CapabilityRouter;
  requestQueue: RequestQueue;
  pathValidator: IPathValidator;
  sessionId: string;
}

export function createRunCommandHandler(deps: RunCommandHandlerDeps) {
  const { config, ollamaClient, capabilityRouter, requestQueue, pathValidator, sessionId } = deps;

  return async (args: unknown) => {
    // -----------------------------------------------------------------------
    // 1. Validate input
    // -----------------------------------------------------------------------
    const { prompt, command, expected_output, cwd, model: explicitModel } =
      validateInput(args, process.cwd());

    // -----------------------------------------------------------------------
    // 2. Security: resolve cwd with fs.realpath, then validate with PathValidator
    // -----------------------------------------------------------------------
    let resolvedCwd: string;
    try {
      resolvedCwd = await fs.realpath(cwd);
    } catch (err) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `SECURITY: cwd "${cwd}" could not be resolved: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    pathValidator.assertCwdAllowed(resolvedCwd, sessionId);

    // -----------------------------------------------------------------------
    // 3. Execute the command
    // -----------------------------------------------------------------------
    process.stderr.write(
      `[ollama-mcp-bridge] run_command | cmd="${command}" | cwd="${resolvedCwd}"\n`
    );

    const execResult = await execCommand(
      command,
      resolvedCwd,
      DEFAULT_COMMAND_TIMEOUT_MS
    );

    if (execResult.timedOut) {
      throw new McpError(
        ErrorCode.InternalError,
        `Command timed out after ${DEFAULT_COMMAND_TIMEOUT_MS / 1000}s: ${command}`
      );
    }

    // Combine stdout + stderr, truncate if enormous
    const rawOutput = [
      execResult.stdout,
      execResult.stderr ? `[stderr]\n${execResult.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    const commandOutput =
      rawOutput.length > MAX_OUTPUT_CHARS
        ? rawOutput.slice(0, MAX_OUTPUT_CHARS) +
          `\n\n[output truncated — ${rawOutput.length - MAX_OUTPUT_CHARS} chars omitted]`
        : rawOutput || "(no output)";

    const exitInfo =
      execResult.exitCode !== null && execResult.exitCode !== 0
        ? `\n[exit code: ${execResult.exitCode}]`
        : "";

    // -----------------------------------------------------------------------
    // 4. Build the model payload
    // -----------------------------------------------------------------------
    const modelPrompt = [
      `Command run: ${command}`,
      `Expected output: ${expected_output}`,
      ``,
      `--- Command output ---`,
      commandOutput + exitInfo,
      `--- End output ---`,
      ``,
      prompt,
    ].join("\n");

    const systemPrompt =
      "You are a command output interpreter. " +
      "The user ran a shell command and provided its output. " +
      "Answer the user's question based strictly on the command output shown. " +
      "Be concise. No preamble. If the output does not contain enough information to answer, say so explicitly.";

    // -----------------------------------------------------------------------
    // 5. Token budget check — refuse if payload exceeds context window
    // -----------------------------------------------------------------------
    const totalTokens = estimateTokens(modelPrompt + systemPrompt);
    if (totalTokens > config.contextWindow) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `token_budget_exceeded: payload is ~${totalTokens} tokens but context window is ${config.contextWindow}. ` +
          `Reduce the command output or increase OLLAMA_CONTEXT_WINDOW. ` +
          `Tip: pipe the command through grep/head/tail to limit output before sending.`
      );
    }

    // -----------------------------------------------------------------------
    // 6. Resolve model and call Ollama
    // -----------------------------------------------------------------------
    const resolvedModel = capabilityRouter.resolveModel(prompt, explicitModel);

    const response = await requestQueue.enqueue(async (signal) => {
      const result = await ollamaClient.generate(
        {
          model: resolvedModel,
          prompt: modelPrompt,
          system: systemPrompt,
          context: null,
          stream: false,
          options: config.modelOptions
            ? { num_ctx: config.contextWindow, ...config.modelOptions }
            : { num_ctx: config.contextWindow },
        },
        { signal }
      );
      return result.response;
    }, config.requestTimeoutMs);

    // -----------------------------------------------------------------------
    // 7. Return result
    // -----------------------------------------------------------------------
    const text = [
      `Command: \`${command}\``,
      `Exit code: ${execResult.exitCode ?? "unknown"}`,
      ``,
      response,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  };
}
