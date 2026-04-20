// Feature: dual-console-separation, Property 8: Config display contains all BridgeConfig fields and capability map entries
// For any BridgeConfig object, the formatted configuration output SHALL contain
// every field name defined in BridgeConfig and every pattern→model entry in the capabilityMap.
//
// **Validates: Requirements 5.1, 5.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatConfig } from "../../console/formatters.js";
import type { BridgeConfig } from "../../types.js";

// Arbitrary for BridgeConfig
const bridgeConfigArb = fc.record({
  ollamaBaseUrl: fc.string({ minLength: 1 }),
  defaultModel: fc.string({ minLength: 1 }),
  contextWindow: fc.integer({ min: 1, max: 100000 }),
  keepAlive: fc.string({ minLength: 1 }),
  keepAliveOnStart: fc.boolean(),
  allowedDirs: fc.array(fc.string({ minLength: 1 })),
  allowedDirsExplicit: fc.boolean(),
  systemPrompt: fc.string(),
  capabilityMap: fc.dictionary(
    fc.string({ minLength: 1 }),
    fc.string({ minLength: 1 })
  ),
  fallbackModels: fc.array(fc.string({ minLength: 1 })),
  queueMaxSize: fc.integer({ min: 1, max: 100 }),
  numParallel: fc.integer({ min: 1, max: 10 }),
  requestTimeoutMs: fc.integer({ min: 1000, max: 600000 }),
  reductionLogPath: fc.string({ minLength: 1 }),
  logLevel: fc.constantFrom("info" as const, "debug" as const),
  disableProgress: fc.boolean(),
}) satisfies fc.Arbitrary<BridgeConfig>;

describe("Property 8: Config display contains all BridgeConfig fields and capability map entries", () => {
  it(
    "output contains every BridgeConfig field name",
    () => {
      fc.assert(
        fc.property(bridgeConfigArb, (config) => {
          const output = formatConfig(config);

          const fieldNames: (keyof BridgeConfig)[] = [
            "ollamaBaseUrl",
            "defaultModel",
            "contextWindow",
            "keepAlive",
            "keepAliveOnStart",
            "allowedDirs",
            "systemPrompt",
            "capabilityMap",
            "fallbackModels",
            "queueMaxSize",
            "numParallel",
            "requestTimeoutMs",
            "reductionLogPath",
            "logLevel",
            "disableProgress",
          ];

          for (const field of fieldNames) {
            expect(output).toContain(field);
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "output contains every capabilityMap pattern→model entry",
    () => {
      fc.assert(
        fc.property(
          bridgeConfigArb.filter(
            (c) => Object.keys(c.capabilityMap).length > 0
          ),
          (config) => {
            const output = formatConfig(config);

            for (const [pattern, model] of Object.entries(config.capabilityMap)) {
              expect(output).toContain(pattern);
              expect(output).toContain(model);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
