import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateTopicQuiz } from "@/lib/agents/assessment";
import { AgentRefusal } from "@/lib/agents/llm";
import { retrievePassages } from "@/lib/agents/retrieval";
import { consumeUserUsage } from "@/lib/limits";
import { getOwnedPlan, limitResponse, notFound, requireUserId, strings, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  count: z.number().int().min(3).max(10).default(5),
});

type Ctx = { params: Promise<{ id: string; topicId: string }> };

/** Assessment agent: builds a topic quiz. Answers stay on the server until grading. */
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });
  }
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const { id, topicId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const plan = await getOwnedPlan(userId, id);
  const topic = plan?.topics.find((t) => t.id === topicId);
  if (!plan || !topic) return notFound("Topic");
  if (!(await consumeUserUsage(userId, "quizzes"))) return limitResponse("quiz");

  const weakConcepts = strings(topic.weakConcepts);
  const passages = await retrievePassages({
    userId,
    planId: id,
    query: [topic.title, ...strings(topic.objectives), ...weakConcepts].join(" "),
  });
  // Harder questions once the learner is doing well on this topic.
  const difficulty = topic.mastery >= 0.75 ? "hard" : topic.mastery >= 0.4 ? "medium" : "easy";

  try {
    const questions = await generateTopicQuiz({
      goal: plan.goal,
      level: plan.level,
      topic: { title: topic.title, objectives: strings(topic.objectives), weakConcepts },
      passages,
      count: parsed.data.count,
      difficulty,
    });
    if (questions.length === 0) throw new Error("no questions");
    const sources = Object.fromEntries(
      passages.map((p) => [p.ref, { title: p.title, page: p.page, snippet: p.content.slice(0, 400) }])
    );
    const quiz = await prisma.quiz.create({
      data: {
        userId,
        topicId,
        topic: topic.title,
        difficulty,
        questions: { items: questions, sources },
      },
    });
    return Response.json({
      quizId: quiz.id,
      difficulty,
      questions: questions.map((q) => ({ question: q.question, options: q.options })),
    });
  } catch (e) {
    if (e instanceof AgentRefusal) return Response.json({ error: "I couldn't write a quiz for this topic." }, { status: 400 });
    console.error("topic quiz failed", e);
    return Response.json({ error: "Quiz generation failed. Please try again." }, { status: 502 });
  }
}
