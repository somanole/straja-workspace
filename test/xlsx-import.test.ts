/**
 * xlsx-import.test.ts — Tests for spreadsheet import (xlsx, xls, csv)
 *
 * Verifies:
 * - extractText() converts xlsx to JSON arrays per sheet
 * - Multi-sheet files produce one ExtractedPage per sheet with #sheet- suffix
 * - Single-sheet files produce one ExtractedPage with no suffix
 * - CSV files are converted to JSON arrays
 * - rewriteSpreadsheetExt() changes .xlsx/.xls/.csv to .json
 * - handelize() + rewriteSpreadsheetExt() produces correct doc paths
 *
 * Run with: npx vitest run test/xlsx-import.test.ts
 */

import { describe, test, expect } from "vitest";
import { handelize } from "../src/store.js";
import * as XLSX from "xlsx";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Replicate the functions from vault.ts since they aren't exported
// ---------------------------------------------------------------------------

type ExtractedPage = { content: string; pageSuffix: string; pageNum?: number };

function rewriteSpreadsheetExt(docPath: string): string {
  return docPath.replace(/\.(xlsx|xls|csv)$/i, ".json");
}

async function extractText(filepath: string): Promise<ExtractedPage[]> {
  const ext = filepath.slice(filepath.lastIndexOf('.')).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.readFile(filepath);
    if (wb.SheetNames.length === 0) {
      return [{ content: "", pageSuffix: "" }];
    }
    if (wb.SheetNames.length === 1) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!);
      return [{ content: JSON.stringify(rows, null, 2), pageSuffix: "" }];
    }
    return wb.SheetNames
      .map((name) => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name]!);
        if (rows.length === 0) return null;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return {
          content: JSON.stringify(rows, null, 2),
          pageSuffix: `#sheet-${slug}`,
        };
      })
      .filter(Boolean) as ExtractedPage[];
  }

  if (ext === '.csv') {
    const wb = XLSX.readFile(filepath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!);
    return [{ content: JSON.stringify(rows, null, 2), pageSuffix: "" }];
  }

  throw new Error(`Unsupported extension: ${ext}`);
}

// ---------------------------------------------------------------------------
// Test helpers — create real xlsx/csv files on disk
// ---------------------------------------------------------------------------

let tmpDir: string;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), "vault-xlsx-test-"));
}

function teardown() {
  rmSync(tmpDir, { recursive: true, force: true });
}

function createXlsx(filename: string, sheets: Record<string, any[][]>): string {
  const wb = XLSX.utils.book_new();
  for (const [name, data] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const filepath = join(tmpDir, filename);
  XLSX.writeFile(wb, filepath);
  return filepath;
}

function createCsv(filename: string, content: string): string {
  const filepath = join(tmpDir, filename);
  writeFileSync(filepath, content, "utf-8");
  return filepath;
}

// ---------------------------------------------------------------------------
// Tests: rewriteSpreadsheetExt
// ---------------------------------------------------------------------------

describe("rewriteSpreadsheetExt", () => {
  test("converts .xlsx to .json", () => {
    expect(rewriteSpreadsheetExt("report.xlsx")).toBe("report.json");
  });

  test("converts .xls to .json", () => {
    expect(rewriteSpreadsheetExt("data.xls")).toBe("data.json");
  });

  test("converts .csv to .json", () => {
    expect(rewriteSpreadsheetExt("export.csv")).toBe("data.json".replace("data", "export"));
    expect(rewriteSpreadsheetExt("export.csv")).toBe("export.json");
  });

  test("preserves non-spreadsheet extensions", () => {
    expect(rewriteSpreadsheetExt("readme.md")).toBe("readme.md");
    expect(rewriteSpreadsheetExt("doc.pdf")).toBe("doc.pdf");
    expect(rewriteSpreadsheetExt("notes.txt")).toBe("notes.txt");
  });

  test("handles paths with directories", () => {
    expect(rewriteSpreadsheetExt("folder/sub/report.xlsx")).toBe("folder/sub/report.json");
  });

  test("case insensitive", () => {
    expect(rewriteSpreadsheetExt("REPORT.XLSX")).toBe("REPORT.json");
    expect(rewriteSpreadsheetExt("Data.XLS")).toBe("Data.json");
  });
});

// ---------------------------------------------------------------------------
// Tests: handelize + rewriteSpreadsheetExt integration
// ---------------------------------------------------------------------------

describe("handelize + rewriteSpreadsheetExt", () => {
  test("xlsx file gets .json path", () => {
    const path = handelize("My Report.xlsx");
    const final = rewriteSpreadsheetExt(path);
    expect(final).toBe("my-report.json");
  });

  test("csv file gets .json path", () => {
    const path = handelize("export-2024.csv");
    const final = rewriteSpreadsheetExt(path);
    expect(final).toBe("export-2024.json");
  });

  test("nested xlsx gets .json path", () => {
    const path = handelize("Finance/Q4 Sales.xlsx");
    const final = rewriteSpreadsheetExt(path);
    expect(final).toBe("finance/q4-sales.json");
  });

  test("md file is not affected", () => {
    const path = handelize("notes.md");
    const final = rewriteSpreadsheetExt(path);
    expect(final).toBe("notes.md");
  });
});

// ---------------------------------------------------------------------------
// Tests: extractText for xlsx
// ---------------------------------------------------------------------------

describe("extractText — xlsx", () => {
  test("single-sheet xlsx produces JSON array with no suffix", async () => {
    setup();
    try {
      const filepath = createXlsx("single.xlsx", {
        "Sheet1": [
          ["Name", "Age", "City"],
          ["Alice", 30, "NYC"],
          ["Bob", 25, "LA"],
        ],
      });

      const pages = await extractText(filepath);
      expect(pages).toHaveLength(1);
      expect(pages[0]!.pageSuffix).toBe("");

      const rows = JSON.parse(pages[0]!.content);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ Name: "Alice", Age: 30, City: "NYC" });
      expect(rows[1]).toEqual({ Name: "Bob", Age: 25, City: "LA" });
    } finally {
      teardown();
    }
  });

  test("multi-sheet xlsx produces one page per sheet with #sheet- suffix", async () => {
    setup();
    try {
      const filepath = createXlsx("multi.xlsx", {
        "Sales": [
          ["Product", "Revenue"],
          ["Widget", 5000],
          ["Gadget", 3000],
        ],
        "Inventory": [
          ["Item", "Stock"],
          ["Widget", 150],
          ["Gadget", 80],
        ],
      });

      const pages = await extractText(filepath);
      expect(pages).toHaveLength(2);

      // First sheet
      expect(pages[0]!.pageSuffix).toBe("#sheet-sales");
      const sales = JSON.parse(pages[0]!.content);
      expect(sales).toHaveLength(2);
      expect(sales[0]).toEqual({ Product: "Widget", Revenue: 5000 });

      // Second sheet
      expect(pages[1]!.pageSuffix).toBe("#sheet-inventory");
      const inventory = JSON.parse(pages[1]!.content);
      expect(inventory).toHaveLength(2);
      expect(inventory[0]).toEqual({ Item: "Widget", Stock: 150 });
    } finally {
      teardown();
    }
  });

  test("empty sheets are skipped in multi-sheet files", async () => {
    setup();
    try {
      const filepath = createXlsx("partial.xlsx", {
        "Data": [
          ["Col1", "Col2"],
          ["a", "b"],
        ],
        "EmptySheet": [],
      });

      const pages = await extractText(filepath);
      // EmptySheet has no rows, so only Data appears
      // But single remaining sheet still has pageSuffix since workbook has 2 sheets
      expect(pages).toHaveLength(1);
      expect(pages[0]!.pageSuffix).toBe("#sheet-data");
    } finally {
      teardown();
    }
  });

  test("sheet name slugification", async () => {
    setup();
    try {
      const filepath = createXlsx("slugs.xlsx", {
        "Q4 2024 Sales!!!": [["A"], [1]],
        "my_inventory": [["B"], [2]],
      });

      const pages = await extractText(filepath);
      expect(pages[0]!.pageSuffix).toBe("#sheet-q4-2024-sales");
      expect(pages[1]!.pageSuffix).toBe("#sheet-my-inventory");
    } finally {
      teardown();
    }
  });

  test("numbers and dates are preserved as native types", async () => {
    setup();
    try {
      const filepath = createXlsx("types.xlsx", {
        "Sheet1": [
          ["Name", "Amount", "Rate"],
          ["Test", 42000, 0.15],
        ],
      });

      const pages = await extractText(filepath);
      const rows = JSON.parse(pages[0]!.content);
      expect(typeof rows[0].Amount).toBe("number");
      expect(rows[0].Amount).toBe(42000);
      expect(typeof rows[0].Rate).toBe("number");
      expect(rows[0].Rate).toBe(0.15);
    } finally {
      teardown();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: extractText for csv
// ---------------------------------------------------------------------------

describe("extractText — csv", () => {
  test("csv produces JSON array", async () => {
    setup();
    try {
      const filepath = createCsv("data.csv", "Name,Age\nAlice,30\nBob,25\n");

      const pages = await extractText(filepath);
      expect(pages).toHaveLength(1);
      expect(pages[0]!.pageSuffix).toBe("");

      const rows = JSON.parse(pages[0]!.content);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ Name: "Alice", Age: 30 });
      expect(rows[1]).toEqual({ Name: "Bob", Age: 25 });
    } finally {
      teardown();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: full document path (simulating indexFiles flow)
// ---------------------------------------------------------------------------

describe("full import path simulation", () => {
  test("xlsx file → handelize → rewrite → docPath + pageSuffix", async () => {
    setup();
    try {
      const filepath = createXlsx("Q4 Report.xlsx", {
        "Revenue": [["Month", "Total"], ["Oct", 100]],
        "Costs": [["Month", "Total"], ["Oct", 50]],
      });

      const relativeFile = "Q4 Report.xlsx";
      let path = handelize(relativeFile);
      path = rewriteSpreadsheetExt(path);
      expect(path).toBe("q4-report.json");

      const pages = await extractText(filepath);
      expect(pages).toHaveLength(2);

      const docPath0 = path + pages[0]!.pageSuffix;
      const docPath1 = path + pages[1]!.pageSuffix;
      expect(docPath0).toBe("q4-report.json#sheet-revenue");
      expect(docPath1).toBe("q4-report.json#sheet-costs");

      // Content is valid JSON
      for (const page of pages) {
        const parsed = JSON.parse(page.content);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
      }
    } finally {
      teardown();
    }
  });
});
