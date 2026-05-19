import { z } from "zod";

const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}$/;
const FONT_NAME_RE = /^[^\u0000-\u001F\u007F<>{}\n\r]{1,80}$/;
const MAX_REPORT_TEXT_CHARS = 120_000;
const MAX_REPORT_IMAGE_DATA_CHARS = 24 * 1024 * 1024;
const MAX_REPORT_TOTAL_CHARS = 26 * 1024 * 1024;
const REPORT_RENDER_TIMEOUT_MS = 60_000;
const REPORT_RENDER_QUEUE_TIMEOUT_MS = 15_000;
const REPORT_RENDER_MAX_CONCURRENCY = 2;
const REPORT_SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const REPORT_ASSISTANT_META_LINE_PATTERNS = [
  /^\s*(?:done|perfect|sure|here(?:'s| is))\b.*\bi\b/i,
  /^\s*i(?:'ve| have)?\s+(?:made|created|generated|built|rebuilt|drafted|prepared|assembled|put together)\b/i,
  /^\s*i(?:'ll| will)\s+(?:create|generate|build|make|draft|prepare|polish|add|turn)\b/i,
  /^\s*(?:if you want|if you'd like|if you need)\b.*\b(?:i can|i could|i(?:'ll| will))\b/i,
  /^\s*(?:let me know|happy to|i can also|i could also|would you like me to)\b/i,
];
const REPORT_ASSISTANT_META_SENTENCE_PATTERNS = [
  /\b(?:if you want|if you'd like|if you need)\b.*\b(?:i can|i could|i(?:'ll| will))\b/i,
  /\blet me know\b/i,
  /\bhappy to\b/i,
  /\bi can also\b/i,
  /\bi could also\b/i,
  /\bwould you like me to\b/i,
  /\bi(?:'ve| have)?\s+(?:made|created|generated|built|rebuilt|drafted|prepared|assembled|put together)\b/i,
  /\bi(?:'ll| will)\s+(?:create|generate|build|make|draft|prepare|polish|add|turn)\b/i,
];

const ReportColorSchema = z.string().trim().regex(
  HEX_COLOR_RE,
  "Expected a 6-digit hex color like 1F4B99 or #1F4B99",
);

const ReportFontSchema = z.string().trim().regex(
  FONT_NAME_RE,
  "Expected a simple font family name up to 80 characters",
);

const ReportImageSchema = z.object({
  data: z.string(),
  caption: z.string().optional(),
  alt: z.string().optional(),
});

const MetricItemSchema = z.object({
  label: z.string(),
  value: z.string(),
  note: z.string().optional(),
});

const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string(),
});

const BulletsBlockSchema = z.object({
  type: z.literal("bullets"),
  items: z.array(z.string()).min(1).max(12),
});

const QuoteBlockSchema = z.object({
  type: z.literal("quote"),
  text: z.string(),
  attribution: z.string().optional(),
});

const TableBlockSchema = z.object({
  type: z.literal("table"),
  caption: z.string().optional(),
  headers: z.array(z.string()).min(1).max(8),
  rows: z.array(z.array(z.string())).max(40),
});

const ImageBlockSchema = z.object({
  type: z.literal("image"),
  image: ReportImageSchema,
});

const MetricsBlockSchema = z.object({
  type: z.literal("metrics"),
  items: z.array(MetricItemSchema).min(1).max(4),
});

const CalloutBlockSchema = z.object({
  type: z.literal("callout"),
  tone: z.enum(["info", "success", "warning"]).optional().default("info"),
  title: z.string().optional(),
  text: z.string(),
});

export const ReportBlockSchema = z.discriminatedUnion("type", [
  ParagraphBlockSchema,
  BulletsBlockSchema,
  QuoteBlockSchema,
  TableBlockSchema,
  ImageBlockSchema,
  MetricsBlockSchema,
  CalloutBlockSchema,
]);

export const ReportSectionSchema = z.object({
  heading: z.string(),
  kicker: z.string().optional(),
  summary: z.string().optional(),
  blocks: z.array(ReportBlockSchema).min(1).max(16),
});

export const ReportSpecSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  summary: z.string().optional(),
  closingNote: z.string().optional(),
  hero: ReportImageSchema.optional(),
  theme: z.object({
    accentColor: ReportColorSchema.optional().default("1F4B99"),
    accentSoftColor: ReportColorSchema.optional().default("DCE7F9"),
    pageColor: ReportColorSchema.optional().default("F4F1EA"),
    surfaceColor: ReportColorSchema.optional().default("FFFDF8"),
    inkColor: ReportColorSchema.optional().default("152033"),
    mutedColor: ReportColorSchema.optional().default("5F6B7A"),
    headingFont: ReportFontSchema.optional().default("Aptos Display"),
    bodyFont: ReportFontSchema.optional().default("Aptos"),
  }).optional(),
  sections: z.array(ReportSectionSchema).min(1).max(20),
});

export type ReportSpec = z.infer<typeof ReportSpecSchema>;
export type ReportSection = z.infer<typeof ReportSectionSchema>;
export type ReportBlock = z.infer<typeof ReportBlockSchema>;

type ResolvedTheme = {
  accentColor: string;
  accentSoftColor: string;
  pageColor: string;
  surfaceColor: string;
  inkColor: string;
  mutedColor: string;
  headingFont: string;
  bodyFont: string;
};

const DEFAULT_THEME: ResolvedTheme = {
  accentColor: "1F4B99",
  accentSoftColor: "DCE7F9",
  pageColor: "F4F1EA",
  surfaceColor: "FFFDF8",
  inkColor: "152033",
  mutedColor: "5F6B7A",
  headingFont: "Aptos Display",
  bodyFont: "Aptos",
};

let activeReportRenderCount = 0;
const reportRenderWaiters: Array<() => void> = [];

export type ReportPdfRenderer = (params: {
  html: string;
  title: string;
  suggestedFilename: string;
}) => Promise<Buffer>;

function resolveTheme(spec: ReportSpec): ResolvedTheme {
  return { ...DEFAULT_THEME, ...spec.theme };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("\n", " ");
}

function normalizeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || !HEX_COLOR_RE.test(trimmed)) {
    return `#${fallback}`;
  }
  return `#${trimmed.replace(/^#/, "").toUpperCase()}`;
}

function textToHtml(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function safeFileStem(title: string): string {
  const compact = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return compact || "report";
}

function countTextChars(value?: string): number {
  return value?.length ?? 0;
}

function normalizeReportText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function isLikelyAssistantMetaText(value: string): boolean {
  const normalized = normalizeReportText(value).replace(/[–—]/g, "-");
  if (!normalized) {
    return false;
  }
  return REPORT_ASSISTANT_META_LINE_PATTERNS.some((pattern) => pattern.test(normalized))
    || REPORT_ASSISTANT_META_SENTENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sanitizeNarrativeText(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeReportText(value);
  if (!normalized) {
    return undefined;
  }

  const sanitizedParagraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const sanitizedLines = paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          if (REPORT_ASSISTANT_META_LINE_PATTERNS.some((pattern) => pattern.test(line.replace(/[–—]/g, "-")))) {
            return "";
          }

          const keptSentences = line
            .split(REPORT_SENTENCE_SPLIT_RE)
            .map((sentence) => sentence.trim())
            .filter(Boolean)
            .filter((sentence) => !isLikelyAssistantMetaText(sentence));

          return keptSentences.join(" ").trim();
        })
        .filter(Boolean);

      return sanitizedLines.join("\n").trim();
    })
    .filter(Boolean);

  const sanitized = sanitizedParagraphs.join("\n\n").trim();
  return sanitized || undefined;
}

function sanitizeReportImage(image?: ReportSpec["hero"]): ReportSpec["hero"] | undefined {
  if (!image) {
    return undefined;
  }

  return {
    ...image,
    caption: sanitizeNarrativeText(image.caption),
    alt: sanitizeNarrativeText(image.alt),
  };
}

function sanitizeReportBlock(block: ReportBlock): ReportBlock | null {
  switch (block.type) {
    case "paragraph": {
      const text = sanitizeNarrativeText(block.text);
      return text ? { ...block, text } : null;
    }
    case "bullets": {
      const items = block.items
        .map((item) => sanitizeNarrativeText(item))
        .filter((item): item is string => Boolean(item));
      return items.length > 0 ? { ...block, items } : null;
    }
    case "quote": {
      const text = sanitizeNarrativeText(block.text);
      if (!text) {
        return null;
      }
      return {
        ...block,
        text,
        attribution: sanitizeNarrativeText(block.attribution),
      };
    }
    case "table":
      return {
        ...block,
        caption: sanitizeNarrativeText(block.caption),
      };
    case "image":
      return {
        ...block,
        image: sanitizeReportImage(block.image)!,
      };
    case "metrics": {
      const items = block.items
        .map((item) => ({
          ...item,
          note: sanitizeNarrativeText(item.note),
        }))
        .filter((item) => item.label.trim() || item.value.trim() || item.note);
      return items.length > 0 ? { ...block, items } : null;
    }
    case "callout": {
      const text = sanitizeNarrativeText(block.text);
      if (!text) {
        return null;
      }
      return {
        ...block,
        title: sanitizeNarrativeText(block.title),
        text,
      };
    }
  }
}

function isRenderableSection(section: ReportSection): boolean {
  return Boolean(section.blocks.length > 0 || section.kicker || section.summary);
}

function sanitizeReportSpec(spec: ReportSpec): ReportSpec {
  const sanitizedSections = spec.sections
    .map((section) => ({
      ...section,
      kicker: sanitizeNarrativeText(section.kicker),
      summary: sanitizeNarrativeText(section.summary),
      blocks: section.blocks
        .map((block) => sanitizeReportBlock(block))
        .filter((block): block is ReportBlock => Boolean(block)),
    }))
    .filter(isRenderableSection);

  return {
    ...spec,
    summary: sanitizeNarrativeText(spec.summary),
    closingNote: sanitizeNarrativeText(spec.closingNote),
    hero: sanitizeReportImage(spec.hero),
    sections: sanitizedSections,
  };
}

function assertRenderableReportContent(spec: ReportSpec): void {
  if (spec.sections.length === 0) {
    throw new Error("Report content became empty after removing assistant/meta text");
  }
}

function measureReportSpecSize(spec: ReportSpec): {
  textChars: number;
  imageDataChars: number;
  totalChars: number;
} {
  let textChars = 0;
  let imageDataChars = 0;

  const addText = (value?: string) => {
    textChars += countTextChars(value);
  };
  const addImage = (value?: string) => {
    imageDataChars += countTextChars(value);
  };

  addText(spec.title);
  addText(spec.subtitle);
  addText(spec.author);
  addText(spec.date);
  addText(spec.summary);
  addText(spec.closingNote);
  addImage(spec.hero?.data);
  addText(spec.hero?.caption);
  addText(spec.hero?.alt);
  addText(spec.theme?.accentColor);
  addText(spec.theme?.accentSoftColor);
  addText(spec.theme?.pageColor);
  addText(spec.theme?.surfaceColor);
  addText(spec.theme?.inkColor);
  addText(spec.theme?.mutedColor);
  addText(spec.theme?.headingFont);
  addText(spec.theme?.bodyFont);

  for (const section of spec.sections) {
    addText(section.heading);
    addText(section.kicker);
    addText(section.summary);

    for (const block of section.blocks) {
      switch (block.type) {
        case "paragraph":
          addText(block.text);
          break;
        case "bullets":
          for (const item of block.items) addText(item);
          break;
        case "quote":
          addText(block.text);
          addText(block.attribution);
          break;
        case "table":
          addText(block.caption);
          for (const header of block.headers) addText(header);
          for (const row of block.rows) {
            for (const cell of row) addText(cell);
          }
          break;
        case "image":
          addImage(block.image.data);
          addText(block.image.caption);
          addText(block.image.alt);
          break;
        case "metrics":
          for (const item of block.items) {
            addText(item.label);
            addText(item.value);
            addText(item.note);
          }
          break;
        case "callout":
          addText(block.title);
          addText(block.text);
          break;
      }
    }
  }

  return {
    textChars,
    imageDataChars,
    totalChars: textChars + imageDataChars,
  };
}

function assertReportSpecWithinLimits(spec: ReportSpec): void {
  const { textChars, imageDataChars, totalChars } = measureReportSpecSize(spec);
  if (textChars > MAX_REPORT_TEXT_CHARS) {
    throw new Error(
      `Report text is too large (${textChars} chars > ${MAX_REPORT_TEXT_CHARS} char limit)`,
    );
  }
  if (imageDataChars > MAX_REPORT_IMAGE_DATA_CHARS) {
    throw new Error(
      `Report image payloads are too large (${imageDataChars} chars > ${MAX_REPORT_IMAGE_DATA_CHARS} char limit)`,
    );
  }
  if (totalChars > MAX_REPORT_TOTAL_CHARS) {
    throw new Error(
      `Report payload is too large (${totalChars} chars > ${MAX_REPORT_TOTAL_CHARS} char limit)`,
    );
  }
}

async function withTimeout<T>(
  promiseFactory: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
        timeoutHandle.unref?.();
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function acquireReportRenderSlot(timeoutMs = REPORT_RENDER_QUEUE_TIMEOUT_MS): Promise<void> {
  if (activeReportRenderCount < REPORT_RENDER_MAX_CONCURRENCY) {
    activeReportRenderCount += 1;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const grant = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      activeReportRenderCount += 1;
      resolve();
    };
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const index = reportRenderWaiters.indexOf(grant);
      if (index >= 0) {
        reportRenderWaiters.splice(index, 1);
      }
      reject(
        new Error(
          `Report rendering is busy (${REPORT_RENDER_MAX_CONCURRENCY} concurrent builds max); try again shortly`,
        ),
      );
    }, timeoutMs);
    timeoutHandle.unref?.();
    reportRenderWaiters.push(grant);
  });
}

function releaseReportRenderSlot(): void {
  activeReportRenderCount = Math.max(0, activeReportRenderCount - 1);
  const next = reportRenderWaiters.shift();
  if (next) {
    next();
  }
}

async function withReportRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireReportRenderSlot();
  try {
    return await fn();
  } finally {
    releaseReportRenderSlot();
  }
}

function padCells(cells: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => cells[index] ?? "");
}

function renderImageFigure(image: ReportSpec["hero"], className: string): string {
  if (!image) return "";
  const alt = image.alt?.trim() || image.caption?.trim() || "Report image";
  return [
    `<figure class="${className}">`,
    `<img src="${escapeAttr(image.data)}" alt="${escapeAttr(alt)}">`,
    image.caption ? `<figcaption>${textToHtml(image.caption)}</figcaption>` : "",
    "</figure>",
  ].join("");
}

function renderBlock(block: ReportBlock): string {
  switch (block.type) {
    case "paragraph":
      return `<p class="report-paragraph">${textToHtml(block.text)}</p>`;
    case "bullets":
      return [
        '<ul class="report-bullets">',
        ...block.items.map((item) => `<li>${textToHtml(item)}</li>`),
        "</ul>",
      ].join("");
    case "quote":
      return [
        '<blockquote class="report-quote">',
        `<p>${textToHtml(block.text)}</p>`,
        block.attribution ? `<footer>${textToHtml(block.attribution)}</footer>` : "",
        "</blockquote>",
      ].join("");
    case "table":
      return [
        '<figure class="report-table-wrap">',
        block.caption ? `<figcaption>${textToHtml(block.caption)}</figcaption>` : "",
        '<table class="report-table">',
        "<thead><tr>",
        ...block.headers.map((header) => `<th>${textToHtml(header)}</th>`),
        "</tr></thead>",
        "<tbody>",
        ...block.rows.map((row) => {
          const cells = padCells(row, block.headers.length);
          return `<tr>${cells.map((cell) => `<td>${textToHtml(cell)}</td>`).join("")}</tr>`;
        }),
        "</tbody></table></figure>",
      ].join("");
    case "image":
      return renderImageFigure(block.image, "report-figure");
    case "metrics":
      return [
        '<div class="report-metrics">',
        ...block.items.map((item) =>
          [
            '<article class="metric-card">',
            `<div class="metric-label">${textToHtml(item.label)}</div>`,
            `<div class="metric-value">${textToHtml(item.value)}</div>`,
            item.note ? `<div class="metric-note">${textToHtml(item.note)}</div>` : "",
            "</article>",
          ].join(""),
        ),
        "</div>",
      ].join("");
    case "callout":
      return [
        `<aside class="report-callout tone-${block.tone}">`,
        block.title ? `<h4>${textToHtml(block.title)}</h4>` : "",
        `<p>${textToHtml(block.text)}</p>`,
        "</aside>",
      ].join("");
  }
}

function renderSection(section: ReportSection, index: number): string {
  return [
    `<section class="report-section" data-index="${index + 1}">`,
    '<div class="section-marker"></div>',
    '<div class="section-body">',
    section.kicker ? `<div class="section-kicker">${textToHtml(section.kicker)}</div>` : "",
    `<h2>${textToHtml(section.heading)}</h2>`,
    section.summary ? `<p class="section-summary">${textToHtml(section.summary)}</p>` : "",
    ...section.blocks.map((block) => renderBlock(block)),
    "</div>",
    "</section>",
  ].join("");
}

export function renderReportHtml(spec: ReportSpec): string {
  const sanitizedSpec = sanitizeReportSpec(spec);
  const theme = resolveTheme(sanitizedSpec);
  const accentColor = normalizeColor(theme.accentColor, DEFAULT_THEME.accentColor);
  const accentSoftColor = normalizeColor(theme.accentSoftColor, DEFAULT_THEME.accentSoftColor);
  const pageColor = normalizeColor(theme.pageColor, DEFAULT_THEME.pageColor);
  const surfaceColor = normalizeColor(theme.surfaceColor, DEFAULT_THEME.surfaceColor);
  const inkColor = normalizeColor(theme.inkColor, DEFAULT_THEME.inkColor);
  const mutedColor = normalizeColor(theme.mutedColor, DEFAULT_THEME.mutedColor);

  const metadata = [sanitizedSpec.author, sanitizedSpec.date].filter(Boolean).map((value) => textToHtml(value!)).join(" &middot; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; script-src 'none'">
  <title>${escapeHtml(sanitizedSpec.title)}</title>
  <style>
    :root {
      --accent: ${accentColor};
      --accent-soft: ${accentSoftColor};
      --page: ${pageColor};
      --surface: ${surfaceColor};
      --ink: ${inkColor};
      --muted: ${mutedColor};
      --heading-font: "${escapeAttr(theme.headingFont)}", "Helvetica Neue", "Segoe UI", sans-serif;
      --body-font: "${escapeAttr(theme.bodyFont)}", "Aptos", "Helvetica Neue", sans-serif;
      --border: color-mix(in srgb, var(--ink) 12%, transparent);
      --shadow: 0 16px 48px rgba(21, 32, 51, 0.08);
    }

    @page {
      size: A4;
      margin: 16mm 14mm 18mm;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: var(--body-font);
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 14%, transparent), transparent 28%),
        linear-gradient(180deg, color-mix(in srgb, var(--page) 92%, white), var(--page));
      color: var(--ink);
      font-size: 11pt;
      line-height: 1.55;
    }

    .report-shell {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .cover {
      background: linear-gradient(180deg, var(--surface), color-mix(in srgb, var(--surface) 84%, var(--accent-soft)));
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 26px 26px 22px;
      box-shadow: var(--shadow);
      page-break-after: always;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.14em;
      padding: 7px 12px;
      text-transform: uppercase;
    }

    .cover h1,
    .report-section h2,
    .report-callout h4 {
      font-family: var(--heading-font);
      margin: 0;
    }

    .cover h1 {
      margin-top: 18px;
      font-size: 25pt;
      line-height: 1.05;
      letter-spacing: -0.03em;
      max-width: 90%;
    }

    .cover .subtitle {
      margin-top: 10px;
      font-size: 13pt;
      color: var(--muted);
      max-width: 86%;
    }

    .cover .summary {
      margin-top: 22px;
      max-width: 88%;
      font-size: 11.5pt;
      color: color-mix(in srgb, var(--ink) 92%, white);
    }

    .cover .meta {
      margin-top: 14px;
      color: var(--muted);
      font-size: 9.5pt;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .cover .hero-image {
      margin-top: 22px;
    }

    .hero-image img,
    .report-figure img {
      width: 100%;
      display: block;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface) 88%, white);
      object-fit: cover;
      max-height: 210mm;
    }

    figure { margin: 0; }
    figcaption {
      margin-top: 8px;
      color: var(--muted);
      font-size: 9pt;
    }

    .report-section {
      display: grid;
      grid-template-columns: 16px 1fr;
      gap: 16px;
      background: color-mix(in srgb, var(--surface) 92%, white);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 18px 18px 16px;
      box-shadow: 0 10px 30px rgba(21, 32, 51, 0.04);
      break-inside: avoid;
    }

    .section-marker {
      border-radius: 999px;
      background:
        linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 68%, white));
      min-height: 100%;
    }

    .section-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-kicker {
      color: var(--accent);
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .report-section h2 {
      font-size: 17pt;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }

    .section-summary {
      margin: 0;
      color: var(--muted);
      font-size: 10.5pt;
    }

    .report-paragraph {
      margin: 0;
    }

    .report-bullets {
      margin: 0;
      padding-left: 20px;
      display: grid;
      gap: 8px;
    }

    .report-quote {
      margin: 0;
      padding: 16px 18px;
      border-left: 4px solid var(--accent);
      background: color-mix(in srgb, var(--accent-soft) 54%, white);
      border-radius: 0 14px 14px 0;
    }

    .report-quote p {
      margin: 0;
      font-size: 11.2pt;
    }

    .report-quote footer {
      margin-top: 10px;
      color: var(--muted);
      font-size: 9.2pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .report-table-wrap {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid var(--border);
      font-size: 9.5pt;
    }

    .report-table th,
    .report-table td {
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
    }

    .report-table th {
      background: color-mix(in srgb, var(--accent-soft) 72%, white);
      color: var(--accent);
      font-size: 8.8pt;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .report-table tbody tr:nth-child(even) td {
      background: color-mix(in srgb, var(--surface) 82%, white);
    }

    .report-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .metric-card {
      background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, white), var(--surface));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px 14px 12px;
    }

    .metric-label {
      color: var(--muted);
      font-size: 8.8pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .metric-value {
      margin-top: 8px;
      font-family: var(--heading-font);
      font-size: 18pt;
      line-height: 1.05;
      letter-spacing: -0.03em;
      color: var(--accent);
    }

    .metric-note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 9.2pt;
    }

    .report-callout {
      border-radius: 16px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface) 88%, white);
    }

    .report-callout h4 {
      font-size: 11pt;
      margin-bottom: 6px;
    }

    .report-callout p {
      margin: 0;
    }

    .tone-info {
      background: color-mix(in srgb, var(--accent-soft) 56%, white);
    }

    .tone-success {
      background: #edf8f0;
    }

    .tone-warning {
      background: #fff4dd;
    }

    .closing-note {
      color: var(--muted);
      font-size: 9.4pt;
      padding: 0 2px;
    }
  </style>
</head>
<body>
  <main class="report-shell">
    <section class="cover">
      <div class="eyebrow">Report</div>
      <h1>${textToHtml(sanitizedSpec.title)}</h1>
      ${sanitizedSpec.subtitle ? `<div class="subtitle">${textToHtml(sanitizedSpec.subtitle)}</div>` : ""}
      ${metadata ? `<div class="meta">${metadata}</div>` : ""}
      ${sanitizedSpec.summary ? `<div class="summary">${textToHtml(sanitizedSpec.summary)}</div>` : ""}
      ${renderImageFigure(sanitizedSpec.hero, "hero-image")}
    </section>
    ${sanitizedSpec.sections.map((section, index) => renderSection(section, index)).join("")}
    ${sanitizedSpec.closingNote ? `<div class="closing-note">${textToHtml(sanitizedSpec.closingNote)}</div>` : ""}
  </main>
</body>
</html>`;
}

async function renderPdfWithPlaywright(params: {
  html: string;
  title: string;
  suggestedFilename: string;
}): Promise<Buffer> {
  let browser: any | null = null;
  let context: any | null = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
    });
    context = await browser.newContext({
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route: any) => {
      const url = String(route.request().url() || "");
      if (url.startsWith("data:")) {
        await route.continue();
        return;
      }
      await route.abort("blockedbyclient").catch(async () => {
        await route.abort().catch(() => {});
      });
    });
    const page = await context.newPage();
    await page.setContent(params.html, {
      waitUntil: "domcontentloaded",
      timeout: REPORT_RENDER_TIMEOUT_MS / 2,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    return await withTimeout(
      () =>
        page.pdf({
          format: "A4",
          printBackground: true,
          margin: {
            top: "12mm",
            right: "10mm",
            bottom: "14mm",
            left: "10mm",
          },
        }),
      REPORT_RENDER_TIMEOUT_MS,
      `PDF generation timed out after ${REPORT_RENDER_TIMEOUT_MS}ms`,
    );
  } catch (err: any) {
    const message = err?.message || String(err);
    if (/install .*playwright|executable doesn't exist|download new browsers/i.test(message)) {
      throw new Error(`PDF generation is unavailable: ${message}`);
    }
    throw new Error(`PDF generation failed: ${message}`);
  } finally {
    try {
      await context?.close?.();
    } catch {
      // ignore close errors
    }
    try {
      await browser?.close?.();
    } catch {
      // ignore close errors
    }
  }
}

export async function buildReportPdfBuffer(
  spec: ReportSpec,
  options?: { pdfRenderer?: ReportPdfRenderer },
): Promise<Buffer> {
  const sanitizedSpec = sanitizeReportSpec(spec);
  assertRenderableReportContent(sanitizedSpec);
  assertReportSpecWithinLimits(sanitizedSpec);
  const html = renderReportHtml(sanitizedSpec);
  const renderer = options?.pdfRenderer ?? renderPdfWithPlaywright;
  return await withReportRenderSlot(async () =>
    renderer({
      html,
      title: sanitizedSpec.title,
      suggestedFilename: `${safeFileStem(sanitizedSpec.title)}.pdf`,
    }),
  );
}
