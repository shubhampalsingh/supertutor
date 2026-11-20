import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, requireUserId, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** Learner-controlled deletion of an uploaded material and its index. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const { count } = await prisma.material.deleteMany({ where: { id, userId } });
  if (!count) return notFound("Material");
  return Response.json({ ok: true });
}
