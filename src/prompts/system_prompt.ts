import type { TaskType } from "../types.js";

// Required keywords per task type (from requirements 11.3-11.6):
// code_review: must contain "findings" (issues, risks, suggestions; omit description of what code does)
// log_analysis: must contain "anomalies" (errors, patterns; omit normal operations summary)
// summarization: must contain "3 to 5 lines" (dense summary)
// generic: must contain instructions to omit preamble/filler

const BUILT_IN_DEFAULT = `Return only essential information. No preamble. No filler phrases (e.g. "Sure!", "Of course!", "Here is..."). No explanation of your reasoning. Use bullet points or key:value pairs over prose.`;

const CODE_REVIEW_PROMPT = `Return only a bullet list of findings: issues, risks, suggestions. One bullet per finding. No preamble. No description of what the code does. No reasoning explanation. If nothing to report, output only: 'No findings.'`;

const LOG_ANALYSIS_PROMPT = `Return only anomalies, errors, and notable patterns. One bullet per finding with timestamp (if present) and severity. No summary of normal operations. No preamble. No reasoning explanation. If nothing found, output only: 'No anomalies found.'`;

const SUMMARIZATION_PROMPT = `Output 3 to 5 lines of dense summary. Key points and outcomes only. Plain prose. No headings. No bullets. No preamble.`;

export class SystemPromptInjector {
  constructor(
    private envSystemPrompt: string = "", // BRIDGE_SYSTEM_PROMPT env var value (empty = not set)
  ) {}

  detect(prompt: string): TaskType {
    const lower = prompt.toLowerCase();
    if (
      lower.includes("review") ||
      lower.includes("code") ||
      lower.includes("refactor") ||
      lower.includes("lint")
    ) {
      return "code_review";
    }
    if (
      lower.includes("log") ||
      lower.includes("error") ||
      lower.includes("trace") ||
      lower.includes("debug")
    ) {
      return "log_analysis";
    }
    if (
      lower.includes("summarize") ||
      lower.includes("summary") ||
      lower.includes("tldr") ||
      lower.includes("brief")
    ) {
      return "summarization";
    }
    return "generic";
  }

  build(taskType: TaskType, override?: string): string {
    // 1. system_prompt parameter wins
    if (override && override.trim() !== "") {
      return override;
    }
    // 2. BRIDGE_SYSTEM_PROMPT env var
    if (this.envSystemPrompt && this.envSystemPrompt.trim() !== "") {
      return this.envSystemPrompt;
    }
    // 3. Built-in default per task type
    switch (taskType) {
      case "code_review":
        return CODE_REVIEW_PROMPT;
      case "log_analysis":
        return LOG_ANALYSIS_PROMPT;
      case "summarization":
        return SUMMARIZATION_PROMPT;
      default:
        return BUILT_IN_DEFAULT;
    }
  }
}
