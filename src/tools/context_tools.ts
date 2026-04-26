/**
 * Tool wrappers that gather context with common developer tools, then route the
 * gathered output through query_local_model's existing model pipeline.
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ModelOptions } from "../types.js";
import type { IPathValidator } from "../security/path_validator.js";

type QueryHandler = (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const MAX_OUTPUT_CHARS_LIMIT = 64_000;
const DEFAULT_TIMEOUT_MS = 30_000;

interface CommonModelInput {
  prompt: string;
  model: string | undefined;
  intent: string | undefined;
  system_prompt: string | undefined;
  options: ModelOptions | undefined;
  interpret: boolean;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ProgramCommandSpec {
  toolName: string;
  executable: string;
  displayName: string;
  examples: string[];
}

export const PROGRAM_COMMAND_SPECS: ProgramCommandSpec[] = [
  { toolName: "git_command", executable: "git", displayName: "Git", examples: ["status --short", "diff -- src/server.ts"] },
  { toolName: "npm_command", executable: "npm", displayName: "npm", examples: ["test", "run build"] },
  { toolName: "npx_command", executable: "npx", displayName: "npx", examples: ["vitest --run", "playwright test"] },
  { toolName: "node_command", executable: "node", displayName: "Node.js", examples: ["--version", "dist/server.js"] },
  { toolName: "pnpm_command", executable: "pnpm", displayName: "pnpm", examples: ["test", "run build"] },
  { toolName: "yarn_command", executable: "yarn", displayName: "Yarn", examples: ["test", "build"] },
  { toolName: "tsc_command", executable: "tsc", displayName: "TypeScript compiler", examples: ["--noEmit", "-p tsconfig.json"] },
  { toolName: "eslint_command", executable: "eslint", displayName: "ESLint", examples: [".", "src --max-warnings=0"] },
  { toolName: "prettier_command", executable: "prettier", displayName: "Prettier", examples: ["--check .", "--write src"] },
  { toolName: "vitest_command", executable: "npx vitest", displayName: "Vitest", examples: ["--run", "--run src/example.test.ts"] },
  { toolName: "jest_command", executable: "jest", displayName: "Jest", examples: ["--runInBand", "src/example.test.ts"] },
  { toolName: "playwright_command", executable: "playwright", displayName: "Playwright", examples: ["test", "test --project=chromium"] },
  { toolName: "python_command", executable: "python", displayName: "Python", examples: ["--version", "-m pytest"] },
  { toolName: "pip_command", executable: "pip", displayName: "pip", examples: ["list", "install -r requirements.txt"] },
  { toolName: "pytest_command", executable: "pytest", displayName: "pytest", examples: ["-q", "tests/test_example.py"] },
  { toolName: "uv_command", executable: "uv", displayName: "uv", examples: ["run pytest", "sync"] },
  { toolName: "poetry_command", executable: "poetry", displayName: "Poetry", examples: ["run pytest", "install"] },
  { toolName: "docker_command", executable: "docker", displayName: "Docker", examples: ["ps", "build ."] },
  { toolName: "docker_compose_command", executable: "docker compose", displayName: "Docker Compose", examples: ["ps", "up --build"] },
  { toolName: "curl_command", executable: "curl", displayName: "curl", examples: ["-i http://localhost:3000", "-s http://localhost:11434/api/tags"] },
  { toolName: "jq_command", executable: "jq", displayName: "jq", examples: [".", ".scripts"] },
  { toolName: "fd_command", executable: "fd", displayName: "fd", examples: ["server", "-e ts"] },
  { toolName: "ls_command", executable: "ls", displayName: "ls", examples: ["-la", "src"] },
  { toolName: "dir_command", executable: "cmd /c dir", displayName: "dir", examples: ["/b", "src"] },
  { toolName: "powershell_command", executable: "powershell -NoProfile -Command", displayName: "PowerShell", examples: ["Get-ChildItem", "Get-Content package.json"] },
  { toolName: "task_command", executable: "task", displayName: "Task", examples: ["--list", "build"] },
  { toolName: "make_command", executable: "make", displayName: "Make", examples: ["test", "build"] },
  { toolName: "just_command", executable: "just", displayName: "Just", examples: ["--list", "test"] },
  { toolName: "cargo_command", executable: "cargo", displayName: "Cargo", examples: ["test", "build"] },
  { toolName: "go_command", executable: "go", displayName: "Go", examples: ["test ./...", "build ./..."] },
  { toolName: "dotnet_command", executable: "dotnet", displayName: ".NET CLI", examples: ["test", "build"] },
  { toolName: "mvn_command", executable: "mvn", displayName: "Maven", examples: ["test", "package"] },
  { toolName: "gradle_command", executable: "gradle", displayName: "Gradle", examples: ["test", "build"] },
  { toolName: "kubectl_command", executable: "kubectl", displayName: "kubectl", examples: ["get pods", "describe pod NAME"] },
  { toolName: "ollama_command", executable: "ollama", displayName: "Ollama", examples: ["list", "ps"] },
];

function validateObject(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null) {
    throw new McpError(ErrorCode.InvalidParams, "Arguments must be an object");
  }
  return args as Record<string, unknown>;
}

function requireNonEmptyString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpError(ErrorCode.InvalidParams, `"${key}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new McpError(ErrorCode.InvalidParams, `"${key}" must be a string`);
  }
  return value;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new McpError(ErrorCode.InvalidParams, `"${key}" must be an array of strings`);
  }
  return value as string[];
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new McpError(ErrorCode.InvalidParams, `"${key}" must be a boolean`);
  }
  return value;
}

function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  const value = args[key];
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `"${key}" must be an integer between ${min} and ${max}`
    );
  }
  return value;
}

function optionalOptions(args: Record<string, unknown>): ModelOptions | undefined {
  const value = args["options"];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpError(ErrorCode.InvalidParams, '"options" must be an object');
  }

  const input = value as Record<string, unknown>;
  const parsed: ModelOptions = {};
  const numericKeys: (keyof ModelOptions)[] = [
    "temperature",
    "top_p",
    "top_k",
    "repeat_penalty",
    "seed",
    "num_predict",
    "min_p",
    "tfs_z",
  ];

  for (const key of numericKeys) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "number") {
      throw new McpError(ErrorCode.InvalidParams, `"options.${key}" must be a number`);
    }
    (parsed as Record<string, number>)[key] = input[key] as number;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseCommonModelInput(args: Record<string, unknown>): CommonModelInput {
  return {
    prompt: requireNonEmptyString(args, "prompt"),
    model: optionalString(args, "model"),
    intent: optionalString(args, "intent"),
    system_prompt: optionalString(args, "system_prompt"),
    options: optionalOptions(args),
    interpret: optionalBoolean(args, "interpret") ?? true,
  };
}

async function resolveAllowedCwd(
  cwd: string | undefined,
  pathValidator: IPathValidator,
  sessionId: string
): Promise<string> {
  const input = cwd && cwd.trim() !== "" ? cwd.trim() : process.cwd();
  let resolved: string;
  try {
    resolved = await fs.realpath(input);
  } catch (err) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `cwd "${input}" could not be resolved: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  pathValidator.assertCwdAllowed(resolved, sessionId);
  return resolved;
}

function execFile(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: buildCommandEnv(cwd),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

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

function execShell(commandLine: string, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(commandLine, [], {
      cwd,
      shell: true,
      env: buildCommandEnv(cwd),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

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

function buildCommandEnv(cwd: string): NodeJS.ProcessEnv {
  const nodeBinPath = path.join(cwd, "node_modules", ".bin");
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] ?? process.env["PATH"] ?? "";
  return {
    ...process.env,
    [pathKey]: `${nodeBinPath}${path.delimiter}${currentPath}`,
  };
}

function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[output truncated: ${text.length - maxChars} chars omitted]`;
}

function rawResponse(command: string, cwd: string, exitCode: number | null, output: string) {
  const text = [
    `Command: \`${command}\``,
    `Cwd: ${cwd}`,
    `Exit code: ${exitCode ?? "unknown"}`,
    ``,
    output,
  ].join("\n");
  return { content: [{ type: "text" as const, text }] };
}

function buildQueryArgs(common: CommonModelInput, context: string, source: string): Record<string, unknown> {
  return {
    prompt: [
      `Context source: ${source}`,
      "",
      "--- gathered context ---",
      context || "(no output)",
      "--- end gathered context ---",
      "",
      common.prompt,
    ].join("\n"),
    model: common.model,
    intent: common.intent,
    system_prompt: common.system_prompt,
    options: common.options,
  };
}

export interface ContextToolDeps {
  queryHandler: QueryHandler;
  pathValidator: IPathValidator;
  sessionId: string;
}

export function createRgSearchHandler(deps: ContextToolDeps) {
  const { queryHandler, pathValidator, sessionId } = deps;

  return async (rawArgs: unknown) => {
    const args = validateObject(rawArgs);
    const common = parseCommonModelInput(args);
    const pattern = requireNonEmptyString(args, "pattern");
    const cwd = await resolveAllowedCwd(optionalString(args, "cwd"), pathValidator, sessionId);
    const globs = optionalStringArray(args, "globs") ?? [];
    const caseSensitive = optionalBoolean(args, "case_sensitive") ?? true;
    const contextLines = optionalInteger(args, "context_lines", 0, 0, 20);
    const maxOutputChars = optionalInteger(
      args,
      "max_output_chars",
      DEFAULT_MAX_OUTPUT_CHARS,
      1_000,
      MAX_OUTPUT_CHARS_LIMIT
    );

    const rgArgs = ["--line-number", "--no-heading", "--color", "never"];
    if (!caseSensitive) rgArgs.push("--ignore-case");
    if (contextLines > 0) rgArgs.push("--context", String(contextLines));
    for (const glob of globs) rgArgs.push("--glob", glob);
    rgArgs.push(pattern, ".");

    const result = await execFile("rg", rgArgs, cwd);
    if (result.timedOut) {
      throw new McpError(ErrorCode.InternalError, `rg timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
    }

    const raw = [
      `$ rg ${rgArgs.map((arg) => JSON.stringify(arg)).join(" ")}`,
      `cwd: ${cwd}`,
      `exit_code: ${result.exitCode ?? "unknown"}`,
      "",
      result.stdout || "(no matches on stdout)",
      result.stderr ? `\n[stderr]\n${result.stderr}` : "",
    ].join("\n");

    const output = truncateOutput(raw, maxOutputChars);
    if (!common.interpret) {
      return rawResponse(`rg ${rgArgs.join(" ")}`, cwd, result.exitCode, output);
    }
    return queryHandler(buildQueryArgs(common, output, "rg_search"));
  };
}

export function createGhCommandHandler(deps: ContextToolDeps) {
  const { queryHandler, pathValidator, sessionId } = deps;

  return async (rawArgs: unknown) => {
    const args = validateObject(rawArgs);
    const common = parseCommonModelInput(args);
    const ghArgs = optionalStringArray(args, "args");
    if (!ghArgs || ghArgs.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, '"args" must be a non-empty array of strings');
    }
    const cwd = await resolveAllowedCwd(optionalString(args, "cwd"), pathValidator, sessionId);
    const maxOutputChars = optionalInteger(
      args,
      "max_output_chars",
      DEFAULT_MAX_OUTPUT_CHARS,
      1_000,
      MAX_OUTPUT_CHARS_LIMIT
    );

    const result = await execFile("gh", ghArgs, cwd);
    if (result.timedOut) {
      throw new McpError(ErrorCode.InternalError, `gh timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
    }

    const raw = [
      `$ gh ${ghArgs.map((arg) => JSON.stringify(arg)).join(" ")}`,
      `cwd: ${cwd}`,
      `exit_code: ${result.exitCode ?? "unknown"}`,
      "",
      result.stdout || "(no stdout)",
      result.stderr ? `\n[stderr]\n${result.stderr}` : "",
    ].join("\n");

    const output = truncateOutput(raw, maxOutputChars);
    if (!common.interpret) {
      return rawResponse(`gh ${ghArgs.join(" ")}`, cwd, result.exitCode, output);
    }
    return queryHandler(buildQueryArgs(common, output, "gh_command"));
  };
}

export function createProgramCommandHandler(deps: ContextToolDeps, executable: string, source: string) {
  const { queryHandler, pathValidator, sessionId } = deps;

  return async (rawArgs: unknown) => {
    const args = validateObject(rawArgs);
    const common = parseCommonModelInput(args);
    const command = requireNonEmptyString(args, "command");
    const cwd = await resolveAllowedCwd(optionalString(args, "cwd"), pathValidator, sessionId);
    const maxOutputChars = optionalInteger(
      args,
      "max_output_chars",
      DEFAULT_MAX_OUTPUT_CHARS,
      1_000,
      MAX_OUTPUT_CHARS_LIMIT
    );

    const commandLine = `${executable} ${command}`;
    const result = await execShell(commandLine, cwd);
    if (result.timedOut) {
      throw new McpError(
        ErrorCode.InternalError,
        `${executable} timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`
      );
    }

    const raw = [
      `$ ${commandLine}`,
      `cwd: ${cwd}`,
      `exit_code: ${result.exitCode ?? "unknown"}`,
      "",
      result.stdout || "(no stdout)",
      result.stderr ? `\n[stderr]\n${result.stderr}` : "",
    ].join("\n");

    const output = truncateOutput(raw, maxOutputChars);
    if (!common.interpret) {
      return rawResponse(commandLine, cwd, result.exitCode, output);
    }
    return queryHandler(buildQueryArgs(common, output, source));
  };
}

export function createGetContentHandler(queryHandler: QueryHandler) {
  return async (rawArgs: unknown) => {
    const args = validateObject(rawArgs);
    const common = parseCommonModelInput(args);
    const paths = optionalStringArray(args, "paths");
    if (!paths || paths.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, '"paths" must be a non-empty array of strings');
    }

    return queryHandler({
      prompt: common.prompt,
      context_files: paths,
      model: common.model,
      intent: common.intent,
      system_prompt: common.system_prompt,
      options: common.options,
    });
  };
}
