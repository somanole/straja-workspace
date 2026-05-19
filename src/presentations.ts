/**
 * Presentation spec schema and PPTX builder.
 *
 * Generates .pptx buffers in-process using PptxGenJS from a structured JSON spec.
 */

import { z } from "zod";

// Lazy-load PptxGenJS (CJS module) via dynamic import to avoid ESM/CJS conflict.
let _PptxGenJS: { new (): Pres } | undefined;
async function getPptxGenJS(): Promise<{ new (): Pres }> {
  if (!_PptxGenJS) {
    const mod = await import("pptxgenjs");
    _PptxGenJS = (mod.default ?? mod) as unknown as { new (): Pres };
  }
  return _PptxGenJS;
}

/** Minimal type for PptxGenJS instance (avoids namespace/type conflicts in .d.ts). */
type Pres = {
  layout: string;
  title: string;
  author: string;
  addSlide: () => Slide;
  write: (opts: { outputType: string }) => Promise<unknown>;
};
type Slide = {
  background: Record<string, unknown>;
  addText: (text: string | Array<{ text: string; options: Record<string, unknown> }>, opts: Record<string, unknown>) => void;
  addImage: (opts: Record<string, unknown>) => void;
  addTable: (data: unknown[], opts: Record<string, unknown>) => void;
  addNotes: (text: string) => void;
};

// ---------------------------------------------------------------------------
// Spec schema
// ---------------------------------------------------------------------------

const ColumnBlockSchema = z.object({
  title: z.string().optional(),
  bullets: z.array(z.string()),
});

const ImageRefSchema = z.object({
  /** Base64-encoded image data (data:image/png;base64,...) or vault path */
  data: z.string().optional(),
  /** Caption below image */
  caption: z.string().optional(),
  /** Sizing mode */
  fit: z.enum(["contain", "cover"]).optional().default("contain"),
});

const TableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

export const SlideSchema = z.object({
  type: z.enum(["title", "bullets", "two_col", "image", "table"]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  left: ColumnBlockSchema.optional(),
  right: ColumnBlockSchema.optional(),
  image: ImageRefSchema.optional(),
  table: TableSchema.optional(),
  notes: z.string().optional(),
});

export const PresentationSpecSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  author: z.string().optional(),
  theme: z.object({
    primaryColor: z.string().optional().default("0B5394"),
    secondaryColor: z.string().optional().default("F28B30"),
    backgroundColor: z.string().optional().default("FFFFFF"),
    fontFace: z.string().optional().default("Helvetica"),
    fontSize: z.number().optional().default(18),
  }).optional(),
  slides: z.array(SlideSchema).min(1).max(100),
});

export type PresentationSpec = z.infer<typeof PresentationSpecSchema>;
export type SlideContent = z.infer<typeof SlideSchema>;

// ---------------------------------------------------------------------------
// Theme defaults
// ---------------------------------------------------------------------------

const DEFAULT_THEME = {
  primaryColor: "0B5394",
  secondaryColor: "F28B30",
  backgroundColor: "FFFFFF",
  fontFace: "Helvetica",
  fontSize: 18,
} as const;

function resolveTheme(spec: PresentationSpec) {
  return { ...DEFAULT_THEME, ...spec.theme };
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

function addTitleSlide(
  pres: Pres,
  slide: SlideContent,
  theme: ReturnType<typeof resolveTheme>,
): void {
  const s = pres.addSlide();
  s.background = { color: theme.primaryColor };

  s.addText(slide.title ?? "", {
    x: 0.8,
    y: 1.5,
    w: "85%",
    h: 1.5,
    fontSize: 36,
    fontFace: theme.fontFace,
    color: "FFFFFF",
    bold: true,
    align: "left",
    valign: "bottom",
  });

  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.8,
      y: 3.2,
      w: "85%",
      h: 0.8,
      fontSize: 20,
      fontFace: theme.fontFace,
      color: "CCCCCC",
      align: "left",
      valign: "top",
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addBulletsSlide(
  pres: Pres,
  slide: SlideContent,
  theme: ReturnType<typeof resolveTheme>,
): void {
  const s = pres.addSlide();
  s.background = { color: theme.backgroundColor };

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.8,
      y: 0.4,
      w: "85%",
      h: 0.8,
      fontSize: 28,
      fontFace: theme.fontFace,
      color: theme.primaryColor,
      bold: true,
    });
  }

  const bullets = slide.bullets ?? [];
  if (bullets.length > 0) {
    s.addText(
      bullets.map((b) => ({
        text: b,
        options: {
          bullet: true,
          fontSize: theme.fontSize,
          fontFace: theme.fontFace,
          color: "333333",
          paraSpaceAfter: 8,
        },
      })),
      { x: 0.8, y: 1.4, w: "85%", h: 4.0, valign: "top" },
    );
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addTwoColSlide(
  pres: Pres,
  slide: SlideContent,
  theme: ReturnType<typeof resolveTheme>,
): void {
  const s = pres.addSlide();
  s.background = { color: theme.backgroundColor };

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.8,
      y: 0.4,
      w: "85%",
      h: 0.8,
      fontSize: 28,
      fontFace: theme.fontFace,
      color: theme.primaryColor,
      bold: true,
    });
  }

  const colY = 1.4;
  const colH = 4.0;

  // Left column
  if (slide.left) {
    const parts: Array<{ text: string; options: Record<string, unknown> }> = [];
    if (slide.left.title) {
      parts.push({
        text: slide.left.title,
        options: {
          fontSize: 20,
          fontFace: theme.fontFace,
          color: theme.primaryColor,
          bold: true,
          paraSpaceAfter: 6,
        },
      });
    }
    for (const b of slide.left.bullets) {
      parts.push({
        text: b,
        options: {
          bullet: true,
          fontSize: theme.fontSize,
          fontFace: theme.fontFace,
          color: "333333",
          paraSpaceAfter: 6,
        },
      });
    }
    s.addText(parts, { x: 0.8, y: colY, w: 4.5, h: colH, valign: "top" });
  }

  // Right column
  if (slide.right) {
    const parts: Array<{ text: string; options: Record<string, unknown> }> = [];
    if (slide.right.title) {
      parts.push({
        text: slide.right.title,
        options: {
          fontSize: 20,
          fontFace: theme.fontFace,
          color: theme.primaryColor,
          bold: true,
          paraSpaceAfter: 6,
        },
      });
    }
    for (const b of slide.right.bullets) {
      parts.push({
        text: b,
        options: {
          bullet: true,
          fontSize: theme.fontSize,
          fontFace: theme.fontFace,
          color: "333333",
          paraSpaceAfter: 6,
        },
      });
    }
    s.addText(parts, { x: 5.6, y: colY, w: 4.5, h: colH, valign: "top" });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addImageSlide(
  pres: Pres,
  slide: SlideContent,
  theme: ReturnType<typeof resolveTheme>,
): void {
  const s = pres.addSlide();
  s.background = { color: theme.backgroundColor };

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.8,
      y: 0.4,
      w: "85%",
      h: 0.8,
      fontSize: 28,
      fontFace: theme.fontFace,
      color: theme.primaryColor,
      bold: true,
    });
  }

  if (slide.image?.data) {
    const imgOpts: Record<string, unknown> = {
      x: 1.5,
      y: 1.4,
      w: 7,
      h: 3.5,
    };
    if (slide.image.data.startsWith("data:")) {
      imgOpts.data = slide.image.data;
    } else {
      imgOpts.path = slide.image.data;
    }
    if (slide.image.fit === "cover") {
      imgOpts.sizing = { type: "cover", w: 7, h: 3.5 };
    } else {
      imgOpts.sizing = { type: "contain", w: 7, h: 3.5 };
    }
    try {
      s.addImage(imgOpts);
    } catch (err: any) {
      throw new Error(
        `Failed to add image for ${slide.title ? `slide "${slide.title}"` : "image slide"}: ${err?.message || "invalid image data"}`
      );
    }
  } else {
    // Placeholder when no image data is provided
    s.addText(slide.image?.caption || "Image", {
      x: 1.5,
      y: 1.4,
      w: 7,
      h: 3.5,
      fontSize: 24,
      fontFace: theme.fontFace,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
      fill: { color: theme.secondaryColor },
      shape: "rect",
    } as Record<string, unknown>);
  }

  if (slide.image?.caption) {
    s.addText(slide.image.caption, {
      x: 1.5,
      y: 5.0,
      w: 7,
      h: 0.5,
      fontSize: 14,
      fontFace: theme.fontFace,
      color: "666666",
      align: "center",
      italic: true,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addTableSlide(
  pres: Pres,
  slide: SlideContent,
  theme: ReturnType<typeof resolveTheme>,
): void {
  const s = pres.addSlide();
  s.background = { color: theme.backgroundColor };

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.8,
      y: 0.4,
      w: "85%",
      h: 0.8,
      fontSize: 28,
      fontFace: theme.fontFace,
      color: theme.primaryColor,
      bold: true,
    });
  }

  if (slide.table) {
    const headerRow = slide.table.headers.map((h) => ({
      text: h,
      options: {
        bold: true,
        color: "FFFFFF",
        fill: { color: theme.primaryColor },
        fontSize: theme.fontSize,
        fontFace: theme.fontFace,
        align: "left" as const,
        valign: "middle" as const,
      },
    }));

    const dataRows = slide.table.rows.map((row) =>
      row.map((cell) => ({
        text: cell,
        options: {
          fontSize: theme.fontSize - 2,
          fontFace: theme.fontFace,
          color: "333333",
          align: "left" as const,
          valign: "middle" as const,
        },
      })),
    );

    const tableData = [headerRow, ...dataRows];
    const colCount = slide.table.headers.length;
    const colW = Math.min(9.0 / colCount, 3.0);

    s.addTable(tableData, {
      x: 0.8,
      y: 1.4,
      w: colW * colCount,
      border: { pt: 0.5, color: "CCCCCC" },
      rowH: 0.4,
      autoPage: true,
      autoPageRepeatHeader: true,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a PPTX buffer from a validated presentation spec.
 */
export async function buildPptxBuffer(spec: PresentationSpec): Promise<Buffer> {
  const PptxCtor = await getPptxGenJS();
  const pres = new PptxCtor();
  const theme = resolveTheme(spec);

  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches
  if (spec.title) pres.title = spec.title;
  if (spec.author) pres.author = spec.author;

  for (const slide of spec.slides) {
    switch (slide.type) {
      case "title":
        addTitleSlide(pres, slide, theme);
        break;
      case "bullets":
        addBulletsSlide(pres, slide, theme);
        break;
      case "two_col":
        addTwoColSlide(pres, slide, theme);
        break;
      case "image":
        addImageSlide(pres, slide, theme);
        break;
      case "table":
        addTableSlide(pres, slide, theme);
        break;
      default: {
        // Unknown type — add a blank slide with title
        const s = pres.addSlide();
        if (slide.title) {
          s.addText(slide.title, {
            x: 0.8,
            y: 0.4,
            w: "85%",
            h: 0.8,
            fontSize: 28,
            fontFace: theme.fontFace,
            color: theme.primaryColor,
          });
        }
      }
    }
  }

  const buffer = await pres.write({ outputType: "nodebuffer" });
  return buffer as Buffer;
}
