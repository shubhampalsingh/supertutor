import { NextRequest } from "next/server";
import { consumeUserUsage } from "@/lib/limits";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, extractPdfPages, indexMaterial } from "@/lib/agents/retrieval";
import { getOwnedPlan, limitResponse, notFound, requireUserId, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Upload a PDF / text / Markdown file, validate it, and index it for retrieval. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const plan = await getOwnedPlan(userId, id);
  if (!plan) return notFound();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Files must be between 1 byte and 10 MB." }, { status: 400 });
  }
  const name = file.name || "Untitled";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  const isText = (ALLOWED_TYPES as readonly string[]).includes(file.type) || /\.(txt|md|markdown)$/i.test(name);
  if (!isPdf && !isText) {
    return Response.json({ error: "Only PDF, .txt and .md files are supported for now." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Check the real file signature, not just the extension.
  if (isPdf && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return Response.json({ error: "That file doesn't look like a valid PDF." }, { status: 400 });
  }
  if (!(await consumeUserUsage(userId, "uploads"))) return limitResponse("upload");

  try {
    const pages = isPdf ? await extractPdfPages(bytes) : [new TextDecoder().decode(bytes)];
    const material = await indexMaterial({
      userId,
      planId: id,
      title: name.replace(/\.(pdf|txt|md|markdown)$/i, ""),
      kind: isPdf ? "pdf" : "text",
      pages,
    });
    return Response.json({ material });
  } catch (e) {
    const msg = e instanceof Error && e.message.startsWith("No readable") ? e.message : "Couldn't read that file. If it's a scanned PDF, try a text-based copy.";
    return Response.json({ error: msg }, { status: 400 });
  }
}
