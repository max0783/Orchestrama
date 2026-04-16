// Required keywords per task type (from requirements 11.3-11.6):
// code_review: must contain "findings" (issues, risks, suggestions; omit description of what code does)
// log_analysis: must contain "anomalies" (errors, patterns; omit normal operations summary)
// summarization: must contain "3 to 5 lines" (dense summary)
// generic: must contain instructions to omit preamble/filler
const BUILT_IN_DEFAULT = `You are a concise assistant. Return only essential information.
- Omit preamble and filler phrases (e.g. "Sure!", "Of course!", "Here is...").
- Use structured formats (bullet points, key:value pairs, short code blocks) over prose.
- Omit any explanation of your own reasoning process.`;
const CODE_REVIEW_PROMPT = `You are a code reviewer. Return only findings (issues, risks, suggestions).
- Omit any description of what the code does.
- Use bullet points for each finding.
- Omit preamble and filler phrases.
- Omit any explanation of your reasoning process.`;
const LOG_ANALYSIS_PROMPT = `You are a log analyst. Return only anomalies, errors, and patterns.
- Omit any summary of normal operations.
- Use bullet points for each anomaly or error.
- Omit preamble and filler phrases.
- Omit any explanation of your reasoning process.`;
const SUMMARIZATION_PROMPT = `You are a summarizer. Return a maximum of 3 to 5 lines of dense summary.
- Use the most important facts only.
- Omit preamble and filler phrases.
- Omit any explanation of your reasoning process.`;
export class SystemPromptInjector {
    envSystemPrompt;
    constructor(envSystemPrompt = "") {
        this.envSystemPrompt = envSystemPrompt;
    }
    detect(prompt) {
        const lower = prompt.toLowerCase();
        if (lower.includes("review") ||
            lower.includes("code") ||
            lower.includes("refactor") ||
            lower.includes("lint")) {
            return "code_review";
        }
        if (lower.includes("log") ||
            lower.includes("error") ||
            lower.includes("trace") ||
            lower.includes("debug")) {
            return "log_analysis";
        }
        if (lower.includes("summarize") ||
            lower.includes("summary") ||
            lower.includes("tldr") ||
            lower.includes("brief")) {
            return "summarization";
        }
        return "generic";
    }
    build(taskType, override) {
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
//# sourceMappingURL=system_prompt.js.map