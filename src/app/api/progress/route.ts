import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LIMITS, todayUTC } from "@/lib/limits";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ signedIn: false });
  }
  const userId = session.user.id;

  const [user, usage, chatCount, quizCount, deckCount, dueCards, attempts, topics] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.usageDay.findUnique({
        where: { userId_date: { userId, date: todayUTC() } },
      }),
      prisma.chatSession.count({ where: { userId } }),
      prisma.quiz.count({ where: { userId } }),
      prisma.deck.count({ where: { userId } }),
      prisma.card.count({
        where: { deck: { userId }, due: { lte: new Date() } },
      }),
      prisma.quizAttempt.findMany({
        where: { quiz: { userId } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { quiz: { select: { topic: true } } },
      }),
      prisma.planTopic.findMany({
        where: { plan: { userId } },
        select: {
          id: true, title: true, status: true, mastery: true, attempts: true,
          weakConcepts: true, nextReviewAt: true, planId: true, plan: { select: { goal: true } },
        },
      }),
    ]);

  const now = new Date();
  const gaps = topics
    .filter((t) => t.status === "revise" || (Array.isArray(t.weakConcepts) && t.weakConcepts.length > 0))
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 8)
    .map((t) => ({
      planId: t.planId, topicId: t.id, title: t.title, goal: t.plan.goal, mastery: t.mastery,
      weakConcepts: (t.weakConcepts as string[]).slice(0, 4),
    }));
  const reviewsDue = topics
    .filter((t) => t.status === "mastered" && t.nextReviewAt && t.nextReviewAt <= now)
    .map((t) => ({ planId: t.planId, topicId: t.id, title: t.title, goal: t.plan.goal }));
  const assessed = topics.filter((t) => t.attempts > 0);

  return Response.json({
    signedIn: true,
    name: user?.name,
    xp: user?.xp ?? 0,
    streak: user?.streak ?? 0,
    counts: { chats: chatCount, quizzes: quizCount, decks: deckCount, dueCards },
    today: {
      chatMessages: usage?.chatMessages ?? 0,
      quizzes: usage?.quizzes ?? 0,
      decks: usage?.decks ?? 0,
      solves: usage?.solves ?? 0,
    },
    limits: LIMITS.user,
    learning: {
      topics: topics.length,
      mastered: topics.filter((t) => t.status === "mastered").length,
      avgMastery: assessed.length ? assessed.reduce((n, t) => n + t.mastery, 0) / assessed.length : null,
      gaps,
      reviewsDue,
    },
    recentAttempts: attempts.map((a) => ({
      topic: a.quiz.topic,
      score: a.score,
      total: a.total,
      at: a.createdAt,
    })),
  });
}
