/**
 * Assessment agent.
 * The LLM writes questions (tagged with the concept each one tests and, when
 * possible, the source passage). Scoring is done in application code so it is
 * deterministic and consistent.
 */
import { jsonCall } from "./llm";
import type { Passage } from "./retrieval";
import { formatPassages } from "./retrieval";

export type TopicQuestion = {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  concept: string;
  sourceRef: string; // "S1" etc, or "" when general knowledge
};

const schema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answerIndex: { type: "integer" },
          explanation: { type: "string" },
          concept: { type: "string" },
          sourceRef: { type: "string" },
        },
        required: ["question", "options", "answerIndex", "explanation", "concept", "sourceRef"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

export async function generateTopicQuiz(opts: {
  goal: string;
  level: string;
  topic: { title: string; objectives: string[]; weakConcepts: string[] };
  passages: Passage[];
  count: number;
  difficulty: "easy" | "medium" | "hard";
}): Promise<TopicQuestion[]> {
  const out = await jsonCall<{ questions: TopicQuestion[] }>({
    effort: "medium",
    system:
      "You are the Assessment agent in SuperTutor. Write multiple-choice questions that check the topic's learning objectives. " +
      "Each question has exactly 4 options and exactly one correct answer at answerIndex (0-3); vary its position. " +
      "Set `concept` to a short name (2-5 words) for the idea the question tests, reused across questions testing the same idea. " +
      "Prefer questions grounded in the supplied passages, and set `sourceRef` to the passage id (e.g. S2) the answer comes from, or \"\" if it is general knowledge. " +
      "Never cite a passage that does not support the answer. " +
      "The explanation says why the right answer is right and the most tempting wrong answer is wrong, in 1-3 sentences. " +
      "Include at least one question on any listed weak concept.",
    user:
      `Learner goal: ${opts.goal}\nLevel: ${opts.level}\nDifficulty: ${opts.difficulty}\nNumber of questions: ${opts.count}\n` +
      `Topic: ${opts.topic.title}\nObjectives:\n${opts.topic.objectives.map((o) => `- ${o}`).join("\n")}\n` +
      (opts.topic.weakConcepts.length ? `Weak concepts: ${opts.topic.weakConcepts.join("; ")}\n` : "") +
      `\nPassages from the learner's materials:\n${formatPassages(opts.passages)}`,
    schema,
  });
  const refs = new Set(opts.passages.map((p) => p.ref));
  return out.questions
    .filter((q) => q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex < 4)
    .slice(0, opts.count)
    .map((q) => ({ ...q, sourceRef: refs.has(q.sourceRef) ? q.sourceRef : "" }));
}

export type Grade = {
  score: number;
  total: number;
  accuracy: number;
  perQuestion: { correct: boolean; concept: string }[];
  missedConcepts: string[];
};

/** Deterministic scoring — no LLM involved. */
export function gradeQuiz(questions: TopicQuestion[], answers: number[]): Grade {
  const perQuestion = questions.map((q, i) => ({
    correct: answers[i] === q.answerIndex,
    concept: q.concept.trim(),
  }));
  const score = perQuestion.filter((p) => p.correct).length;
  const missedConcepts = [...new Set(perQuestion.filter((p) => !p.correct).map((p) => p.concept))];
  return {
    score,
    total: questions.length,
    accuracy: questions.length ? score / questions.length : 0,
    perQuestion,
    missedConcepts,
  };
}
