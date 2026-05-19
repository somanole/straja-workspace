import { describe, expect, test, vi } from "vitest";
import { ReportSpecSchema, buildReportPdfBuffer, renderReportHtml, type ReportSpec } from "../src/reports.js";

const TINY_PNG_DATA_URI =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c7FoAAAAASUVORK5CYII=";

function minimalSpec(): ReportSpec {
  return ReportSpecSchema.parse({
    title: "Weekly Update",
    summary: "Short executive summary.",
    sections: [
      {
        heading: "Highlights",
        blocks: [
          { type: "paragraph", text: "Revenue grew 18% week over week." },
          { type: "bullets", items: ["Pipeline expanded", "Retention remained stable"] },
        ],
      },
    ],
  });
}

function fullSpec(): ReportSpec {
  return ReportSpecSchema.parse({
    title: "Investor Research Brief",
    subtitle: "March 2026",
    author: "Straja Agent",
    date: "March 3, 2026",
    summary: "A concise review of traction, timing, and near-term opportunities.",
    hero: {
      data: TINY_PNG_DATA_URI,
      caption: "Illustrative hero visual",
    },
    closingNote: "Prepared for internal review.",
    sections: [
      {
        heading: "Why Now",
        kicker: "Timing",
        summary: "Three forces are compressing the market window.",
        blocks: [
          {
            type: "metrics",
            items: [
              { label: "Users", value: "12.4K", note: "Up 34% in 90 days" },
              { label: "Gross Margin", value: "71%", note: "Ahead of plan" },
            ],
          },
          { type: "quote", text: "The workflow gap is obvious in every pilot.", attribution: "Design partner" },
          { type: "image", image: { data: TINY_PNG_DATA_URI, caption: "Chart visual" } },
        ],
      },
      {
        heading: "Evidence",
        blocks: [
          {
            type: "table",
            caption: "Recent operating snapshots",
            headers: ["Metric", "Current", "Target"],
            rows: [
              ["Pipeline coverage", "4.2x", "3.0x"],
              ["Sales cycle", "26 days", "<30 days"],
            ],
          },
          { type: "callout", tone: "success", title: "Signal", text: "Pilot accounts are converting without discounting." },
        ],
      },
    ],
  });
}

describe("ReportSpecSchema", () => {
  test("parses a minimal report spec", () => {
    const spec = minimalSpec();
    expect(spec.title).toBe("Weekly Update");
    expect(spec.sections).toHaveLength(1);
  });

  test("applies theme defaults when theme is empty", () => {
    const spec = ReportSpecSchema.parse({
      title: "Theme Defaults",
      theme: {},
      sections: [{ heading: "A", blocks: [{ type: "paragraph", text: "B" }] }],
    });
    expect(spec.theme?.accentColor).toBe("1F4B99");
    expect(spec.theme?.bodyFont).toBe("Aptos");
  });

  test("rejects invalid theme colors", () => {
    const parsed = ReportSpecSchema.safeParse({
      title: "Bad Theme",
      theme: {
        accentColor: "</style><script>alert(1)</script>",
      },
      sections: [{ heading: "A", blocks: [{ type: "paragraph", text: "B" }] }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("renderReportHtml", () => {
  test("renders styled report HTML with escaped content", () => {
    const spec = fullSpec();
    const html = renderReportHtml(spec);

    expect(html).toContain("<title>Investor Research Brief</title>");
    expect(html).toContain("class=\"cover\"");
    expect(html).toContain("Illustrative hero visual");
    expect(html).toContain("Recent operating snapshots");
    expect(html).toContain("tone-success");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("<script>");
  });

  test("falls back to safe default colors and includes a restrictive CSP", () => {
    const spec = minimalSpec();
    spec.theme = { accentColor: "</style><script>alert(1)</script>" } as any;

    const html = renderReportHtml(spec);

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("--accent: #1F4B99;");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<script>");
  });

  test("strips assistant follow-up chatter from report content", () => {
    const spec = minimalSpec();
    spec.summary =
      "A concise planning guide for the Alhambra and surrounding neighborhoods. If you want, I can generate a second version as a one-day Granada itinerary with map-style sequencing, restaurant picks, and photo spots.";
    spec.closingNote = "Let me know if you want me to turn this into a restaurant guide.";
    spec.sections[0]!.blocks = [
      {
        type: "paragraph",
        text: "Book the Nasrid Palaces early and arrive before peak afternoon traffic. If you'd like, I can also build a version with hotel recommendations.",
      },
      {
        type: "bullets",
        items: [
          "Start at the Generalife at opening time.",
          "If you want, I can add a second page with tapas recommendations.",
        ],
      },
    ];

    const html = renderReportHtml(spec);

    expect(html).toContain("A concise planning guide for the Alhambra and surrounding neighborhoods.");
    expect(html).toContain("Book the Nasrid Palaces early and arrive before peak afternoon traffic.");
    expect(html).toContain("Start at the Generalife at opening time.");
    expect(html).not.toContain("If you want, I can generate a second version");
    expect(html).not.toContain("Let me know if you want me to turn this into a restaurant guide.");
    expect(html).not.toContain("If you'd like, I can also build a version with hotel recommendations.");
    expect(html).not.toContain("tapas recommendations");
  });
});

describe("buildReportPdfBuffer", () => {
  test("uses the injected PDF renderer and sanitizes the suggested filename", async () => {
    const renderer = vi.fn(async ({ html, suggestedFilename, title }: any) => {
      expect(title).toBe("Investor Research Brief");
      expect(suggestedFilename).toBe("investor-research-brief.pdf");
      expect(html).toContain("Why Now");
      return Buffer.from("%PDF-1.4\nfake\n");
    });

    const buffer = await buildReportPdfBuffer(fullSpec(), { pdfRenderer: renderer });

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  test("rejects oversized report payloads before rendering", async () => {
    const renderer = vi.fn(async () => Buffer.from("%PDF-1.4\nfake\n"));
    const spec = minimalSpec();
    spec.sections[0]!.blocks = [
      { type: "paragraph", text: "x".repeat(130_000) },
    ];

    await expect(buildReportPdfBuffer(spec, { pdfRenderer: renderer })).rejects.toThrow(
      "Report text is too large",
    );
    expect(renderer).not.toHaveBeenCalled();
  });

  test("rejects reports that become empty after removing assistant chatter", async () => {
    const renderer = vi.fn(async () => Buffer.from("%PDF-1.4\nfake\n"));
    const spec = minimalSpec();
    spec.summary = "If you want, I can generate a second version with restaurant picks.";
    spec.sections[0]!.summary = "Let me know if you'd like a shorter version.";
    spec.sections[0]!.blocks = [
      {
        type: "paragraph",
        text: "If you'd like, I can also turn this into a one-day itinerary.",
      },
    ];

    await expect(buildReportPdfBuffer(spec, { pdfRenderer: renderer })).rejects.toThrow(
      "Report content became empty after removing assistant/meta text",
    );
    expect(renderer).not.toHaveBeenCalled();
  });
});
