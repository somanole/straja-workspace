/**
 * presentations.test.ts — Unit tests for PresentationSpecSchema and buildPptxBuffer.
 *
 * Validates spec parsing, all slide types, and PPTX generation (magic bytes check).
 */

import { describe, test, expect } from "vitest";
import {
  PresentationSpecSchema,
  SlideSchema,
  buildPptxBuffer,
  type PresentationSpec,
} from "../src/presentations.js";

const TINY_PNG_DATA_URI =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c7FoAAAAASUVORK5CYII=";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid spec: one title slide */
function minimalSpec(): PresentationSpec {
  return PresentationSpecSchema.parse({
    title: "Test Deck",
    slides: [{ type: "title", title: "Hello World" }],
  });
}

/** Full spec exercising every slide type */
function fullSpec(): PresentationSpec {
  return PresentationSpecSchema.parse({
    title: "Full Feature Deck",
    subtitle: "Testing all slide types",
    author: "Test Suite",
    theme: {
      primaryColor: "003366",
      secondaryColor: "FF6600",
      backgroundColor: "F5F5F5",
      fontFace: "Arial",
      fontSize: 16,
    },
    slides: [
      { type: "title", title: "Welcome", subtitle: "An intro slide", notes: "Speaker notes here" },
      {
        type: "bullets",
        title: "Key Points",
        bullets: ["First point", "Second point", "Third point"],
        notes: "Bullet notes",
      },
      {
        type: "two_col",
        title: "Comparison",
        left: { title: "Pros", bullets: ["Fast", "Cheap"] },
        right: { title: "Cons", bullets: ["Complex", "Fragile"] },
      },
      {
        type: "image",
        title: "Architecture Diagram",
        image: { caption: "System overview" },
      },
      {
        type: "table",
        title: "Metrics",
        table: {
          headers: ["Metric", "Value", "Target"],
          rows: [
            ["Latency", "45ms", "<100ms"],
            ["Uptime", "99.9%", "99.5%"],
          ],
        },
      },
    ],
  });
}

function hasEmbeddedImage(buffer: Buffer): boolean {
  return /ppt\/media\/[^/]+\.(png|jpe?g|gif|webp|bmp|svg)/i.test(buffer.toString("latin1"));
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("PresentationSpecSchema", () => {
  test("parses minimal valid spec", () => {
    const spec = minimalSpec();
    expect(spec.title).toBe("Test Deck");
    expect(spec.slides).toHaveLength(1);
    expect(spec.slides[0].type).toBe("title");
  });

  test("applies theme defaults when theme is omitted", () => {
    const spec = PresentationSpecSchema.parse({
      title: "No Theme",
      slides: [{ type: "title", title: "X" }],
    });
    // theme is optional; when omitted it should be undefined (defaults applied at build time)
    expect(spec.theme).toBeUndefined();
  });

  test("applies theme defaults when theme is empty object", () => {
    const spec = PresentationSpecSchema.parse({
      title: "Partial Theme",
      slides: [{ type: "title", title: "X" }],
      theme: {},
    });
    expect(spec.theme!.primaryColor).toBe("0B5394");
    expect(spec.theme!.fontFace).toBe("Helvetica");
    expect(spec.theme!.fontSize).toBe(18);
  });

  test("parses full spec with all slide types", () => {
    const spec = fullSpec();
    expect(spec.slides).toHaveLength(5);
    expect(spec.author).toBe("Test Suite");
    expect(spec.theme!.primaryColor).toBe("003366");
  });

  test("rejects spec with no slides", () => {
    expect(() =>
      PresentationSpecSchema.parse({ title: "Empty", slides: [] }),
    ).toThrow();
  });

  test("rejects spec with too many slides (>100)", () => {
    const slides = Array.from({ length: 101 }, (_, i) => ({
      type: "bullets" as const,
      title: `Slide ${i}`,
      bullets: ["x"],
    }));
    expect(() =>
      PresentationSpecSchema.parse({ title: "Too Many", slides }),
    ).toThrow();
  });

  test("rejects spec missing title", () => {
    expect(() =>
      PresentationSpecSchema.parse({ slides: [{ type: "title", title: "X" }] }),
    ).toThrow();
  });

  test("rejects unknown slide type", () => {
    expect(() =>
      SlideSchema.parse({ type: "unknown_type", title: "X" }),
    ).toThrow();
  });

  test("allows 100 slides (boundary)", () => {
    const slides = Array.from({ length: 100 }, () => ({
      type: "title" as const,
      title: "Slide",
    }));
    const spec = PresentationSpecSchema.parse({ title: "Max", slides });
    expect(spec.slides).toHaveLength(100);
  });
});

describe("SlideSchema", () => {
  test("parses title slide", () => {
    const slide = SlideSchema.parse({ type: "title", title: "Hello", subtitle: "World" });
    expect(slide.type).toBe("title");
    expect(slide.subtitle).toBe("World");
  });

  test("parses bullets slide", () => {
    const slide = SlideSchema.parse({
      type: "bullets",
      title: "Points",
      bullets: ["A", "B"],
    });
    expect(slide.bullets).toEqual(["A", "B"]);
  });

  test("parses two_col slide", () => {
    const slide = SlideSchema.parse({
      type: "two_col",
      title: "Compare",
      left: { bullets: ["L1"] },
      right: { title: "Right", bullets: ["R1", "R2"] },
    });
    expect(slide.left!.bullets).toEqual(["L1"]);
    expect(slide.right!.title).toBe("Right");
  });

  test("parses image slide with data URI", () => {
    const slide = SlideSchema.parse({
      type: "image",
      title: "Photo",
      image: { data: "data:image/png;base64,iVBOR...", caption: "A photo", fit: "cover" },
    });
    expect(slide.image!.fit).toBe("cover");
  });

  test("parses table slide", () => {
    const slide = SlideSchema.parse({
      type: "table",
      table: { headers: ["A", "B"], rows: [["1", "2"]] },
    });
    expect(slide.table!.headers).toEqual(["A", "B"]);
    expect(slide.table!.rows).toHaveLength(1);
  });

  test("image fit defaults to contain", () => {
    const slide = SlideSchema.parse({
      type: "image",
      image: { data: "data:image/png;base64,..." },
    });
    expect(slide.image!.fit).toBe("contain");
  });
});

// ---------------------------------------------------------------------------
// PPTX buffer generation
// ---------------------------------------------------------------------------

describe("buildPptxBuffer", () => {
  test("generates a valid PPTX buffer (ZIP magic bytes)", async () => {
    const spec = minimalSpec();
    const buffer = await buildPptxBuffer(spec);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    // PPTX is a ZIP file — first two bytes are "PK" (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  test("generates buffer for full spec with all slide types", async () => {
    const spec = fullSpec();
    const buffer = await buildPptxBuffer(spec);

    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    // Full deck should be larger than minimal
    expect(buffer.length).toBeGreaterThan(1000);
  });

  test("title slide only", async () => {
    const spec = PresentationSpecSchema.parse({
      title: "Title Only",
      slides: [{ type: "title", title: "Main Title", subtitle: "Subtitle Text" }],
    });
    const buffer = await buildPptxBuffer(spec);
    expect(buffer[0]).toBe(0x50);
  });

  test("bullets slide", async () => {
    const spec = PresentationSpecSchema.parse({
      title: "Bullets",
      slides: [
        {
          type: "bullets",
          title: "Key Points",
          bullets: ["Alpha", "Beta", "Gamma"],
          notes: "Speaker notes",
        },
      ],
    });
    const buffer = await buildPptxBuffer(spec);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("two_col slide", async () => {
    const spec = PresentationSpecSchema.parse({
      title: "Two Columns",
      slides: [
        {
          type: "two_col",
          title: "Left vs Right",
          left: { title: "Left", bullets: ["L1", "L2"] },
          right: { title: "Right", bullets: ["R1", "R2", "R3"] },
        },
      ],
    });
    const buffer = await buildPptxBuffer(spec);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("table slide", async () => {
    const spec = PresentationSpecSchema.parse({
      title: "Tables",
      slides: [
        {
          type: "table",
          title: "Data",
          table: {
            headers: ["Name", "Score"],
            rows: [
              ["Alice", "95"],
              ["Bob", "87"],
            ],
          },
        },
      ],
    });
    const buffer = await buildPptxBuffer(spec);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("image slide without data (caption only)", async () => {
    const spec = PresentationSpecSchema.parse({
      title: "Image",
      slides: [
        {
          type: "image",
          title: "Architecture",
          image: { caption: "System diagram" },
        },
      ],
    });
    const buffer = await buildPptxBuffer(spec);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("image slide with data URI embeds media", async () => {
    const spec = PresentationSpecSchema.parse({
      title: "Image With Asset",
      slides: [
        {
          type: "image",
          title: "Architecture",
          image: { data: TINY_PNG_DATA_URI, caption: "System diagram" },
        },
      ],
    });

    const buffer = await buildPptxBuffer(spec);
    expect(buffer.length).toBeGreaterThan(0);
    expect(hasEmbeddedImage(buffer)).toBe(true);
  });

  test("custom theme is applied", async () => {
    const spec = PresentationSpecSchema.parse({
      title: "Themed",
      author: "Tester",
      theme: { primaryColor: "FF0000", fontFace: "Courier" },
      slides: [{ type: "title", title: "Red Theme" }],
    });
    const buffer = await buildPptxBuffer(spec);
    // We can't inspect internal XML easily, but we verify it doesn't crash
    expect(buffer[0]).toBe(0x50);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("many slides", async () => {
    const slides = Array.from({ length: 20 }, (_, i) => ({
      type: "bullets" as const,
      title: `Slide ${i + 1}`,
      bullets: [`Point A of slide ${i + 1}`, `Point B of slide ${i + 1}`],
    }));
    const spec = PresentationSpecSchema.parse({
      title: "Large Deck",
      slides,
    });
    const buffer = await buildPptxBuffer(spec);
    expect(buffer.length).toBeGreaterThan(5000);
  });
});
