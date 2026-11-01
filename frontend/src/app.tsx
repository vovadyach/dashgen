import { SAMPLE_SERVICES } from "@dashgen/contracts";
import { ChartNoAxesCombined } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Answer, preloadChart } from "./components/answer.tsx";
import { QuestionBox } from "./components/question-box.tsx";
import { Steps } from "./components/steps.tsx";
import { ThemeToggle } from "./components/theme-toggle.tsx";
import { Tips } from "./components/tips.tsx";
import { useRun } from "./run.ts";

export function App() {
  const { run, ask, stop } = useRun();
  const [question, setQuestion] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = run.status === "asking" || run.status === "streaming";

  // A clicked choice or example goes into the box too, so the box always
  // shows what was asked. The button clicked goes away with its card, so
  // focus moves to the box, or keyboard users would be left nowhere.
  const askQuestion = (next: string) => {
    setQuestion(next);
    preloadChart();
    ask(next);
    box.current?.focus();
  };

  const stopQuestion = useCallback(() => {
    stop();
    box.current?.focus();
  }, [stop]);

  // Esc stops a question on its way, wherever the focus is.
  useEffect(() => {
    if (!busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopQuestion();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, stopQuestion]);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <p className="flex items-center gap-2 font-semibold tracking-tight">
          <ChartNoAxesCombined className="size-5 text-primary" aria-hidden />
          DashGen
        </p>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 pb-16">
        <div className="space-y-3 pt-8 text-center sm:pt-12">
          <p className="inline-flex rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            Sample data · {SAMPLE_SERVICES.length} services · 30 days
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ask a question, get a chart
          </h1>
          <p className="text-muted-foreground">
            About errors and latency, in plain English. An AI agent picks the
            data and draws the chart.
          </p>
        </div>
        <div className="space-y-4">
          <div className="mx-auto max-w-2xl">
            <QuestionBox
              ref={box}
              question={question}
              onChange={setQuestion}
              onAsk={askQuestion}
              onStop={stopQuestion}
              busy={busy}
            />
          </div>
          {/* Wider than the box, so the examples fit on one row. */}
          <div className="mx-auto max-w-3xl">
            <Tips onAsk={askQuestion} busy={busy} />
          </div>
        </div>
        {run.status !== "idle" && (
          // The steps on the left, the answer on the right. When there are
          // no steps to show, the answer takes the whole row.
          <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:[&>:only-child]:col-span-2">
            <Steps run={run} />
            <Answer run={run} onAsk={askQuestion} />
          </div>
        )}
      </main>
    </div>
  );
}
