// Feature: orchestrama, Property 11: System prompt task-type coverage
// For any task type (code_review, log_analysis, summarization, generic), the
// system prompt built by SystemPromptInjector.build(taskType) should contain
// the required instruction keywords for that task type.
//
// Feature: orchestrama, Property 12: System prompt override precedence
// For any invocation, the active system prompt should be: (1) the system_prompt
// parameter if provided, (2) BRIDGE_SYSTEM_PROMPT env var if set, (3) the
// built-in default. Higher-priority values should completely replace lower-priority ones.
//
// **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SystemPromptInjector } from "../../prompts/system_prompt.js";
import type { TaskType } from "../../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allTaskTypes = fc.constantFrom<TaskType>(
  "code_review",
  "log_analysis",
  "summarization",
  "generic"
);

/** Non-empty, non-whitespace-only string for use as override/env values. */
const nonBlankString = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim() !== "");

// ---------------------------------------------------------------------------
// Property 11: System prompt task-type coverage
// ---------------------------------------------------------------------------

describe("Property 11: System prompt task-type coverage", () => {
  it("code_review prompt contains 'findings'", () => {
    fc.assert(
      fc.property(allTaskTypes, (taskType) => {
        // Only test code_review here; other task types tested below
        const injector = new SystemPromptInjector("");
        if (taskType !== "code_review") return;
        const prompt = injector.build("code_review");
        expect(prompt.toLowerCase()).toContain("findings");
      }),
      { numRuns: 100 }
    );
  });

  it("log_analysis prompt contains 'anomalies'", () => {
    fc.assert(
      fc.property(allTaskTypes, (taskType) => {
        if (taskType !== "log_analysis") return;
        const injector = new SystemPromptInjector("");
        const prompt = injector.build("log_analysis");
        expect(prompt.toLowerCase()).toContain("anomalies");
      }),
      { numRuns: 100 }
    );
  });

  it("summarization prompt contains '3 to 5 lines'", () => {
    fc.assert(
      fc.property(allTaskTypes, (taskType) => {
        if (taskType !== "summarization") return;
        const injector = new SystemPromptInjector("");
        const prompt = injector.build("summarization");
        expect(prompt.toLowerCase()).toContain("3 to 5 lines");
      }),
      { numRuns: 100 }
    );
  });

  it("generic prompt contains instructions to omit preamble/filler", () => {
    fc.assert(
      fc.property(allTaskTypes, (taskType) => {
        if (taskType !== "generic") return;
        const injector = new SystemPromptInjector("");
        const prompt = injector.build("generic");
        const lower = prompt.toLowerCase();
        const hasPreambleOrFiller =
          lower.includes("preamble") ||
          lower.includes("filler") ||
          lower.includes("omit");
        expect(hasPreambleOrFiller).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("every task type produces a non-empty built-in prompt (no override, no env)", () => {
    fc.assert(
      fc.property(allTaskTypes, (taskType) => {
        const injector = new SystemPromptInjector("");
        const prompt = injector.build(taskType);
        expect(prompt.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("each task type produces a distinct built-in prompt", () => {
    const injector = new SystemPromptInjector("");
    const prompts = new Set<string>([
      injector.build("code_review"),
      injector.build("log_analysis"),
      injector.build("summarization"),
      injector.build("generic"),
    ]);
    // All four should be distinct
    expect(prompts.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Property 12: System prompt override precedence
// ---------------------------------------------------------------------------

describe("Property 12: System prompt override precedence", () => {
  it("override param takes precedence over env var and built-in default", () => {
    fc.assert(
      fc.property(
        allTaskTypes,
        nonBlankString, // override param
        nonBlankString, // env system prompt
        (taskType, override, envPrompt) => {
          const injector = new SystemPromptInjector(envPrompt);
          const result = injector.build(taskType, override);
          expect(result).toBe(override);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("env var takes precedence over built-in default when no override param", () => {
    fc.assert(
      fc.property(
        allTaskTypes,
        nonBlankString, // env system prompt
        (taskType, envPrompt) => {
          const injector = new SystemPromptInjector(envPrompt);
          // No override param (undefined)
          const result = injector.build(taskType);
          expect(result).toBe(envPrompt);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("built-in default is used when neither override param nor env var is set", () => {
    fc.assert(
      fc.property(allTaskTypes, (taskType) => {
        const injector = new SystemPromptInjector(""); // empty = not set
        const result = injector.build(taskType);
        expect(result.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("blank override param (whitespace only) does not override env var", () => {
    fc.assert(
      fc.property(
        allTaskTypes,
        nonBlankString, // env system prompt
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/\S/g, " ")), // whitespace-only override
        (taskType, envPrompt, blankOverride) => {
          // Ensure blankOverride is truly whitespace-only
          if (blankOverride.trim() !== "") return;
          const injector = new SystemPromptInjector(envPrompt);
          const result = injector.build(taskType, blankOverride);
          // Blank override should be ignored; env var should win
          expect(result).toBe(envPrompt);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("blank env var (whitespace only) does not override built-in default", () => {
    fc.assert(
      fc.property(
        allTaskTypes,
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/\S/g, " ")), // whitespace-only env
        (taskType, blankEnv) => {
          if (blankEnv.trim() !== "") return;
          const injector = new SystemPromptInjector(blankEnv);
          const result = injector.build(taskType);
          // Should fall through to built-in default (non-empty)
          expect(result.trim().length).toBeGreaterThan(0);
          // And should NOT equal the blank env string
          expect(result).not.toBe(blankEnv);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("higher-priority value completely replaces lower-priority one (no merging)", () => {
    fc.assert(
      fc.property(
        allTaskTypes,
        nonBlankString, // override
        nonBlankString, // env
        (taskType, override, envPrompt) => {
          // Ensure override and envPrompt are different strings
          fc.pre(override !== envPrompt);
          const injector = new SystemPromptInjector(envPrompt);
          const result = injector.build(taskType, override);
          // Result must be exactly the override — the env prompt is not used at all
          expect(result).toBe(override);
          // The result must NOT equal the env prompt (it was replaced, not merged)
          expect(result).not.toBe(envPrompt);
        }
      ),
      { numRuns: 100 }
    );
  });
});
