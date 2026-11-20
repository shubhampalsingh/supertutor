import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildPlan } from "@/lib/agents/planner";
import { AgentRefusal } from "@/lib/agents/llm";
import { chooseNextStep } from "@/lib/agents/progress";
import { bumpActivity, consumeUserUsage } from "@/lib/limits";
import { limitResponse, requireUserId, toTopicState, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  goal: z.string().trim().min(3).max(300),
  level: z.enum(["beginner", "some experience", "intermediate", "advanced"]).default("beginner"),
  hoursPerWeek: z.number().int().min(1).max(60).default(3),
  targetDate: z.string().date().optional().nullable(),
  style: z.enum(["examples", "analogies", "step-by-step", "concise summaries"]).default("examples"),
  syllabus: z.string().max(20_000).optional(),
});

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const plans = await prisma.learningPlan.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { topics: true },
  });
  return Response.json({
    plans: plans.map((p) => ({
      id: p.id,
      goal: p.goal,
      targetDate: p.targetDate,
      topicCount: p.topics.length,
      mastered: p.topics.filter((t) => t.status === "mastered").length,
      nextStep: chooseNextStep(p.topics.map(toTopicState)),
      updatedAt: p.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });
  }
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check the form and try again." }, { status: 400 });
  const input = parsed.data;
  const targetDate = input.targetDate ? new Date(input.targetDate) : null;
  if (targetDate && targetDate.getTime() < Date.now()) {
    return Response.json({ error: "The target date should be in the future." }, { status: 400 });
  }
  if (!(await consumeUserUsage(userId, "plans"))) return limitResponse("plan");

  try {
    const plan = await buildPlan({ ...input, targetDate });
    const saved = await prisma.learningPlan.create({
      data: {
        userId,
        goal: input.goal,
        level: input.level,
        hoursPerWeek: input.hoursPerWeek,
        targetDate,
        style: input.style,
        summary: plan.summary,
        topics: {
          create: plan.topics.map((t, order) => ({
            order,
            title: t.title.slice(0, 200),
            summary: t.summary,
            objectives: t.objectives,
            estMinutes: t.estMinutes,
            milestone: t.milestone?.trim() || null,
          })),
        },
      },
    });
    await bumpActivity(userId, 10).catch(() => {});
    return Response.json({ id: saved.id });
  } catch (e) {
    if (e instanceof AgentRefusal) {
      return Response.json({ error: "I can't build a plan for that goal. Try another one." }, { status: 400 });
    }
    console.error("plan generation failed", e);
    return Response.json({ error: "Plan generation failed. Please try again." }, { status: 502 });
  }
}
