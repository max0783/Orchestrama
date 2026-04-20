import type { UsagePattern } from "../types.js";
import type { PatternRegistry } from "./registry.js";

export interface DispatchResult {
  pattern: UsagePattern;
  matchedBy: "name" | "keyword";
}

export class IntentDispatcher {
  constructor(private registry: PatternRegistry) {}

  /**
   * Resolves an intent string to a UsagePattern.
   * Returns null if no pattern matches (caller falls back to task-type detection).
   * Matching order: exact name match → keyword substring match.
   * All comparisons are case-insensitive.
   */
  resolve(intent: string): DispatchResult | null {
    const lowerIntent = intent.toLowerCase();
    const patterns = this.registry.list();

    // 1. Exact name match (case-insensitive)
    for (const pattern of patterns) {
      if (pattern.name.toLowerCase() === lowerIntent) {
        return { pattern, matchedBy: "name" };
      }
    }

    // 2. Keyword substring match (case-insensitive):
    //    keyword is a substring of intent, OR intent is a substring of keyword
    for (const pattern of patterns) {
      for (const keyword of pattern.keywords) {
        const lowerKeyword = keyword.toLowerCase();
        if (lowerIntent.includes(lowerKeyword) || lowerKeyword.includes(lowerIntent)) {
          return { pattern, matchedBy: "keyword" };
        }
      }
    }

    return null;
  }
}
