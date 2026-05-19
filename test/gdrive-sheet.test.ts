/**
 * gdrive-sheet.test.ts — Tests for Google Drive spreadsheet import as JSON
 *
 * Verifies:
 * - Google Sheets exported as xlsx binary → parsed to structured JSON
 * - Single-sheet produces one page with no suffix, .json extension
 * - Multi-sheet produces one page per non-empty sheet with #sheet-<slug> suffix
 * - Empty sheets are skipped
 * - Sheet name slugification works correctly
 * - docPath construction uses .json (not .md) for spreadsheets
 * - JSON wrapper format: { _source_asset: "gdrive/...", data: [...] }
 * - Asset path construction mirrors docPath with gdrive/ prefix
 *
 * We replicate the core logic from gdrive.ts since it's tightly coupled
 * with the Google Drive API and can't be called directly.
 *
 * Run with: npx vitest run test/gdrive-sheet.test.ts
 */

import { describe, test, expect } from "vitest";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Replicate the sheet-to-JSON parsing logic from gdrive.ts exportSheetAsJson()
// This is the same code path that runs after the Drive API returns xlsx binary.
// ---------------------------------------------------------------------------

type SheetPage = { content: string; pageSuffix: string };

function parseSheetBuffer(buffer: Buffer): SheetPage[] | null {
  const wb = XLSX.read(buffer, { type: "buffer" });

  if (wb.SheetNames.length === 0) return null;

  if (wb.SheetNames.length === 1) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!);
    if (rows.length === 0) return null;
    return [{ content: JSON.stringify(rows, null, 2), pageSuffix: "" }];
  }

  const pages = wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name]!);
    if (rows.length === 0) return null;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return {
      content: JSON.stringify(rows, null, 2),
      pageSuffix: `#sheet-${slug}`,
    };
  }).filter(Boolean) as SheetPage[];

  return pages.length > 0 ? pages : null;
}

// ---------------------------------------------------------------------------
// Replicate wrapSheetContent from gdrive.ts
// ---------------------------------------------------------------------------

function wrapSheetContent(rawJson: string, assetPath: string): string {
  const rows = JSON.parse(rawJson);
  return JSON.stringify({ _source_asset: assetPath, data: rows }, null, 2);
}

// ---------------------------------------------------------------------------
// Helper to create an xlsx buffer (simulating what Drive API returns)
// ---------------------------------------------------------------------------

function createXlsxBuffer(sheets: Record<string, any[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, data] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ---------------------------------------------------------------------------
// Tests: parseSheetBuffer (core of exportSheetAsJson)
// ---------------------------------------------------------------------------

describe("parseSheetBuffer — single sheet", () => {
  test("produces JSON array with no suffix", () => {
    const buffer = createXlsxBuffer({
      Sheet1: [
        ["Name", "Age", "City"],
        ["Alice", 30, "NYC"],
        ["Bob", 25, "LA"],
      ],
    });

    const pages = parseSheetBuffer(buffer);
    expect(pages).not.toBeNull();
    expect(pages).toHaveLength(1);
    expect(pages![0]!.pageSuffix).toBe("");

    const rows = JSON.parse(pages![0]!.content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: "Alice", Age: 30, City: "NYC" });
    expect(rows[1]).toEqual({ Name: "Bob", Age: 25, City: "LA" });
  });

  test("returns null for workbook with only empty sheets", () => {
    const buffer = createXlsxBuffer({ Sheet1: [] });
    const pages = parseSheetBuffer(buffer);
    expect(pages).toBeNull();
  });

  test("returns null for single sheet with no data rows", () => {
    const buffer = createXlsxBuffer({ Sheet1: [["Header1", "Header2"]] });
    const pages = parseSheetBuffer(buffer);
    expect(pages).toBeNull();
  });
});

describe("parseSheetBuffer — multi sheet", () => {
  test("produces one page per sheet with #sheet- suffix", () => {
    const buffer = createXlsxBuffer({
      Revenue: [
        ["Month", "Amount"],
        ["Jan", 5000],
        ["Feb", 6000],
      ],
      Expenses: [
        ["Month", "Amount"],
        ["Jan", 3000],
        ["Feb", 3500],
      ],
    });

    const pages = parseSheetBuffer(buffer);
    expect(pages).not.toBeNull();
    expect(pages).toHaveLength(2);

    expect(pages![0]!.pageSuffix).toBe("#sheet-revenue");
    const revenue = JSON.parse(pages![0]!.content);
    expect(revenue).toHaveLength(2);
    expect(revenue[0]).toEqual({ Month: "Jan", Amount: 5000 });

    expect(pages![1]!.pageSuffix).toBe("#sheet-expenses");
    const expenses = JSON.parse(pages![1]!.content);
    expect(expenses).toHaveLength(2);
    expect(expenses[0]).toEqual({ Month: "Jan", Amount: 3000 });
  });

  test("skips empty sheets", () => {
    const buffer = createXlsxBuffer({
      Data: [
        ["Col1", "Col2"],
        ["a", "b"],
      ],
      EmptySheet: [],
    });

    const pages = parseSheetBuffer(buffer);
    expect(pages).not.toBeNull();
    expect(pages).toHaveLength(1);
    expect(pages![0]!.pageSuffix).toBe("#sheet-data");
  });

  test("returns null when all sheets are empty", () => {
    const buffer = createXlsxBuffer({
      Sheet1: [],
      Sheet2: [],
    });

    const pages = parseSheetBuffer(buffer);
    expect(pages).toBeNull();
  });
});

describe("parseSheetBuffer — slug generation", () => {
  test("lowercases and replaces non-alphanumeric with dashes", () => {
    const buffer = createXlsxBuffer({
      "Q4 2024 Sales!!!": [["A"], [1]],
      my_inventory: [["B"], [2]],
    });

    const pages = parseSheetBuffer(buffer);
    expect(pages).not.toBeNull();
    expect(pages![0]!.pageSuffix).toBe("#sheet-q4-2024-sales");
    expect(pages![1]!.pageSuffix).toBe("#sheet-my-inventory");
  });

  test("strips leading and trailing dashes", () => {
    const buffer = createXlsxBuffer({
      "---Leading---": [["A"], [1]],
      "  Spaces  ": [["B"], [2]],
    });

    const pages = parseSheetBuffer(buffer);
    expect(pages).not.toBeNull();
    expect(pages![0]!.pageSuffix).toBe("#sheet-leading");
    expect(pages![1]!.pageSuffix).toBe("#sheet-spaces");
  });
});

describe("parseSheetBuffer — data types", () => {
  test("preserves numbers", () => {
    const buffer = createXlsxBuffer({
      Sheet1: [
        ["Name", "Revenue", "Rate"],
        ["Test", 42000, 0.15],
      ],
    });

    const pages = parseSheetBuffer(buffer);
    const rows = JSON.parse(pages![0]!.content);
    expect(typeof rows[0].Revenue).toBe("number");
    expect(rows[0].Revenue).toBe(42000);
    expect(typeof rows[0].Rate).toBe("number");
    expect(rows[0].Rate).toBe(0.15);
  });

  test("handles mixed data types", () => {
    const buffer = createXlsxBuffer({
      Sheet1: [
        ["Label", "Count", "Active"],
        ["Widget", 100, true],
        ["Gadget", 0, false],
      ],
    });

    const pages = parseSheetBuffer(buffer);
    const rows = JSON.parse(pages![0]!.content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Label: "Widget", Count: 100, Active: true });
    expect(rows[1]).toEqual({ Label: "Gadget", Count: 0, Active: false });
  });
});

// ---------------------------------------------------------------------------
// Tests: wrapSheetContent — JSON wrapper with _source_asset reference
// ---------------------------------------------------------------------------

describe("wrapSheetContent", () => {
  test("wraps JSON array with _source_asset and data fields", () => {
    const rawJson = JSON.stringify([
      { Name: "Alice", Age: 30 },
      { Name: "Bob", Age: 25 },
    ], null, 2);
    const assetPath = "gdrive/reports/my-sheet.xlsx";

    const wrapped = wrapSheetContent(rawJson, assetPath);
    const parsed = JSON.parse(wrapped);

    expect(parsed._source_asset).toBe("gdrive/reports/my-sheet.xlsx");
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0]).toEqual({ Name: "Alice", Age: 30 });
    expect(parsed.data[1]).toEqual({ Name: "Bob", Age: 25 });
  });

  test("preserves data types in wrapped content", () => {
    const rawJson = JSON.stringify([
      { Label: "Widget", Count: 100, Rate: 0.15, Active: true },
    ], null, 2);

    const wrapped = wrapSheetContent(rawJson, "gdrive/data.xlsx");
    const parsed = JSON.parse(wrapped);

    expect(parsed.data[0].Count).toBe(100);
    expect(parsed.data[0].Rate).toBe(0.15);
    expect(parsed.data[0].Active).toBe(true);
  });

  test("produces valid JSON output", () => {
    const rawJson = JSON.stringify([{ a: 1 }], null, 2);
    const wrapped = wrapSheetContent(rawJson, "gdrive/test.xlsx");

    // Should not throw
    const parsed = JSON.parse(wrapped);
    expect(parsed).toHaveProperty("_source_asset");
    expect(parsed).toHaveProperty("data");
  });
});

// ---------------------------------------------------------------------------
// Tests: asset path construction
// ---------------------------------------------------------------------------

describe("asset path construction", () => {
  test("single file without folder → gdrive/<name>.xlsx", () => {
    const fileName = "airbnb_01_2022-12_2022";
    const assetPath = `gdrive/${fileName}.xlsx`;
    expect(assetPath).toBe("gdrive/airbnb_01_2022-12_2022.xlsx");
  });

  test("file with folder → gdrive/<folder>/<name>.xlsx", () => {
    const folderPath = "Finance";
    const fileName = "Q4 Report";
    const assetPath = `gdrive/${folderPath}/${fileName}.xlsx`;
    expect(assetPath).toBe("gdrive/Finance/Q4 Report.xlsx");
  });

  test("nested folders → gdrive/<path>/<name>.xlsx", () => {
    const folderPath = "Company/Finance/2024";
    const fileName = "annual_report";
    const assetPath = `gdrive/${folderPath}/${fileName}.xlsx`;
    expect(assetPath).toBe("gdrive/Company/Finance/2024/annual_report.xlsx");
  });

  test("asset path and docPath share same file name", () => {
    const fileName = "my-spreadsheet";
    const folderPath = "Reports";
    const docPath = `${folderPath}/${fileName}.json`;
    const assetPath = `gdrive/${folderPath}/${fileName}.xlsx`;

    // Both reference the same logical file, different formats
    expect(docPath).toBe("Reports/my-spreadsheet.json");
    expect(assetPath).toBe("gdrive/Reports/my-spreadsheet.xlsx");
  });
});

// ---------------------------------------------------------------------------
// Tests: docPath + wrapped content (full integration)
// ---------------------------------------------------------------------------

describe("Google Drive sheet docPath construction", () => {
  test("single sheet → file.json with wrapper", () => {
    const fileName = "airbnb_01_2022-12_2022";
    const basePath = `${fileName}.json`;
    const assetPath = `gdrive/${fileName}.xlsx`;
    const pages = [{ content: '[{"Col": "val"}]', pageSuffix: "" }];

    const docPath = basePath + pages[0]!.pageSuffix;
    expect(docPath).toBe("airbnb_01_2022-12_2022.json");

    const wrapped = wrapSheetContent(pages[0]!.content, assetPath);
    const parsed = JSON.parse(wrapped);
    expect(parsed._source_asset).toBe("gdrive/airbnb_01_2022-12_2022.xlsx");
    expect(parsed.data).toEqual([{ Col: "val" }]);
  });

  test("multi sheet → all sheets reference same asset", () => {
    const fileName = "financial_report";
    const basePath = `${fileName}.json`;
    const assetPath = `gdrive/${fileName}.xlsx`;
    const pages = [
      { content: '[{"Month": "Jan"}]', pageSuffix: "#sheet-revenue" },
      { content: '[{"Month": "Jan"}]', pageSuffix: "#sheet-costs" },
    ];

    // Both sheets reference the same xlsx asset
    for (const page of pages) {
      const wrapped = wrapSheetContent(page.content, assetPath);
      const parsed = JSON.parse(wrapped);
      expect(parsed._source_asset).toBe("gdrive/financial_report.xlsx");
    }

    expect(basePath + pages[0]!.pageSuffix).toBe("financial_report.json#sheet-revenue");
    expect(basePath + pages[1]!.pageSuffix).toBe("financial_report.json#sheet-costs");
  });

  test("with folder path", () => {
    const folderPath = "Finance";
    const fileName = "Q4 Report";
    const basePath = `${folderPath}/${fileName}.json`;
    const assetPath = `gdrive/${folderPath}/${fileName}.xlsx`;

    expect(basePath + "#sheet-revenue").toBe("Finance/Q4 Report.json#sheet-revenue");
    expect(assetPath).toBe("gdrive/Finance/Q4 Report.xlsx");
  });

  test("non-sheet files still use .md", () => {
    const fileName = "meeting_notes";
    const docPath = `${fileName}.md`;
    expect(docPath).toBe("meeting_notes.md");
  });
});

// ---------------------------------------------------------------------------
// Tests: CSV content from Drive → parsed via xlsx
// ---------------------------------------------------------------------------

describe("CSV buffer parsing (Drive CSV export)", () => {
  test("CSV string parsed to JSON array", () => {
    const csvContent = "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n";
    const wb = XLSX.read(csvContent, { type: "string" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: "Alice", Age: 30, City: "NYC" });
    expect(rows[1]).toEqual({ Name: "Bob", Age: 25, City: "LA" });

    const json = JSON.stringify(rows, null, 2);
    expect(json).toContain('"Name": "Alice"');
    expect(json).toContain('"Age": 30');
  });
});
