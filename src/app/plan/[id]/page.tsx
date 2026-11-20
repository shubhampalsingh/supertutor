"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Topic = {
  id: string;
  order: number;
  title: string;
  summary: string;
  objectives: string[];
  estMinutes: number;
  milestone: string | null;
  status: "todo" | "learning" | "mastered" | "revise";
  mastery: number;
  attempts: number;
  weakConcepts: string[];
  nextReviewAt: string | null;
};
type Material = { id: string; title: string; kind: string; chars: number; createdAt: string; planId: string | null };
type NextStep = { kind: "review" | "reteach" | "learn" | "quiz" | "done"; topicId?: string; title?: string; reason: string };
type PlanData = {
  plan: {
    id: string;
    goal: string;
    level: string;
    hoursPerWeek: number;
    targetDate: string | null;
    style: string;
    summary: string;
    topics: Topic[];
  };
  materials: Material[];
  nextStep: NextStep;
};

const STATUS: Record<Topic["status"], { label: string; cls: string }> = {
  todo: { label: "Not started", cls: "bg-ink/5 text-ink/50" },
  learning: { label: "Learning", cls: "bg-sky/15 text-sky" },
  revise: { label: "Needs practice", cls: "bg-sunny/15 text-sunny" },
  mastered: { label: "Mastered", cls: "bg-mint/15 text-mint" },
};

const STEP_CTA: Record<NextStep["kind"], { label: string; mode: string }> = {
  learn: { label: "Start lesson", mode: "lesson" },
  reteach: { label: "Explain it another way", mode: "reteach" },
  review: { label: "Review with a quiz", mode: "quiz" },
  quiz: { label: "Take the quiz", mode: "quiz" },
  done: { label: "", mode: "" },
};

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/plans/${id}`);
    const d = await res.json();
    if (!res.ok) setError(d.error ?? "Couldn't load this plan.");
    else setData(d);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/plans/${id}`)
      .then(async (res) => {
        const d = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(d.error ?? "Couldn't load this plan.");
        else setData(d);
      })
      .catch(() => !cancelled && setError("Connection problem."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function upload(file: File) {
    setUploading(true);
    setUploadMsg(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/plans/${id}/materials`, { method: "POST", body: form });
      const d = await res.json();
      setUploadMsg(res.ok ? `✅ Added “${d.material.title}”. Lessons and quizzes will now use it.` : `⚠️ ${d.error}`);
      if (res.ok) await load();
    } catch {
      setUploadMsg("⚠️ Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeMaterial(mid: string) {
    if (!window.confirm("Delete this material and its index?")) return;
    await fetch(`/api/materials/${mid}`, { method: "DELETE" });
    await load();
  }

  async function deletePlan() {
    if (!window.confirm("Delete this plan, its progress and its uploaded materials? This can't be undone.")) return;
    await fetch(`/api/plans/${id}`, { method: "DELETE" });
    router.push("/plan");
  }

  if (error) return <div className="card mx-auto mt-16 max-w-md p-8 text-center font-bold">{error}</div>;
  if (!data) return <div className="pt-20 text-center text-ink/50">Loading your plan… ⏳</div>;

  const { plan, materials, nextStep } = data;
  const mastered = plan.topics.filter((t) => t.status === "mastered").length;
  const totalMin = plan.topics.reduce((n, t) => n + t.estMinutes, 0);
  const gaps = plan.topics.filter((t) => t.status === "revise" || t.weakConcepts.length > 0);

  return (
    <div className="mx-auto max-w-3xl pt-8">
      <Link href="/plan" className="text-sm font-bold text-grape">
        ← All plans
      </Link>
      <h1 className="mt-2 text-3xl font-extrabold">{plan.goal}</h1>
      <p className="mt-2 text-ink/70">{plan.summary}</p>
      <p className="mt-2 text-sm text-ink/50">
        {plan.level} · {plan.hoursPerWeek} h/week · about {Math.round(totalMin / 60)} h total
        {plan.targetDate ? ` · target ${new Date(plan.targetDate).toLocaleDateString()}` : ""} · {plan.style}
      </p>

      <div className="card mt-6 bg-gradient-to-r from-grape/10 to-bubblegum/10 p-5">
        <div className="text-sm font-bold uppercase tracking-wide text-grape">Your next step</div>
        {nextStep.kind === "done" ? (
          <p className="mt-1 text-lg font-bold">🎉 {nextStep.reason}</p>
        ) : (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-extrabold">{nextStep.title}</div>
              <div className="text-ink/70">{nextStep.reason}</div>
            </div>
            <Link href={`/plan/${id}/topic/${nextStep.topicId}?mode=${STEP_CTA[nextStep.kind].mode}`} className="btn-primary px-5 py-2.5">
              {STEP_CTA[nextStep.kind].label} →
            </Link>
          </div>
        )}
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white">
          <div
            className="h-full rounded-full bg-gradient-to-r from-grape to-bubblegum"
            style={{ width: `${(mastered / plan.topics.length) * 100}%` }}
          />
        </div>
        <div className="mt-1 text-right text-sm font-bold text-ink/50">
          {mastered}/{plan.topics.length} topics mastered
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="card mt-6 p-5">
          <h2 className="text-xl font-bold">🧩 Knowledge gaps</h2>
          <ul className="mt-2 space-y-1.5">
            {gaps.map((t) => (
              <li key={t.id} className="text-sm">
                <Link href={`/plan/${id}/topic/${t.id}?mode=reteach`} className="font-bold text-grape underline">
                  {t.title}
                </Link>{" "}
                <span className="text-ink/60">
                  {t.weakConcepts.length ? `· ${t.weakConcepts.join(", ")}` : "· needs another pass"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-8 text-xl font-bold">Roadmap</h2>
      <ol className="mt-3 space-y-3">
        {plan.topics.map((t) => (
          <li key={t.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-ink/40">
                  Topic {t.order + 1} · ~{t.estMinutes} min
                </div>
                <div className="text-lg font-extrabold">{t.title}</div>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-0.5 text-sm font-bold ${STATUS[t.status].cls}`}>
                {STATUS[t.status].label}
              </span>
            </div>
            <p className="mt-1 text-ink/70">{t.summary}</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-ink/60">
              {t.objectives.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
            {t.attempts > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs font-bold text-ink/50">
                  <span>Mastery estimate</span>
                  <span>{Math.round(t.mastery * 100)}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-grape/10">
                  <div
                    className={`h-full rounded-full ${t.mastery >= 0.75 ? "bg-mint" : "bg-sunny"}`}
                    style={{ width: `${t.mastery * 100}%` }}
                  />
                </div>
                {t.nextReviewAt && (
                  <div className="mt-1 text-xs text-ink/50">
                    Next review: {new Date(t.nextReviewAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/plan/${id}/topic/${t.id}?mode=lesson`} className="rounded-full border-2 border-grape/20 px-4 py-1.5 text-sm font-bold hover:bg-grape/10">
                📖 Learn
              </Link>
              <Link href={`/plan/${id}/topic/${t.id}?mode=quiz`} className="rounded-full border-2 border-grape/20 px-4 py-1.5 text-sm font-bold hover:bg-grape/10">
                🎯 Quiz
              </Link>
            </div>
            {t.milestone && (
              <div className="mt-3 rounded-xl bg-sunny/10 px-3 py-1.5 text-sm font-bold text-sunny">🏁 Milestone: {t.milestone}</div>
            )}
          </li>
        ))}
      </ol>

      <div className="card mt-8 p-6">
        <h2 className="text-xl font-bold">📚 Study materials</h2>
        <p className="mt-1 text-sm text-ink/60">
          Upload notes, slides exported as PDF, or reading you&apos;re allowed to use. Lessons and quizzes will cite them so
          you can check every answer. PDF, .txt or .md, up to 10 MB.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-grape/10 file:px-4 file:py-2 file:font-bold file:text-grape"
          />
          {uploading && <span className="text-sm text-ink/50">Reading and indexing…</span>}
        </div>
        {uploadMsg && <p className="mt-2 text-sm font-bold">{uploadMsg}</p>}
        {materials.length > 0 && (
          <ul className="mt-4 space-y-2">
            {materials.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-2xl border-2 border-grape/10 px-4 py-2 text-sm">
                <span className="truncate font-semibold">
                  {m.kind === "pdf" ? "📄" : "📝"} {m.title}
                  <span className="ml-2 text-ink/40">{m.chars < 1000 ? `${m.chars} chars` : `${Math.round(m.chars / 1000)}k chars`}</span>
                </span>
                <button onClick={() => removeMaterial(m.id)} className="ml-3 shrink-0 text-ink/40 hover:text-bubblegum">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 text-center">
        <button onClick={deletePlan} className="text-sm text-ink/40 underline hover:text-bubblegum">
          Delete this plan and its data
        </button>
      </div>
    </div>
  );
}
