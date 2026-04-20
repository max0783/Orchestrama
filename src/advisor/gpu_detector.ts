/**
 * GpuDetector — queries the host for GPU VRAM and system RAM.
 *
 * Detection strategy (tried in order, first success wins):
 *   1. NVIDIA via nvidia-smi
 *   2. AMD via rocm-smi
 *   3. macOS Metal via system_profiler
 *   4. Fallback: VRAM = 0, cpuOnly = true
 *
 * System RAM detection:
 *   - Linux:   /proc/meminfo
 *   - macOS:   sysctl hw.memsize
 *   - Windows: wmic ComputerSystem get TotalPhysicalMemory
 */

import { exec } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";
import type { HardwareInfo } from "./types.js";

const execAsync = promisify(exec);

export interface GpuDetectorOptions {
  safetyMarginPct?: number;
  /** Injected command executor for testability */
  execCommand?: (cmd: string) => Promise<string>;
  /** Called when GPU detection fails and manual input is needed */
  promptForVram?: () => Promise<number>;
  /** Called when RAM detection fails and manual input is needed */
  promptForRam?: () => Promise<number>;
}

// ---------------------------------------------------------------------------
// Default command executor
// ---------------------------------------------------------------------------

async function defaultExecCommand(cmd: string): Promise<string> {
  const { stdout } = await execAsync(cmd);
  return stdout;
}

// ---------------------------------------------------------------------------
// GPU detection helpers
// ---------------------------------------------------------------------------

/**
 * NVIDIA: nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits
 * Output: one line per GPU, e.g. "NVIDIA GeForce RTX 4090, 24576"
 * Returns { gpuName, totalVramMb } or null on failure.
 */
async function detectNvidia(
  exec: (cmd: string) => Promise<string>
): Promise<{ gpuName: string; totalVramMb: number } | null> {
  try {
    const output = await exec(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits"
    );
    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return null;

    let totalVramMb = 0;
    let gpuName = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Last comma-separated token is the VRAM value
      const lastComma = line.lastIndexOf(",");
      if (lastComma === -1) return null;

      const name = line.slice(0, lastComma).trim();
      const vramStr = line.slice(lastComma + 1).trim();
      const vram = parseInt(vramStr, 10);

      if (isNaN(vram)) return null;

      totalVramMb += vram;
      if (i === 0) gpuName = name;
    }

    if (totalVramMb === 0) return null;

    return { gpuName, totalVramMb };
  } catch {
    return null;
  }
}

/**
 * AMD: rocm-smi --showmeminfo vram --json
 * JSON output contains per-device VRAM info.
 * Returns { gpuName, totalVramMb } or null on failure.
 */
async function detectAmd(
  exec: (cmd: string) => Promise<string>
): Promise<{ gpuName: string; totalVramMb: number } | null> {
  try {
    const output = await exec("rocm-smi --showmeminfo vram --json");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = JSON.parse(output);

    let totalVramMb = 0;
    let gpuName = "AMD GPU";
    let firstDevice = true;

    for (const [deviceKey, deviceInfo] of Object.entries(data)) {
      if (typeof deviceInfo !== "object" || deviceInfo === null) continue;

      // rocm-smi JSON keys vary by version; look for VRAM total bytes
      // Common keys: "VRAM Total Memory (B)", "vram_total"
      let vramBytes: number | null = null;

      for (const [key, val] of Object.entries(deviceInfo as Record<string, unknown>)) {
        const lk = key.toLowerCase();
        if (
          (lk.includes("vram") && lk.includes("total")) ||
          lk === "vram_total"
        ) {
          const n = typeof val === "string" ? parseInt(val, 10) : Number(val);
          if (!isNaN(n)) {
            vramBytes = n;
            break;
          }
        }
      }

      if (vramBytes === null) continue;

      // Convert bytes to MB
      totalVramMb += Math.round(vramBytes / (1024 * 1024));

      if (firstDevice) {
        gpuName = `AMD ${deviceKey}`;
        firstDevice = false;
      }
    }

    if (totalVramMb === 0) return null;

    return { gpuName, totalVramMb };
  } catch {
    return null;
  }
}

/**
 * macOS Metal: system_profiler SPDisplaysDataType
 * Parses "VRAM (Total):" line.
 * Returns { gpuName, totalVramMb } or null on failure.
 */
async function detectMacOsMetal(
  exec: (cmd: string) => Promise<string>
): Promise<{ gpuName: string; totalVramMb: number } | null> {
  try {
    const output = await exec("system_profiler SPDisplaysDataType");
    const lines = output.split("\n");

    let gpuName = "Apple GPU";
    let totalVramMb = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Capture GPU/Chipset name
      if (trimmed.startsWith("Chipset Model:")) {
        gpuName = trimmed.replace("Chipset Model:", "").trim();
      }

      // Parse VRAM line, e.g. "VRAM (Total): 16 GB" or "VRAM (Total): 1536 MB"
      if (trimmed.startsWith("VRAM (Total):")) {
        const vramStr = trimmed.replace("VRAM (Total):", "").trim();
        const match = vramStr.match(/^(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
        if (match) {
          const value = parseFloat(match[1]);
          const unit = match[2].toUpperCase();
          if (unit === "GB") {
            totalVramMb += Math.round(value * 1024);
          } else if (unit === "MB") {
            totalVramMb += Math.round(value);
          } else if (unit === "KB") {
            totalVramMb += Math.round(value / 1024);
          }
        }
      }
    }

    if (totalVramMb === 0) return null;

    return { gpuName, totalVramMb };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// System RAM detection helpers
// ---------------------------------------------------------------------------

/**
 * Linux: read /proc/meminfo, parse MemTotal line (kB → MB).
 */
async function detectLinuxRam(
  _exec: (cmd: string) => Promise<string>
): Promise<number | null> {
  try {
    const content = await readFile("/proc/meminfo", "utf8");
    const match = content.match(/^MemTotal:\s+(\d+)\s+kB/m);
    if (!match) return null;
    const kb = parseInt(match[1], 10);
    return Math.round(kb / 1024);
  } catch {
    return null;
  }
}

/**
 * macOS: sysctl hw.memsize → bytes → MB.
 */
async function detectMacOsRam(
  exec: (cmd: string) => Promise<string>
): Promise<number | null> {
  try {
    const output = await exec("sysctl hw.memsize");
    const match = output.match(/hw\.memsize\s*[:=]\s*(\d+)/);
    if (!match) return null;
    const bytes = parseInt(match[1], 10);
    return Math.round(bytes / (1024 * 1024));
  } catch {
    return null;
  }
}

/**
 * Windows: wmic ComputerSystem get TotalPhysicalMemory → bytes → MB.
 */
async function detectWindowsRam(
  exec: (cmd: string) => Promise<string>
): Promise<number | null> {
  try {
    const output = await exec("wmic ComputerSystem get TotalPhysicalMemory");
    // Output has a header line "TotalPhysicalMemory" then the value
    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // Find the numeric line
    for (const line of lines) {
      if (/^\d+$/.test(line)) {
        const bytes = parseInt(line, 10);
        return Math.round(bytes / (1024 * 1024));
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect system RAM using the appropriate platform strategy.
 */
async function detectSystemRam(
  exec: (cmd: string) => Promise<string>,
  promptForRam?: () => Promise<number>
): Promise<number> {
  const platform = process.platform;

  let ramMb: number | null = null;

  if (platform === "linux") {
    ramMb = await detectLinuxRam(exec);
  } else if (platform === "darwin") {
    ramMb = await detectMacOsRam(exec);
  } else if (platform === "win32") {
    ramMb = await detectWindowsRam(exec);
  }

  if (ramMb !== null) return ramMb;

  // Fallback: prompt user
  if (promptForRam) {
    return await promptForRam();
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects GPU VRAM and system RAM, returning a complete HardwareInfo object.
 *
 * Detection order: NVIDIA → AMD → macOS Metal → fallback (CPU-only).
 */
export async function detectHardware(opts?: GpuDetectorOptions): Promise<HardwareInfo> {
  const safetyMarginPct = opts?.safetyMarginPct ?? 10;
  const exec = opts?.execCommand ?? defaultExecCommand;
  const promptForVram = opts?.promptForVram;
  const promptForRam = opts?.promptForRam;

  // --- GPU detection ---
  let gpuName = "CPU-only";
  let totalVramMb = 0;
  let cpuOnly = true;

  const nvidia = await detectNvidia(exec);
  if (nvidia) {
    gpuName = nvidia.gpuName;
    totalVramMb = nvidia.totalVramMb;
    cpuOnly = false;
  } else {
    const amd = await detectAmd(exec);
    if (amd) {
      gpuName = amd.gpuName;
      totalVramMb = amd.totalVramMb;
      cpuOnly = false;
    } else {
      const metal = await detectMacOsMetal(exec);
      if (metal) {
        gpuName = metal.gpuName;
        totalVramMb = metal.totalVramMb;
        cpuOnly = false;
      } else {
        // Fallback: no GPU detected
        if (promptForVram) {
          totalVramMb = await promptForVram();
          if (totalVramMb > 0) {
            gpuName = "Manual GPU";
            cpuOnly = false;
          }
        }
      }
    }
  }

  // --- VRAM budget ---
  const vramBudgetMb = Math.round(totalVramMb * (1 - safetyMarginPct / 100));

  // --- System RAM detection ---
  const systemRamMb = await detectSystemRam(exec, promptForRam);

  return {
    gpuName,
    totalVramMb,
    safetyMarginPct,
    vramBudgetMb,
    systemRamMb,
    cpuOnly,
  };
}
