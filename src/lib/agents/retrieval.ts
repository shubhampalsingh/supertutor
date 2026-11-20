/**
 * Study Material Retrieval Agent.
 * Validates and indexes uploaded materials, then retrieves relevant passages
 * (Postgres full-text search) with source references the learner can check.
 */
import { prisma } from "@/lib/prisma";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_TYPES = ["application/pdf", "text/plain", "text/markdown"] as const;
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 200;

export type Passage = {
  ref: string; // "S1", "S2", ... used for in-text citations
  materialId: string;
  title: string;
  page: number | null;
  content: string;
};

/** Pull text out of a PDF page by page. */
export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map(clean);
}

function clean(s: string): string {
  return s.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Split pages into overlapping chunks, keeping the page number for citations. */
export function chunkPages(pages: string[]): { page: number | null; content: string }[] {
  const out: { page: number | null; content: string }[] = [];
  pages.forEach((pageText, i) => {
    const page = pages.length > 1 ? i + 1 : null;
    let start = 0;
    while (start < pageText.length) {
      let end = Math.min(pageText.length, start + CHUNK_CHARS);
      if (end < pageText.length) {
        const brk = pageText.lastIndexOf(" ", end);
        if (brk > start + CHUNK_CHARS / 2) end = brk;
      }
      const content = pageText.slice(start, end).trim();
      if (content.length > 40) out.push({ page, content });
      if (end >= pageText.length) break;
      start = end - CHUNK_OVERLAP;
    }
  });
  return out;
}

export async function indexMaterial(opts: {
  userId: string;
  planId: string | null;
  title: string;
  kind: "pdf" | "text";
  pages: string[];
}) {
  const chunks = chunkPages(opts.pages.map(clean));
  if (chunks.length === 0) throw new Error("No readable text found in this file.");
  return prisma.material.create({
    data: {
      userId: opts.userId,
      planId: opts.planId,
      title: opts.title.slice(0, 200),
      kind: opts.kind,
      chars: chunks.reduce((n, c) => n + c.content.length, 0),
      chunks: { create: chunks.map((c, idx) => ({ idx, page: c.page, content: c.content })) },
    },
    select: { id: true, title: true, kind: true, chars: true, createdAt: true },
  });
}

/** Retrieve the most relevant passages from this learner's materials for a plan. */
export async function retrievePassages(opts: {
  userId: string;
  planId: string;
  query: string;
  limit?: number;
}): Promise<Passage[]> {
  const limit = opts.limit ?? 6;
  type Row = { materialId: string; title: string; page: number | null; content: string };
  // websearch_to_tsquery is forgiving with free text; fall back to OR-ed terms
  // so a long question still matches passages that share key words.
  const terms = opts.query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 24)
    .join(" OR ");
  if (!terms) return [];
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT c."materialId", m.title, c.page, c.content
    FROM "MaterialChunk" c
    JOIN "Material" m ON m.id = c."materialId"
    WHERE m."userId" = ${opts.userId}
      AND (m."planId" = ${opts.planId} OR m."planId" IS NULL)
      AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', ${terms})
    ORDER BY ts_rank(to_tsvector('english', c.content), websearch_to_tsquery('english', ${terms})) DESC
    LIMIT ${limit}`;
  return rows.map((r, i) => ({ ref: `S${i + 1}`, ...r }));
}

export function formatPassages(passages: Passage[]): string {
  if (passages.length === 0) return "(No matching passages in the learner's materials.)";
  return passages
    .map(
      (p) =>
        `[${p.ref}] ${p.title}${p.page ? `, page ${p.page}` : ""}\n${p.content}`
    )
    .join("\n\n---\n\n");
}
