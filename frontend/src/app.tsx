import { SAMPLE_SERVICES } from "@dashgen/contracts";
import { ChartNoAxesCombined, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Answer, preloadChart } from "./components/answer.tsx";
import {
  QuestionBox,
  type QuestionBoxHandle,
} from "./components/question-box.tsx";
import { Steps } from "./components/steps.tsx";
import { ThemeToggle } from "./components/theme-toggle.tsx";
import { Tips } from "./components/tips.tsx";
import { Watchlist } from "./components/watchlist.tsx";
import { type Pin, usePins } from "./pins.ts";
import { useRun } from "./run.ts";
import { chartFromLink, isChartLink } from "./share.ts";

export function App() {
  const { run, ask, stop, open } = useRun();
  const pins = usePins();
  // A share link the page opened but couldn't read, which it says so about
  // until the visitor moves on.
  const [badLink, setBadLink] = useState(false);
  const box = useRef<QuestionBoxHandle>(null);
  const busy = run.status === "asking" || run.status === "streaming";

  // A clicked choice or example goes into the box too, so the box always
  // shows what was asked. The button clicked goes away with its card, so
  // focus moves to the box, or keyboard users would be left nowhere.
  const askQuestion = (next: string) => {
    box.current?.show(next);
    setBadLink(false);
    preloadChart();
    ask(next);
  };

  const stopQuestion = useCallback(() => {
    stop();
    box.current?.focus();
  }, [stop]);

  const openPin = (pin: Pin) => {
    setBadLink(false);
    preloadChart();
    open({ from: "pin", ...pin });
    box.current?.focus();
  };

  // A share link opens its chart, then the address goes back to the page's
  // own, so a reload starts fresh. A link pasted into a tab that's already
  // open changes only the hash, so that's watched too.
  useEffect(() => {
    const openLink = () => {
      const hash = location.hash;
      if (!isChartLink(hash)) return;
      preloadChart();
      void chartFromLink(hash).then((chart) => {
        // In development React runs this twice, and the first one done
        // opens the chart.
        if (location.hash !== hash) return;
        history.replaceState(null, "", location.pathname + location.search);
        setBadLink(!chart);
        if (chart) open({ from: "link", chart });
      });
    };
    openLink();
    window.addEventListener("hashchange", openLink);
    return () => {
      window.removeEventListener("hashchange", openLink);
    };
  }, [open]);

  // Esc stops a question on its way, wherever the focus is.
  useEffect(() => {
    if (!busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Not while an input method composes, as for Japanese or Chinese,
      // where Esc cancels the composing instead.
      if (event.key === "Escape" && !event.isComposing) stopQuestion();
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
        {badLink && (
          <p
            role="alert"
            className="mx-auto flex max-w-2xl items-start gap-2 rounded-lg border bg-card px-4 py-3 text-sm"
          >
            <CircleAlert
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            This chart link couldn't be opened. It may have been cut short when
            it was shared.
          </p>
        )}
        {run.status !== "idle" && (
          // The steps on the left, the answer on the right. When there are
          // no steps to show, the answer takes the whole row. On a narrow
          // screen the answer comes first, so it isn't pushed below the
          // steps. Only the look changes: the steps panel has nothing to
          // focus, so keyboard order stays the same, and screen readers
          // still hear each step as it comes.
          <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:[&>:only-child]:col-span-2">
            <Steps run={run} />
            <div className="order-first min-w-0 lg:order-none">
              <Answer run={run} onAsk={askQuestion} pins={pins} />
            </div>
          </div>
        )}
        <Watchlist
          pins={pins.pins}
          onOpen={openPin}
          onUnpin={(pin) => {
            pins.unpin(pin.chart);
          }}
          busy={busy}
          stored={pins.stored}
        />
      </main>
    </div>
  );
}
