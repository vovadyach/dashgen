import { ChartNoAxesCombined } from "lucide-react";
import { useRef, useState } from "react";

import { Answer, preloadChart } from "./components/answer.tsx";
import { QuestionBox } from "./components/question-box.tsx";
import { Steps } from "./components/steps.tsx";
import { ThemeToggle } from "./components/theme-toggle.tsx";
import { useRun } from "./run.ts";

export function App() {
  const { run, ask } = useRun();
  const [question, setQuestion] = useState("");
  const box = useRef<HTMLInputElement>(null);
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

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <p className="flex items-center gap-2 font-semibold tracking-tight">
          <ChartNoAxesCombined className="size-5 text-primary" aria-hidden />
          DashGen
        </p>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 pb-16">
        <div className="space-y-2 pt-8 text-center sm:pt-12">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ask about your services
          </h1>
          <p className="text-muted-foreground">
            Errors and latency for five services, in plain English. An AI agent
            picks the data and draws the chart.
          </p>
        </div>
        <div className="mx-auto max-w-2xl">
          <QuestionBox
            ref={box}
            question={question}
            onChange={setQuestion}
            onAsk={askQuestion}
            busy={busy}
          />
        </div>
        {run.status !== "idle" && (
          <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Steps
              steps={run.status === "asking" ? [] : run.steps}
              working={busy}
            />
            <Answer run={run} onAsk={askQuestion} />
          </div>
        )}
      </main>
    </div>
  );
}
