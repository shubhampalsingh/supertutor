import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { gradeQuiz, type TopicQuestion } from "@/lib/agents/assessment";
import { applyAssessment, chooseNextStep } from "@/lib/agents/progress";
import { bumpActivity } from "@/lib/limits";
import { getOwnedPlan, notFound, requireUserId, strings, toTopicState, unauthorized } from "@/lib/plans";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  quizId: z.string(),
  answers: z.array(z.number().int().min(-1).max(3)).max(10),
});

type Ctx = { params: Promise<{ id: string; topicId: string }> };
type Stored = { items: TopicQuestion[]; sources: Record<string, { title: string; page: number | null; snippet: string }> };

/**
 * Grade a topic quiz (application code), then let the Progress agent update
 * mastery / revision schedule and the Orchestrator pick the next step.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const userId = await requireUserId();
  if (!userId) return unauthorized();
  const { id, topicId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const plan = await getOwnedPlan(userId, id);
  const topic = plan?.topics.find((t) => t.id === topicId);
  if (!plan || !topic) return notFound("Topic");
  const quiz = await prisma.quiz.findFirst({
    where: { id: parsed.data.quizId, userId, topicId },
    include: { attempts: { select: { id: true } } },
  });
  if (!quiz) return notFound("Quiz");
  if (quiz.attempts.length > 0) return Response.json({ error: "This quiz was already submitted." }, { status: 409 });

  const stored = quiz.questions as unknown as Stored;
  const grade = gradeQuiz(stored.items, parsed.data.answers);
  const outcome = applyAssessment(
    { mastery: topic.mastery, attempts: topic.attempts, weakConcepts: strings(topic.weakConcepts) },
    grade
  );

  await prisma.$transaction([
    prisma.quizAttempt.create({
      data: { quizId: quiz.id, score: grade.score, total: grade.total, answers: parsed.data.answers },
    }),
    prisma.planTopic.update({
      where: { id: topic.id },
      data: {
        mastery: outcome.mastery,
        status: outcome.status,
        attempts: { increment: 1 },
        weakConcepts: outcome.weakConcepts,
        nextReviewAt: outcome.nextReviewAt,
        lastStudiedAt: new Date(),
      },
    }),
    prisma.learningPlan.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);
  await bumpActivity(userId, grade.score * 2 + 5).catch(() => {});

  const updatedTopics = plan.topics.map((t) =>
    t.id === topic.id
      ? { ...toTopicState(t), mastery: outcome.mastery, status: outcome.status, weakConcepts: outcome.weakConcepts, nextReviewAt: outcome.nextReviewAt }
      : toTopicState(t)
  );

  return Response.json({
    score: grade.score,
    total: grade.total,
    results: stored.items.map((q, i) => ({
      correct: grade.perQuestion[i].correct,
      picked: parsed.data.answers[i] ?? -1,
      answerIndex: q.answerIndex,
      explanation: q.explanation,
      concept: q.concept,
      source: q.sourceRef ? { ref: q.sourceRef, ...stored.sources[q.sourceRef] } : null,
    })),
    outcome: { ...outcome, nextReviewAt: outcome.nextReviewAt.toISOString() },
    nextStep: chooseNextStep(updatedTopics),
  });
}
