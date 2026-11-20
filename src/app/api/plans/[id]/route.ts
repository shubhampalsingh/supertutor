import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { chooseNextStep } from "@/lib/agents/progress";
import { getOwnedPlan, notFound, requireUserId, strings, toTopicState, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const plan = await getOwnedPlan(userId, id);
  if (!plan) return notFound();
  const materials = await prisma.material.findMany({
    where: { userId, OR: [{ planId: id }, { planId: null }] },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, kind: true, chars: true, createdAt: true, planId: true },
  });
  return Response.json({
    plan: {
      id: plan.id,
      goal: plan.goal,
      level: plan.level,
      hoursPerWeek: plan.hoursPerWeek,
      targetDate: plan.targetDate,
      style: plan.style,
      summary: plan.summary,
      topics: plan.topics.map((t) => ({
        id: t.id,
        order: t.order,
        title: t.title,
        summary: t.summary,
        objectives: strings(t.objectives),
        estMinutes: t.estMinutes,
        milestone: t.milestone,
        status: t.status,
        mastery: t.mastery,
        attempts: t.attempts,
        weakConcepts: strings(t.weakConcepts),
        nextReviewAt: t.nextReviewAt,
      })),
    },
    materials,
    nextStep: chooseNextStep(plan.topics.map(toTopicState)),
  });
}

/** Learner-controlled deletion: removes the plan, its topics and its materials. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const { count } = await prisma.learningPlan.deleteMany({ where: { id, userId } });
  if (!count) return notFound();
  return Response.json({ ok: true });
}
