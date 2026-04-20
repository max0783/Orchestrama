/**
 * Unit tests for src/console/selector.ts
 *
 * Requirements: 3.6, 3.7, 3.9, 3.11
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  selectOne,
  selectMany,
  SelectorCancelledError,
} from "../../console/selector.js";
import type { SelectItem } from "../../console/selector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItems<T>(values: T[]): SelectItem<T>[] {
  return values.map((v) => ({ label: String(v), value: v }));
}

// ---------------------------------------------------------------------------
// Task 10.1 — selectOne resolves immediately with defaultValue when items is empty
// Requirements: 3.11
// ---------------------------------------------------------------------------

describe("selectOne() — empty items", () => {
  it("resolves with defaultValue when items is empty and defaultValue is provided", async () => {
    const result = await selectOne([], { defaultValue: "fallback" });
    expect(result).toBe("fallback");
  });

  it("resolves with undefined when items is empty and no defaultValue is provided", async () => {
    const result = await selectOne([]);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task 10.2 — selectMany resolves immediately with [] when items is empty
// Requirements: 3.11
// ---------------------------------------------------------------------------

describe("selectMany() — empty items", () => {
  it("resolves with an empty array when items is empty", async () => {
    const result = await selectMany([]);
    expect(result).toEqual([]);
  });

  it("resolves with an empty array even when defaultValue is provided", async () => {
    // selectMany always returns [] for empty items regardless of opts
    const result = await selectMany([], { defaultValue: "ignored" as any });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Shared raw-mode mock setup for tasks 10.3–10.6
// ---------------------------------------------------------------------------

/**
 * Sets up mocks for process.stdin/stdout so the selector can run without a
 * real TTY. Returns a helper that emits a keypress to the captured data
 * listener.
 *
 * `process.stdin.setRawMode` does not exist in non-TTY environments, so we
 * define it as a no-op property before spying on it, then remove it on
 * restore.
 */
function setupRawModeMocks() {
  let capturedListener: ((chunk: Buffer) => void) | null = null;

  // Define setRawMode if it doesn't exist (non-TTY test environment)
  const hadSetRawMode = "setRawMode" in process.stdin;
  if (!hadSetRawMode) {
    (process.stdin as any).setRawMode = (_mode: boolean) => process.stdin;
  }

  const setRawModeSpy = vi.spyOn(process.stdin as any, "setRawMode").mockImplementation((_mode: any) => process.stdin);
  const resumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
  const pauseSpy = vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
  const removeListenerSpy = vi.spyOn(process.stdin, "removeListener").mockImplementation((_event: any, _listener: any) => process.stdin);
  const onSpy = vi.spyOn(process.stdin, "on").mockImplementation((event: string, listener: any) => {
    if (event === "data") {
      capturedListener = listener;
    }
    return process.stdin;
  });
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((_data: any) => true);

  async function emitKey(key: string): Promise<void> {
    // Wait for the selector to attach its listener
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!capturedListener) {
      throw new Error("No data listener was registered on process.stdin");
    }
    capturedListener(Buffer.from(key));
  }

  function restore() {
    setRawModeSpy.mockRestore();
    resumeSpy.mockRestore();
    pauseSpy.mockRestore();
    removeListenerSpy.mockRestore();
    onSpy.mockRestore();
    writeSpy.mockRestore();
    // Remove the synthetic setRawMode if we added it
    if (!hadSetRawMode) {
      delete (process.stdin as any).setRawMode;
    }
    capturedListener = null;
  }

  return { setRawModeSpy, emitKey, restore };
}

// ---------------------------------------------------------------------------
// Task 10.3 — Enter keypress resolves selectOne with the focused item's value
// Requirements: 3.6
// ---------------------------------------------------------------------------

describe("selectOne() — Enter keypress", () => {
  let mocks: ReturnType<typeof setupRawModeMocks>;

  beforeEach(() => {
    mocks = setupRawModeMocks();
  });

  afterEach(() => {
    mocks.restore();
  });

  it("resolves with the first item's value when Enter is pressed immediately", async () => {
    const items = makeItems(["alpha", "beta", "gamma"]);
    const promise = selectOne(items);
    await mocks.emitKey("\r"); // Enter
    const result = await promise;
    expect(result).toBe("alpha");
  });

  it("resolves with a numeric value when Enter is pressed", async () => {
    const items = makeItems([10, 20, 30]);
    const promise = selectOne(items);
    await mocks.emitKey("\r");
    const result = await promise;
    expect(result).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Task 10.4 — Escape resolves with defaultValue when provided
// Requirements: 3.7
// ---------------------------------------------------------------------------

describe("selectOne() — Escape with defaultValue", () => {
  let mocks: ReturnType<typeof setupRawModeMocks>;

  beforeEach(() => {
    mocks = setupRawModeMocks();
  });

  afterEach(() => {
    mocks.restore();
  });

  it("resolves with defaultValue when Escape is pressed and defaultValue is provided", async () => {
    const items = makeItems(["a", "b", "c"]);
    const promise = selectOne(items, { defaultValue: "default" });
    await mocks.emitKey("\x1b"); // Escape
    const result = await promise;
    expect(result).toBe("default");
  });

  it("resolves with numeric defaultValue when Escape is pressed", async () => {
    const items = makeItems([1, 2, 3]);
    const promise = selectOne(items, { defaultValue: 99 });
    await mocks.emitKey("\x1b");
    const result = await promise;
    expect(result).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Task 10.5 — Escape rejects with SelectorCancelledError when no defaultValue
// Requirements: 3.7
// ---------------------------------------------------------------------------

describe("selectOne() — Escape without defaultValue", () => {
  let mocks: ReturnType<typeof setupRawModeMocks>;

  beforeEach(() => {
    mocks = setupRawModeMocks();
  });

  afterEach(() => {
    mocks.restore();
  });

  it("rejects with SelectorCancelledError when Escape is pressed and no defaultValue", async () => {
    const items = makeItems(["x", "y"]);
    const promise = selectOne(items);
    await mocks.emitKey("\x1b");
    await expect(promise).rejects.toBeInstanceOf(SelectorCancelledError);
  });

  it("rejects with a message containing 'cancelled' (case-insensitive)", async () => {
    const items = makeItems(["x"]);
    const promise = selectOne(items);
    await mocks.emitKey("\x1b");
    await expect(promise).rejects.toThrow(/cancelled/i);
  });
});

// ---------------------------------------------------------------------------
// Task 10.6 — setRawMode(true) called on start, setRawMode(false) called on finish
// Requirements: 3.9
// ---------------------------------------------------------------------------

describe("selectOne() — raw mode lifecycle", () => {
  let mocks: ReturnType<typeof setupRawModeMocks>;

  beforeEach(() => {
    mocks = setupRawModeMocks();
  });

  afterEach(() => {
    mocks.restore();
  });

  it("calls setRawMode(true) when the selector starts", async () => {
    const items = makeItems(["one", "two"]);
    const promise = selectOne(items);
    // setRawMode(true) should have been called synchronously during selectOne startup
    expect(mocks.setRawModeSpy).toHaveBeenCalledWith(true);
    // Clean up by pressing Enter
    await mocks.emitKey("\r");
    await promise;
  });

  it("calls setRawMode(false) after Enter is pressed", async () => {
    const items = makeItems(["one", "two"]);
    const promise = selectOne(items);
    await mocks.emitKey("\r");
    await promise;
    expect(mocks.setRawModeSpy).toHaveBeenCalledWith(false);
  });

  it("calls setRawMode(false) after Escape is pressed (with defaultValue)", async () => {
    const items = makeItems(["one", "two"]);
    const promise = selectOne(items, { defaultValue: "one" });
    await mocks.emitKey("\x1b");
    await promise;
    expect(mocks.setRawModeSpy).toHaveBeenCalledWith(false);
  });

  it("calls setRawMode(false) after Escape is pressed (without defaultValue)", async () => {
    const items = makeItems(["one", "two"]);
    const promise = selectOne(items);
    await mocks.emitKey("\x1b");
    await expect(promise).rejects.toBeInstanceOf(SelectorCancelledError);
    expect(mocks.setRawModeSpy).toHaveBeenCalledWith(false);
  });
});
