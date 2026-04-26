/**
 * run_command tool handler.
 *
 * Executes a shell command and captures its output. By default it sends the
 * output to the local Ollama model for interpretation; callers can set
 * interpret=false to return bounded raw output without spending model tokens.
 *
 * Security: the working directory for command execution is validated against
 * the effective allowed directories, including session-scoped directories
 * declared through declare_working_dirs.
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

/** Default cap on raw command output fed to the model (characters). */
const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const MAX_OUTPUT_CHARS_LIMIT = 64_000;

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
  interpret: boolean;
  max_output_chars: number;
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
  if (
    a["expected_output"] !== undefined &&
    (typeof a["expected_output"] !== "string" || a["expected_output"].trim() === "")
  ) {
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
  if (a["interpret"] !== undefined && typeof a["interpret"] !== "boolean") {
    throw new McpError(ErrorCode.InvalidParams, '"interpret" must be a boolean');
  }
  if (
    a["max_output_chars"] !== undefined &&
    (
      typeof a["max_output_chars"] !== "number" ||
      !Number.isInteger(a["max_output_chars"]) ||
      a["max_output_chars"] < 1_000 ||
      a["max_output_chars"] > MAX_OUTPUT_CHARS_LIMIT
    )
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"max_output_chars" must be an integer between 1000 and ${MAX_OUTPUT_CHARS_LIMIT}`
    );
  }

  const cwd =
    typeof a["cwd"] === "string" && a["cwd"].trim() !== ""
      ? a["cwd"].trim()
      : defaultCwd;

  return {
    prompt: (a["prompt"] as string).trim(),
    command: (a["command"] as string).trim(),
    expected_output:
      typeof a["expected_output"] === "string"
        ? a["expected_output"].trim()
        : "Interpret the command output and exit code.",
    cwd,
    model: a["model"] as string | undefined,
    interpret: (a["interpret"] as boolean | undefined) ?? true,
    max_output_chars:
      (a["max_output_chars"] as number | undefined) ?? DEFAULT_MAX_OUTPUT_CHARS,
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
    const {
      prompt,
      command,
      expected_output,
      cwd,
      model: explicitModel,
      interpret,
      max_output_chars,
    } =
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
      `[orchestrama] run_command | cmd="${command}" | cwd="${resolvedCwd}"\n`
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
      rawOutput.length > max_output_chars
        ? rawOutput.slice(0, max_output_chars) +
          `\n\n[output truncated — ${rawOutput.length - max_output_chars} chars omitted]`
        : rawOutput || "(no output)";

    if (!interpret) {
      const text = [
        `Command: \`${command}\``,
        `Cwd: ${resolvedCwd}`,
        `Exit code: ${execResult.exitCode ?? "unknown"}`,
        ``,
        commandOutput,
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    }

    // -----------------------------------------------------------------------
    // 4. Build the model payload
    // -----------------------------------------------------------------------
    const modelPrompt = [
      `Command run: ${command}`,
      `Working directory: ${resolvedCwd}`,
      `Exit code: ${execResult.exitCode ?? "unknown"}`,
      `Expected output: ${expected_output}`,
      ``,
      `--- Command output ---`,
      commandOutput,
      `--- End output ---`,
      ``,
      prompt,
    ].join("\n");

    const systemPrompt =
      "You are a command output interpreter. " +
      "The user ran a shell command and provided its output. " +
      "Answer the user's question based strictly on the command, exit code, and output shown. " +
      "Treat exit code 0 as success even when output is empty. " +
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
