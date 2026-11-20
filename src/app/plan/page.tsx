"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PlanRow = {
  id: string;
  goal: string;
  targetDate: string | null;
  topicCount: number;
  mastered: number;
  nextStep: { kind: string; title?: string; reason: string };
};

const LEVELS = ["beginner", "some experience", "intermediate", "advanced"] as const;
const STYLES = ["examples", "analogies", "step-by-step", "concise summaries"] as const;

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("beginner");
  const [hours, setHours] = useState(4);
  const [targetDate, setTargetDate] = useState("");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("examples");
  const [syllabus, setSyllabus] = useState("");
  const [showSyllabus, setShowSyllabus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plans")
      .then(async (r) => {
        if (r.status === 401) {
          setSignedIn(false);
          return;
        }
        const d = await r.json();
        setPlans(d.plans ?? []);
      })
      .catch(() => setPlans([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || goal.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim(),
          level,
          hoursPerWeek: hours,
          targetDate: targetDate || null,
          style,
          syllabus: syllabus.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push(`/plan/${data.id}`);
    } catch {
      setError("Connection problem. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <div className="text-5xl">🗺️</div>
        <h1 className="mt-3 text-2xl font-extrabold">Sign in to build a learning plan</h1>
        <p className="mt-2 text-ink/60">
          Plans, uploaded notes and your progress are saved to your account, so you need to sign in first.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pt-8">
      <h1 className="text-3xl font-extrabold">
        🗺️ <span className="gradient-text">Learning plans</span>
      </h1>
      <p className="mt-1 text-ink/60">
        Tell SuperTutor what you want to learn. It builds a roadmap, teaches each topic from your own notes,
        checks your understanding and adapts what comes next.
      </p>

      <form onSubmit={create} className="card mt-6 space-y-4 p-6">
        <label className="block">
          <span className="font-bold">What&apos;s your goal?</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Learn Python for data analysis, or pass my CN7050 exam"
            className="mt-1 w-full rounded-2xl border-2 border-grape/15 px-4 py-2.5 outline-none focus:border-grape"
            maxLength={300}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-bold">Current level</span>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])}
              className="mt-1 w-full rounded-2xl border-2 border-grape/15 bg-white px-4 py-2.5"
            >
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-bold">Explanation style</span>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as (typeof STYLES)[number])}
              className="mt-1 w-full rounded-2xl border-2 border-grape/15 bg-white px-4 py-2.5"
            >
              {STYLES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-bold">Hours per week</span>
            <input
              type="number"
              min={1}
              max={60}
              value={hours}
              onChange={(e) => setHours(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="mt-1 w-full rounded-2xl border-2 border-grape/15 px-4 py-2.5"
            />
          </label>
          <label className="block">
            <span className="font-bold">Target date (optional)</span>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-grape/15 px-4 py-2.5"
            />
          </label>
        </div>
        {showSyllabus ? (
          <label className="block">
            <span className="font-bold">Syllabus or learning outcomes (optional)</span>
            <textarea
              value={syllabus}
              onChange={(e) => setSyllabus(e.target.value)}
              rows={5}
              maxLength={20000}
              placeholder="Paste topic lists, module outcomes or exam objectives"
              className="mt-1 w-full rounded-2xl border-2 border-grape/15 px-4 py-2.5"
            />
          </label>
        ) : (
          <button type="button" onClick={() => setShowSyllabus(true)} className="text-sm font-bold text-grape underline">
            + Paste a syllabus or learning outcomes
          </button>
        )}
        {error && <p className="font-bold text-bubblegum">{error}</p>}
        <button disabled={busy || goal.trim().length < 3} className="btn-primary w-full py-3">
          {busy ? "Planning your roadmap… (about 30 seconds)" : "✨ Build my plan"}
        </button>
      </form>

      <h2 className="mt-10 text-xl font-bold">Your plans</h2>
      {plans === null ? (
        <p className="mt-2 text-ink/50">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="mt-2 text-ink/50">No plans yet. Create your first one above.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Link href={`/plan/${p.id}`} className="card block p-5 hover:shadow-lg">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold">{p.goal}</span>
                  <span className="shrink-0 rounded-full bg-mint/15 px-3 py-0.5 text-sm font-bold text-mint">
                    {p.mastered}/{p.topicCount} mastered
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-grape/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-grape to-bubblegum"
                    style={{ width: `${p.topicCount ? (p.mastered / p.topicCount) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-ink/60">
                  Next: {p.nextStep.title ? <strong>{p.nextStep.title}</strong> : null} {p.nextStep.reason}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
