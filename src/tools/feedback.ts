import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

interface FeedbackInput {
  issue: string;
  tool?: string;
  command?: string;
  observed?: string;
  expected?: string;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new McpError(ErrorCode.InvalidParams, `"${key}" must be a string`);
  }
  return value.trim() || undefined;
}

function validateInput(args: unknown): FeedbackInput {
  if (typeof args !== "object" || args === null) {
    throw new McpError(ErrorCode.InvalidParams, "Arguments must be an object");
  }
  const input = args as Record<string, unknown>;
  const issue = optionalString(input, "issue");
  if (!issue) {
    throw new McpError(ErrorCode.InvalidParams, '"issue" must be a non-empty string');
  }

  return {
    issue,
    tool: optionalString(input, "tool"),
    command: optionalString(input, "command"),
    observed: optionalString(input, "observed"),
    expected: optionalString(input, "expected"),
  };
}

function inferInstruction(input: FeedbackInput): string {
  const text = [input.issue, input.tool, input.command, input.observed, input.expected]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("token_budget") || text.includes("too much output") || text.includes("context window")) {
    return "Limit output before interpretation: set interpret=false for raw checks, use max_output_chars, or redirect verbose output to a log and return only tail output.";
  }
  if (text.includes("empty") || text.includes("no output") || text.includes("exit code 0")) {
    return "Treat exit code 0 as success even when stdout is empty. Use interpret=false when the caller only needs command success/failure.";
  }
  if (text.includes("quote") || text.includes("powershell") || text.includes("path") || text.includes("not found")) {
    return "Prefer specific tools and simple argument strings. For PowerShell-specific syntax, use powershell_command; otherwise use the matching *_command tool in the declared cwd.";
  }
  if (text.includes("wrong tool") || text.includes("run_command")) {
    return "Prefer the most specific MCP tool first: rg_search/get_content/gh_command/*_command. Use run_command only as fallback.";
  }

  return "Update the MCP usage instructions with the observed failure, the expected behavior, and the smallest repeatable rule that would have avoided the issue.";
}

export function createFeedbackHandler() {
  return async (args: unknown) => {
    const input = validateInput(args);
    const instruction = inferInstruction(input);
    const payload = {
      received: input,
      suggested_instruction: instruction,
      compact_rule: `MCP feedback: ${instruction}`,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: ["Feedback received", JSON.stringify(payload, null, 2)].join("\n\n"),
        },
      ],
    };
  };
}
