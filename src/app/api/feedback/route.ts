import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  topicId: z.string().optional(),
  kind: z.enum(["error", "unclear", "helpful", "not_helpful"]),
  note: z.string().max(2000).optional(),
  excerpt: z.string().max(4000).optional(),
});

/** Learner feedback: report an error, flag something unclear, or rate helpfulness. */
export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  await prisma.learnerFeedback.create({ data: { userId, ...parsed.data } });
  return Response.json({ ok: true });
}
