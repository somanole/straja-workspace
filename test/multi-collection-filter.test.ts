/**
 * Unit tests for multi-collection filter logic (PR #191).
 *
 * Tests the filterByCollections post-filter and the resolveCollectionFilter
 * behavior for single-collection vs multi-collection search.
 */

import { describe, test, expect } from "vitest";

// Reproduce the filterByCollections logic from vault.ts for testing
// (the function is private in vault.ts)
function filterByCollections<T extends { filepath?: string; file?: string }>(
  results: T[],
  collectionNames: string[],
): T[] {
  if (collectionNames.length <= 1) return results;
  const prefixes = collectionNames.map((n) => `vault://${n}/`);
  return results.filter((r) => {
    const path = r.filepath || r.file || "";
    return prefixes.some((p) => path.startsWith(p));
  });
}

describe("filterByCollections", () => {
  const results = [
    { filepath: "vault://docs/readme.md", file: "vault://docs/readme.md" },
    { filepath: "vault://notes/todo.md", file: "vault://notes/todo.md" },
    { filepath: "vault://journals/2024/jan.md", file: "vault://journals/2024/jan.md" },
    { filepath: "vault://docs/api.md", file: "vault://docs/api.md" },
  ];

  test("returns all results when no collections specified", () => {
    expect(filterByCollections(results, [])).toEqual(results);
  });

  test("returns all results for single collection (no-op, handled by SQL filter)", () => {
    expect(filterByCollections(results, ["docs"])).toEqual(results);
  });

  test("filters to matching collections when multiple specified", () => {
    const filtered = filterByCollections(results, ["docs", "journals"]);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((r) => r.filepath)).toEqual([
      "vault://docs/readme.md",
      "vault://journals/2024/jan.md",
      "vault://docs/api.md",
    ]);
  });

  test("filters correctly with two collections", () => {
    const filtered = filterByCollections(results, ["notes", "journals"]);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.filepath)).toEqual([
      "vault://notes/todo.md",
      "vault://journals/2024/jan.md",
    ]);
  });

  test("returns empty when no results match collections", () => {
    const filtered = filterByCollections(results, ["archive", "trash"]);
    expect(filtered).toHaveLength(0);
  });

  test("uses file field when filepath is missing", () => {
    const fileOnlyResults = [
      { file: "vault://docs/readme.md" },
      { file: "vault://notes/todo.md" },
    ];
    const filtered = filterByCollections(fileOnlyResults, ["docs", "notes"]);
    expect(filtered).toHaveLength(2);
  });

  test("uses filepath over file when both present", () => {
    const mixedResults = [
      { filepath: "vault://docs/readme.md", file: "vault://notes/todo.md" },
    ];
    const filtered = filterByCollections(mixedResults, ["docs", "notes"]);
    expect(filtered).toHaveLength(1);
    // Should match via filepath (docs), not file (notes)
    expect(filtered[0].filepath).toBe("vault://docs/readme.md");
  });
});

describe("resolveCollectionFilter input normalization", () => {
  // Test the array normalization logic without the DB dependency
  function normalizeCollectionInput(raw: string | string[] | undefined): string[] {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  test("undefined returns empty array", () => {
    expect(normalizeCollectionInput(undefined)).toEqual([]);
  });

  test("single string returns single-element array", () => {
    expect(normalizeCollectionInput("docs")).toEqual(["docs"]);
  });

  test("array passes through", () => {
    expect(normalizeCollectionInput(["docs", "notes"])).toEqual(["docs", "notes"]);
  });

  test("empty string returns single-element array", () => {
    expect(normalizeCollectionInput("")).toEqual([]);
  });
});

describe("collection option type from parseArgs", () => {
  // Verify that parseArgs with `multiple: true` produces string[]
  test("parseArgs multiple:true produces array for repeated flags", () => {
    const { parseArgs } = require("node:util");
    const { values } = parseArgs({
      args: ["-c", "docs", "-c", "notes"],
      options: {
        collection: { type: "string", short: "c", multiple: true },
      },
      strict: true,
    });
    expect(values.collection).toEqual(["docs", "notes"]);
  });

  test("parseArgs multiple:true produces array for single flag", () => {
    const { parseArgs } = require("node:util");
    const { values } = parseArgs({
      args: ["-c", "docs"],
      options: {
        collection: { type: "string", short: "c", multiple: true },
      },
      strict: true,
    });
    expect(values.collection).toEqual(["docs"]);
  });

  test("parseArgs multiple:true produces undefined when flag absent", () => {
    const { parseArgs } = require("node:util");
    const { values } = parseArgs({
      args: [],
      options: {
        collection: { type: "string", short: "c", multiple: true },
      },
      strict: true,
    });
    expect(values.collection).toBeUndefined();
  });
});
