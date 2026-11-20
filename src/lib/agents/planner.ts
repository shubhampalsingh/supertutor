/**
 * Learner Profiling + Learning Planner agents.
 * Turns a goal, stated level, time budget and deadline into an ordered roadmap.
 * The profile uses only what the learner told us (and their materials), so the
 * planner never assumes knowledge the learner did not state.
 */
import { jsonCall } from "./llm";

export type PlannedTopic = {
  title: string;
  summary: string;
  objectives: string[];
  estMinutes: number;
  milestone: string;
  prerequisites: string[];
};

export type Plan = { summary: string; topics: PlannedTopic[] };

const planSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          objectives: { type: "array", items: { type: "string" } },
          estMinutes: { type: "integer" },
          milestone: { type: "string" }, // "" when the topic closes no phase
          prerequisites: { type: "array", items: { type: "string" } },
        },
        required: ["title", "summary", "objectives", "estMinutes", "milestone", "prerequisites"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "topics"],
  additionalProperties: false,
} as const;

export async function buildPlan(input: {
  goal: string;
  level: string;
  hoursPerWeek: number;
  targetDate: Date | null;
  style: string;
  syllabus?: string;
}): Promise<Plan> {
  const weeks = input.targetDate
    ? Math.max(1, Math.round((input.targetDate.getTime() - Date.now()) / (7 * 86_400_000)))
    : null;
  const budget = weeks ? `${weeks} weeks × ${input.hoursPerWeek} h/week ≈ ${weeks * input.hoursPerWeek} hours` : `${input.hoursPerWeek} h/week, no fixed deadline`;

  const plan = await jsonCall<Plan>({
    effort: "medium",
    system:
      "You are the Learning Planner agent in SuperTutor, a personal learning assistant. " +
      "Break the learner's goal into 5-12 manageable topics in prerequisite order. " +
      "Each topic has a one-sentence summary, 2-4 concrete, checkable learning objectives, " +
      "an estimated study time in minutes (15-120), and a milestone label on topics that close a phase (an empty string otherwise). " +
      "Fit the total time to the learner's budget; if it cannot fit, keep the essentials and say so in the summary. " +
      "Start at the learner's stated level and do not assume knowledge they have not stated. " +
      "If a syllabus or outcomes list is supplied, cover it and use its wording. " +
      "The summary is 2-3 sentences addressed to the learner.",
    user:
      `Goal: ${input.goal}\nCurrent level: ${input.level}\nTime budget: ${budget}\n` +
      `Preferred explanation style: ${input.style}\n` +
      (input.syllabus ? `\nSyllabus / learning outcomes supplied by the learner:\n${input.syllabus.slice(0, 20_000)}` : ""),
    schema: planSchema,
  });

  plan.topics = plan.topics.slice(0, 15).map((t) => ({
    ...t,
    estMinutes: Math.min(180, Math.max(10, Math.round(t.estMinutes || 30))),
    objectives: t.objectives.slice(0, 6),
  }));
  if (plan.topics.length === 0) throw new Error("Planner returned no topics.");
  return plan;
}
