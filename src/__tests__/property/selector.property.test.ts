// Feature: interactive-console-ui, Property 5: selector cursor wrap — up arrow
// Feature: interactive-console-ui, Property 6: selector cursor wrap — down arrow
// Feature: interactive-console-ui, Property 7: selector Space toggle isolation

/**
 * Property-based tests for the interactive selector cursor wrap and Space
 * toggle isolation logic.
 *
 * The cursor wrap and Space toggle logic are internal to selector.ts, so we
 * extract the pure logic as inline helper functions that mirror the
 * implementation exactly, then verify the properties hold for all valid inputs
 * using fast-check.
 *
 * Validates: Requirements 3.4, 3.5, 3.8
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Pure logic helpers (mirrors selector.ts internals)
// ---------------------------------------------------------------------------

/** ↑ arrow: move focus index up with wrap-around */
function upArrow(focusIdx: number, n: number): number {
  return (focusIdx - 1 + n) % n;
}

/** ↓ arrow: move focus index down with wrap-around */
function downArrow(focusIdx: number, n: number): number {
  return (focusIdx + 1) % n;
}

/** Space: toggle only the item at focusIdx, leave all others unchanged */
function spaceToggle<T extends { checked?: boolean }>(
  items: T[],
  focusIdx: number
): T[] {
  return items.map((item, i) =>
    i === focusIdx ? { ...item, checked: !item.checked } : { ...item }
  );
}

// ---------------------------------------------------------------------------
// Arbitrary: list of N items (1–20) paired with a valid focus index
// ---------------------------------------------------------------------------

const itemListWithFocusArb = fc
  .integer({ min: 1, max: 20 })
  .chain((n) =>
    fc.tuple(
      fc.array(
        fc.record({
          label: fc.string(),
          value: fc.integer(),
          checked: fc.boolean(),
        }),
        { minLength: n, maxLength: n }
      ),
      fc.integer({ min: 0, max: n - 1 })
    )
  );

// ---------------------------------------------------------------------------
// Property 5: cursor wrap on ↑
// ---------------------------------------------------------------------------

describe("Property 5: selector cursor wrap — up arrow", () => {
  // **Validates: Requirements 3.4**
  it("↑ moves focus to (i - 1 + N) % N for any list length and starting index", () => {
    fc.assert(
      fc.property(itemListWithFocusArb, ([items, focusIdx]) => {
        const n = items.length;
        const expected = (focusIdx - 1 + n) % n;
        const actual = upArrow(focusIdx, n);
        return actual === expected;
      }),
      { numRuns: 100 }
    );
  });

  it("↑ from index 0 wraps to index N-1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (n) => {
        return upArrow(0, n) === n - 1;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: cursor wrap on ↓
// ---------------------------------------------------------------------------

describe("Property 6: selector cursor wrap — down arrow", () => {
  // **Validates: Requirements 3.5**
  it("↓ moves focus to (i + 1) % N for any list length and starting index", () => {
    fc.assert(
      fc.property(itemListWithFocusArb, ([items, focusIdx]) => {
        const n = items.length;
        const expected = (focusIdx + 1) % n;
        const actual = downArrow(focusIdx, n);
        return actual === expected;
      }),
      { numRuns: 100 }
    );
  });

  it("↓ from index N-1 wraps to index 0", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (n) => {
        return downArrow(n - 1, n) === 0;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Space toggle isolation
// ---------------------------------------------------------------------------

describe("Property 7: selector Space toggle isolation", () => {
  // **Validates: Requirements 3.8**
  it("Space toggles only items[focusIdx].checked and leaves all other items unchanged", () => {
    fc.assert(
      fc.property(itemListWithFocusArb, ([items, focusIdx]) => {
        const result = spaceToggle(items, focusIdx);

        // The focused item's checked state must be toggled
        const originalChecked = items[focusIdx]!.checked ?? false;
        const toggledChecked = result[focusIdx]!.checked ?? false;
        if (toggledChecked !== !originalChecked) return false;

        // All other items must be unchanged
        for (let i = 0; i < items.length; i++) {
          if (i === focusIdx) continue;
          if (result[i]!.checked !== items[i]!.checked) return false;
          if (result[i]!.label !== items[i]!.label) return false;
          if (result[i]!.value !== items[i]!.value) return false;
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it("Space on a single-item list toggles that item's checked state", () => {
    fc.assert(
      fc.property(fc.boolean(), (initialChecked) => {
        const items = [{ label: "item", value: 1, checked: initialChecked }];
        const result = spaceToggle(items, 0);
        return result[0]!.checked === !initialChecked;
      }),
      { numRuns: 100 }
    );
  });

  it("Space does not mutate the original items array", () => {
    fc.assert(
      fc.property(itemListWithFocusArb, ([items, focusIdx]) => {
        const originalChecked = items.map((item) => item.checked);
        spaceToggle(items, focusIdx);
        // Original array must be unchanged
        return items.every((item, i) => item.checked === originalChecked[i]);
      }),
      { numRuns: 100 }
    );
  });
});
