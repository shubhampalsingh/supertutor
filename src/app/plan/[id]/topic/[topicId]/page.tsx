"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/Markdown";

type Source = { ref: string; title: string; page: number | null; snippet: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };
type Mode = "lesson" | "reteach" | "quiz";
type TopicInfo = { id: string; title: string; summary: string; objectives: string[]; status: string; mastery: number };

export default function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; topicId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id, topicId } = use(params);
  const sp = use(searchParams);
  const router = useRouter();
  const initial: Mode = sp.mode === "quiz" ? "quiz" : sp.mode === "reteach" ? "reteach" : "lesson";
  const [mode, setMode] = useState<Mode>(initial);
  const [topic, setTopic] = useState<TopicInfo | null>(null);
  const [goal, setGoal] = useState("");

  useEffect(() => {
    fetch(`/api/plans/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setGoal(d.plan?.goal ?? "");
        setTopic(d.plan?.topics.find((t: TopicInfo) => t.id === topicId) ?? null);
      })
      .catch(() => {});
  }, [id, topicId]);

  function switchMode(m: Mode) {
    setMode(m);
    router.replace(`/plan/${id}/topic/${topicId}?mode=${m}`);
  }

  return (
    <div className="mx-auto max-w-3xl pt-8">
      <Link href={`/plan/${id}`} className="text-sm font-bold text-grape">
        ← {goal || "Back to plan"}
      </Link>
      <h1 className="mt-2 text-3xl font-extrabold">{topic?.title ?? "…"}</h1>
      {topic && <p className="mt-1 text-ink/60">{topic.summary}</p>}
      <div className="mt-4 flex gap-2">
        {(["lesson", "quiz"] as const).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${
              (mode === m || (m === "lesson" && mode === "reteach")) ? "bg-grape text-white" : "border-2 border-grape/20 hover:bg-grape/10"
            }`}
          >
            {m === "quiz" ? "🎯 Quiz" : "📖 Lesson"}
          </button>
        ))}
      </div>
      {mode === "quiz" ? (
        <TopicQuiz key="quiz" planId={id} topicId={topicId} onReteach={() => switchMode("reteach")} />
      ) : (
        <Lesson key={mode} planId={id} topicId={topicId} mode={mode} onQuiz={() => switchMode("quiz")} onReteach={() => switchMode("reteach")} />
      )}
    </div>
  );
}

function decodeSources(h: string | null): Source[] {
  if (!h) return [];
  try {
    const b64 = h.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function Lesson({
  planId,
  topicId,
  mode,
  onQuiz,
  onReteach,
}: {
  planId: string;
  topicId: string;
  mode: "lesson" | "reteach";
  onQuiz: () => void;
  onReteach: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);
  const started = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const run = useCallback(
    async (kind: "lesson" | "reteach" | "followup", history: Msg[]) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/plans/${planId}/topics/${topicId}/teach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: kind,
            messages: kind === "followup" ? history.map(({ role, content }) => ({ role, content })) : [],
          }),
        });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}));
          setError(d.error ?? "Something went wrong.");
          return;
        }
        const sources = decodeSources(res.headers.get("x-sources"));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let text = "";
        setMsgs([...history, { role: "assistant", content: "", sources }]);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += dec.decode(value, { stream: true });
          setMsgs([...history, { role: "assistant", content: text, sources }]);
        }
      } catch {
        setError("Connection problem. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [planId, topicId]
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(mode, []);
  }, [mode, run]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    const history: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(history);
    run("followup", history);
  }

  async function sendFeedback(kind: "error" | "unclear" | "helpful" | "not_helpful", excerpt: string) {
    let note: string | undefined;
    if (kind === "error") {
      note = window.prompt("What looks wrong? (optional)") ?? undefined;
    }
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, kind, note, excerpt: excerpt.slice(0, 4000) }),
    }).catch(() => {});
    setFeedbackSent(kind === "error" ? "Thanks, the error report was saved." : "Thanks for the feedback!");
    if (kind === "unclear") onReteach();
  }

  return (
    <div className="mt-6">
      {mode === "reteach" && (
        <div className="mb-3 rounded-2xl bg-sunny/10 px-4 py-2 text-sm font-bold text-sunny">
          🔄 Trying a different explanation, focused on what tripped you up.
        </div>
      )}
      <div className="space-y-4">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="bubble-user ml-auto max-w-[85%] px-4 py-2.5">
              {m.content}
            </div>
          ) : (
            <div key={i} className="bubble-ai p-5">
              {m.content ? (
                <Markdown
                  text={m.content}
                  onCite={(r) => setOpenSource(m.sources?.find((s) => s.ref === r) ?? null)}
                />
              ) : (
                <span className="text-ink/50">Thinking… ✨</span>
              )}
              {m.sources && m.sources.length > 0 && m.content && (
                <details className="mt-4 rounded-xl bg-sky/5 p-3 text-sm">
                  <summary className="cursor-pointer font-bold text-sky">📚 Sources from your materials ({m.sources.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {m.sources.map((s) => (
                      <li key={s.ref}>
                        <strong>[{s.ref}]</strong> {s.title}
                        {s.page ? `, p. ${s.page}` : ""}
                        <div className="text-ink/60">“{s.snippet}…”</div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {m.sources && m.sources.length === 0 && m.content && !busy && (
                <p className="mt-3 text-xs text-ink/40">
                  No uploaded materials matched this topic, so this explanation is from general knowledge.
                </p>
              )}
              {i === msgs.length - 1 && m.content && !busy && (
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <button onClick={() => sendFeedback("helpful", m.content)} className="rounded-full border-2 border-grape/15 px-3 py-1 hover:bg-grape/10">👍 Helpful</button>
                  <button onClick={() => sendFeedback("unclear", m.content)} className="rounded-full border-2 border-grape/15 px-3 py-1 hover:bg-grape/10">🤔 Still confused</button>
                  <button onClick={() => sendFeedback("error", m.content)} className="rounded-full border-2 border-grape/15 px-3 py-1 hover:bg-grape/10">🚩 Report an error</button>
                </div>
              )}
            </div>
          )
        )}
      </div>
      {feedbackSent && <p className="mt-2 text-sm font-bold text-mint">{feedbackSent}</p>}
      {error && <p className="mt-3 font-bold text-bubblegum">{error}</p>}

      {openSource && (
        <div className="card mt-4 border-sky/30 p-4 text-sm">
          <div className="flex justify-between">
            <strong>
              [{openSource.ref}] {openSource.title}
              {openSource.page ? `, page ${openSource.page}` : ""}
            </strong>
            <button onClick={() => setOpenSource(null)} className="text-ink/40">✕</button>
          </div>
          <p className="mt-2 text-ink/70">“{openSource.snippet}…”</p>
        </div>
      )}

      <form onSubmit={ask} className="mt-6 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a follow-up question…"
          className="flex-1 rounded-full border-2 border-grape/15 bg-white px-4 py-2.5 outline-none focus:border-grape"
          disabled={busy}
        />
        <button disabled={busy || !input.trim()} className="btn-primary px-5">Ask</button>
      </form>
      <div className="mt-6 text-center">
        <button onClick={onQuiz} disabled={busy} className="btn-primary px-6 py-3">
          I&apos;m ready, quiz me 🎯
        </button>
      </div>
      <div ref={endRef} />
    </div>
  );
}

type QItem = { question: string; options: string[] };
type Result = {
  correct: boolean;
  picked: number;
  answerIndex: number;
  explanation: string;
  concept: string;
  source: { ref: string; title: string; page: number | null; snippet: string } | null;
};
type GradeResp = {
  score: number;
  total: number;
  results: Result[];
  outcome: { mastery: number; status: string; nextReviewAt: string; weakConcepts: string[]; decision: "advance" | "reteach" };
  nextStep: { kind: string; topicId?: string; title?: string; reason: string };
};

function TopicQuiz({ planId, topicId, onReteach }: { planId: string; topicId: string; onReteach: () => void }) {
  const [quiz, setQuiz] = useState<{ quizId: string; difficulty: string; questions: QItem[] } | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [grade, setGrade] = useState<GradeResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setGrade(null);
    setQuiz(null);
    try {
      const res = await fetch(`/api/plans/${planId}/topics/${topicId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 5 }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "Quiz generation failed.");
      else {
        setQuiz(d);
        setAnswers(d.questions.map(() => -1));
      }
    } catch {
      setError("Connection problem.");
    } finally {
      setBusy(false);
    }
  }, [planId, topicId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    generate();
  }, [generate]);

  async function submit() {
    if (!quiz) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/plans/${planId}/topics/${topicId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: quiz.quizId, answers }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "Grading failed.");
      else setGrade(d);
    } catch {
      setError("Connection problem.");
    } finally {
      setBusy(false);
    }
  }

  if (busy && !quiz) return <p className="mt-8 text-center text-ink/50">Writing questions from your materials… ✍️</p>;
  if (error && !quiz) return (
    <div className="mt-8 text-center">
      <p className="font-bold text-bubblegum">{error}</p>
      <button onClick={generate} className="btn-primary mt-3 px-5 py-2">Try again</button>
    </div>
  );
  if (!quiz) return null;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-ink/50">Difficulty: {quiz.difficulty} (adapts to your mastery)</p>
      {quiz.questions.map((q, i) => {
        const r = grade?.results[i];
        return (
          <div key={i} className="card p-5">
            <div className="font-bold">
              {i + 1}. {q.question}
            </div>
            <div className="mt-3 grid gap-2">
              {q.options.map((o, j) => {
                const picked = answers[i] === j;
                let cls = "border-grape/15 hover:bg-grape/5";
                if (r) {
                  if (j === r.answerIndex) cls = "border-mint bg-mint/10";
                  else if (picked) cls = "border-bubblegum bg-bubblegum/10";
                  else cls = "border-grape/10 opacity-60";
                } else if (picked) cls = "border-grape bg-grape/10";
                return (
                  <button
                    key={j}
                    disabled={!!grade}
                    onClick={() => setAnswers((a) => a.map((x, k) => (k === i ? j : x)))}
                    className={`rounded-2xl border-2 px-4 py-2 text-left ${cls}`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            {r && (
              <div className={`mt-3 rounded-xl p-3 text-sm ${r.correct ? "bg-mint/10" : "bg-sunny/10"}`}>
                <strong>{r.correct ? "✅ Correct." : "Not quite."}</strong> {r.explanation}
                <div className="mt-1 text-xs text-ink/50">Concept: {r.concept}</div>
                {r.source && (
                  <div className="mt-2 text-xs text-ink/60">
                    📚 From [{r.source.ref}] {r.source.title}
                    {r.source.page ? `, p. ${r.source.page}` : ""}: “{r.source.snippet.slice(0, 200)}…”
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="font-bold text-bubblegum">{error}</p>}
      {!grade ? (
        <button onClick={submit} disabled={busy || answers.some((a) => a < 0)} className="btn-primary w-full py-3">
          {busy ? "Checking…" : answers.some((a) => a < 0) ? "Answer every question to submit" : "Submit answers"}
        </button>
      ) : (
        <div className="card bg-gradient-to-r from-grape/10 to-bubblegum/10 p-6 text-center">
          <div className="text-4xl font-extrabold">
            {grade.score}/{grade.total}
          </div>
          <div className="mt-1 text-ink/70">Mastery estimate now {Math.round(grade.outcome.mastery * 100)}%</div>
          {grade.outcome.decision === "advance" ? (
            <p className="mt-3 font-bold text-mint">🎉 Topic mastered! Review scheduled for {new Date(grade.outcome.nextReviewAt).toLocaleDateString()}.</p>
          ) : (
            <p className="mt-3 font-bold text-sunny">
              Let&apos;s strengthen this one{grade.outcome.weakConcepts.length ? `: ${grade.outcome.weakConcepts.join(", ")}` : ""}.
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {grade.outcome.decision === "reteach" && (
              <button onClick={onReteach} className="btn-primary px-5 py-2.5">Explain it another way 🔄</button>
            )}
            {grade.nextStep.kind !== "done" && grade.nextStep.topicId && grade.nextStep.topicId !== topicId && (
              <Link href={`/plan/${planId}/topic/${grade.nextStep.topicId}?mode=${grade.nextStep.kind === "learn" ? "lesson" : grade.nextStep.kind === "reteach" ? "reteach" : "quiz"}`} className="btn-primary px-5 py-2.5">
                Next: {grade.nextStep.title} →
              </Link>
            )}
            <button onClick={generate} className="rounded-full border-2 border-grape/20 px-5 py-2.5 font-bold hover:bg-grape/10">New quiz</button>
            <Link href={`/plan/${planId}`} className="rounded-full border-2 border-grape/20 px-5 py-2.5 font-bold hover:bg-grape/10">Back to plan</Link>
          </div>
        </div>
      )}
    </div>
  );
}
