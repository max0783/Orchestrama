/**
 * Unit tests for src/advisor/gpu_detector.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectHardware } from "../../advisor/gpu_detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExec(responses: Record<string, string | Error>): (cmd: string) => Promise<string> {
  return async (cmd: string) => {
    const key = Object.keys(responses).find((k) => cmd.includes(k));
    if (!key) throw new Error(`No mock for command: ${cmd}`);
    const val = responses[key];
    if (val instanceof Error) throw val;
    return val;
  };
}

// ---------------------------------------------------------------------------
// No-GPU fallback
// ---------------------------------------------------------------------------

describe("detectHardware — no-GPU fallback", () => {
  it("returns cpuOnly=true and zero VRAM when all detection commands fail", async () => {
    const execCommand = async (_cmd: string): Promise<string> => {
      throw new Error("command not found");
    };

    const result = await detectHardware({ execCommand });

    expect(result.cpuOnly).toBe(true);
    expect(result.totalVramMb).toBe(0);
    expect(result.vramBudgetMb).toBe(0);
    expect(result.gpuName).toBe("CPU-only");
  });
});

// ---------------------------------------------------------------------------
// NVIDIA detection
// ---------------------------------------------------------------------------

describe("detectHardware — NVIDIA detection", () => {
  it("parses nvidia-smi output correctly", async () => {
    const execCommand = makeExec({
      "nvidia-smi": "NVIDIA RTX 4090, 24576\n",
      "rocm-smi": new Error("not found"),
      "system_profiler": new Error("not found"),
      "sysctl": "hw.memsize: 17179869184",
    });

    const result = await detectHardware({ execCommand });

    expect(result.gpuName).toBe("NVIDIA RTX 4090");
    expect(result.totalVramMb).toBe(24576);
    expect(result.cpuOnly).toBe(false);
  });

  it("applies the default 10% safety margin", async () => {
    const execCommand = makeExec({
      "nvidia-smi": "NVIDIA RTX 4090, 24576\n",
      "sysctl": "hw.memsize: 17179869184",
    });

    const result = await detectHardware({ execCommand });

    // 24576 * 0.9 = 22118.4 → rounded to 22118
    expect(result.vramBudgetMb).toBe(22118);
  });
});

// ---------------------------------------------------------------------------
// Multi-GPU summation
// ---------------------------------------------------------------------------

describe("detectHardware — multi-GPU summation", () => {
  it("sums VRAM across multiple GPUs", async () => {
    const execCommand = makeExec({
      "nvidia-smi": "NVIDIA RTX 4090, 24576\nNVIDIA RTX 4090, 24576\n",
      "sysctl": "hw.memsize: 17179869184",
    });

    const result = await detectHardware({ execCommand });

    expect(result.totalVramMb).toBe(49152);
    expect(result.gpuName).toBe("NVIDIA RTX 4090");
  });
});

// ---------------------------------------------------------------------------
// Safety margin
// ---------------------------------------------------------------------------

describe("detectHardware — safety margin", () => {
  it("applies custom safetyMarginPct correctly", async () => {
    const execCommand = makeExec({
      "nvidia-smi": "NVIDIA GPU, 10000\n",
      "sysctl": "hw.memsize: 17179869184",
    });

    const result = await detectHardware({ execCommand, safetyMarginPct: 10 });

    expect(result.vramBudgetMb).toBe(9000);
  });
});

// ---------------------------------------------------------------------------
// AMD detection fallback
// ---------------------------------------------------------------------------

describe("detectHardware — AMD detection fallback", () => {
  it("falls back to rocm-smi when nvidia-smi fails", async () => {
    const amdJson = JSON.stringify({
      "card0": {
        "VRAM Total Memory (B)": "8589934592", // 8 GB
      },
    });

    const execCommand = async (cmd: string): Promise<string> => {
      if (cmd.includes("nvidia-smi")) throw new Error("not found");
      if (cmd.includes("rocm-smi")) return amdJson;
      if (cmd.includes("sysctl")) return "hw.memsize: 17179869184";
      throw new Error(`No mock for: ${cmd}`);
    };

    const result = await detectHardware({ execCommand });

    expect(result.cpuOnly).toBe(false);
    expect(result.totalVramMb).toBe(8192); // 8 GB in MB
    expect(result.gpuName).toContain("AMD");
  });
});

// ---------------------------------------------------------------------------
// macOS Metal detection
// ---------------------------------------------------------------------------

describe("detectHardware — macOS Metal detection", () => {
  it("falls back to system_profiler when nvidia-smi and rocm-smi fail", async () => {
    const systemProfilerOutput = `
      Chipset Model: Apple M2 Pro
      VRAM (Total): 16 GB
    `;

    const execCommand = async (cmd: string): Promise<string> => {
      if (cmd.includes("nvidia-smi")) throw new Error("not found");
      if (cmd.includes("rocm-smi")) throw new Error("not found");
      if (cmd.includes("system_profiler")) return systemProfilerOutput;
      if (cmd.includes("sysctl")) return "hw.memsize: 17179869184";
      throw new Error(`No mock for: ${cmd}`);
    };

    const result = await detectHardware({ execCommand });

    expect(result.cpuOnly).toBe(false);
    expect(result.totalVramMb).toBe(16384); // 16 GB in MB
    expect(result.gpuName).toBe("Apple M2 Pro");
  });
});

// ---------------------------------------------------------------------------
// promptForVram callback
// ---------------------------------------------------------------------------

describe("detectHardware — promptForVram callback", () => {
  it("calls promptForVram when all GPU detection fails and uses its return value", async () => {
    const execCommand = async (_cmd: string): Promise<string> => {
      throw new Error("not found");
    };

    const promptForVram = vi.fn().mockResolvedValue(8192);

    const result = await detectHardware({ execCommand, promptForVram });

    expect(promptForVram).toHaveBeenCalledOnce();
    expect(result.totalVramMb).toBe(8192);
    expect(result.cpuOnly).toBe(false);
    expect(result.gpuName).toBe("Manual GPU");
  });

  it("remains cpuOnly when promptForVram returns 0", async () => {
    const execCommand = async (_cmd: string): Promise<string> => {
      throw new Error("not found");
    };

    const promptForVram = vi.fn().mockResolvedValue(0);

    const result = await detectHardware({ execCommand, promptForVram });

    expect(result.totalVramMb).toBe(0);
    expect(result.cpuOnly).toBe(true);
    expect(result.gpuName).toBe("CPU-only");
  });
});
