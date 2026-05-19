import { describe, expect, test } from "vitest";
import { encodeBrowserUploadBlobEnvelope } from "../src/browser-upload-staging.js";
import { resolvePresentationImages, resolveReportImages } from "../src/presentation-image-resolver.js";
import type { PresentationSpec } from "../src/presentations.js";
import type { ReportSpec } from "../src/reports.js";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c7FoAAAAASUVORK5CYII=";

function makeSpec(imageData: string): PresentationSpec {
  return {
    title: "Deck",
    slides: [
      {
        type: "image",
        title: "Hero",
        image: {
          data: imageData,
          caption: "Caption",
        },
      },
    ],
  };
}

function makeReportSpec(imageData: string): ReportSpec {
  return {
    title: "Board Memo",
    hero: {
      data: imageData,
      caption: "Hero image",
    },
    sections: [
      {
        heading: "Overview",
        blocks: [
          {
            type: "image",
            image: {
              data: imageData,
              caption: "Section image",
            },
          },
        ],
      },
    ],
  };
}

describe("resolvePresentationImages", () => {
  test("embeds vault-backed binary images as data URIs", async () => {
    const spec = makeSpec("presentations/demo/hero.png");
    const store = {
      getDocumentWithContent: (collection: string, path: string) => {
        if (collection !== "_editable" || path !== "presentations/demo/hero.png") {
          return null;
        }
        return {
          content: encodeBrowserUploadBlobEnvelope(Buffer.from(TINY_PNG_BASE64, "base64"), {
            mimeType: "image/png",
            originalName: "hero.png",
          }),
        };
      },
    };

    const issues = await resolvePresentationImages(store as any, spec);

    expect(issues).toEqual([]);
    expect(spec.slides[0]?.type).toBe("image");
    expect((spec.slides[0] as any).image.data).toMatch(/^data:image\/png;base64,/);
  });

  test("rejects local/private network remote image URLs", async () => {
    const spec = makeSpec("http://127.0.0.1/private.png");

    const issues = await resolvePresentationImages({
      getDocumentWithContent: () => null,
    } as any, spec);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Blocked hostname or private/internal IP address");
  });

  test("rejects non-image data URIs", async () => {
    const spec = makeSpec("data:text/plain;base64,aGVsbG8=");

    const issues = await resolvePresentationImages({
      getDocumentWithContent: () => null,
    } as any, spec);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("not an image");
  });

  test("accepts raw SVG content stored in the vault", async () => {
    const spec = makeSpec("presentations/demo/hero.svg");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>`;

    const issues = await resolvePresentationImages({
      getDocumentWithContent: (collection: string, path: string) => {
        if (collection !== "_editable" || path !== "presentations/demo/hero.svg") {
          return null;
        }
        return { content: svg };
      },
    } as any, spec);

    expect(issues).toEqual([]);
    expect((spec.slides[0] as any).image.data).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe("resolveReportImages", () => {
  test("embeds vault-backed images for report hero and section blocks", async () => {
    const spec = makeReportSpec("reports/demo/chart.png");
    const store = {
      getDocumentWithContent: (collection: string, path: string) => {
        if (collection !== "_editable" || path !== "reports/demo/chart.png") {
          return null;
        }
        return {
          content: encodeBrowserUploadBlobEnvelope(Buffer.from(TINY_PNG_BASE64, "base64"), {
            mimeType: "image/png",
            originalName: "chart.png",
          }),
        };
      },
    };

    const issues = await resolveReportImages(store as any, spec);

    expect(issues).toEqual([]);
    expect(spec.hero?.data).toMatch(/^data:image\/png;base64,/);
    expect(spec.sections[0]?.blocks[0]?.type).toBe("image");
    expect((spec.sections[0]?.blocks[0] as any).image.data).toMatch(/^data:image\/png;base64,/);
  });
});
