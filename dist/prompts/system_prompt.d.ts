import type { TaskType } from "../types.js";
export declare class SystemPromptInjector {
    private envSystemPrompt;
    constructor(envSystemPrompt?: string);
    detect(prompt: string): TaskType;
    build(taskType: TaskType, override?: string): string;
}
//# sourceMappingURL=system_prompt.d.ts.map