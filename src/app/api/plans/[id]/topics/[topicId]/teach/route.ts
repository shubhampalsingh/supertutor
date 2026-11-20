import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { streamText } from "@/lib/agents/llm";
import { retrievePassages } from "@/lib/agents/retrieval";
import { teachingSystem } from "@/lib/agents/teaching";
import { bumpActivity, consumeUserUsage } from "@/lib/limits";
import { getOwnedPlan, limitResponse, notFound, requireUserId, strings, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  mode: z.enum(["lesson", "reteach", "followup"]).default("lesson"),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(40)
    .default([]),
});

type Ctx = { params: Promise<{ id: string; topicId: string }> };

/** Teaching agent: streams a lesson / re-explanation / follow-up answer with sources. */
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });
  }
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const { id, topicId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { mode, messages } = parsed.data;
  if (mode === "followup" && messages.at(-1)?.role !== "user") {
    return Response.json({ error: "Ask a question first." }, { status: 400 });
  }

  const plan = await getOwnedPlan(userId, id);
  const topic = plan?.topics.find((t) => t.id === topicId);
  if (!plan || !topic) return notFound("Topic");
  if (!(await consumeUserUsage(userId, "chatMessages"))) return limitResponse("tutor message");

  const weakConcepts = strings(topic.weakConcepts);
  const lastQuestion = mode === "followup" ? messages.at(-1)!.content : "";
  const passages = await retrievePassages({
    userId,
    planId: id,
    query: [topic.title, ...strings(topic.objectives), ...weakConcepts, lastQuestion].join(" "),
  });

  const system = teachingSystem({
    goal: plan.goal,
    level: plan.level,
    style: plan.style,
    topic: { title: topic.title, summary: topic.summary, objectives: strings(topic.objectives), weakConcepts },
    passages,
    mode,
  });

  const apiMessages =
    mode === "followup"
      ? messages
      : [{ role: "user" as const, content: mode === "reteach" ? "I'm still confused. Please explain this topic another way." : `Teach me: ${topic.title}` }];

  if (topic.status === "todo") {
    await prisma.planTopic.update({ where: { id: topic.id }, data: { status: "learning", lastStudiedAt: new Date() } });
  } else {
    await prisma.planTopic.update({ where: { id: topic.id }, data: { lastStudiedAt: new Date() } });
  }
  await prisma.learningPlan.update({ where: { id }, data: { updatedAt: new Date() } });

  const sources = passages.map((p) => ({
    ref: p.ref,
    title: p.title,
    page: p.page,
    snippet: p.content.slice(0, 280),
  }));

  return streamText({
    system,
    messages: apiMessages,
    effort: mode === "followup" ? "low" : "medium",
    headers: { "x-sources": Buffer.from(JSON.stringify(sources)).toString("base64url") },
    onDone: () => bumpActivity(userId, 5),
  });
}
