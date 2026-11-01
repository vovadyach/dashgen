import type { ApiErrorCode, Chart } from "@dashgen/contracts";
import type { AgChartInstance } from "ag-charts-community";
import {
  CircleAlert,
  MessageCircleQuestion,
  RotateCcw,
  SearchX,
  Table,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useId, useState } from "react";

import { formatValue, formatX } from "../chart/format.ts";
import { summary } from "../chart/summary.ts";
import { cn } from "../lib/utils.ts";
import type { Pins } from "../pins.ts";
import type { Answer as RunAnswer, Failure, Run, SavedChart } from "../run.ts";
import { ChartActions } from "./chart-actions.tsx";
import { ChartBoundary } from "./chart-boundary.tsx";
import { DrawingChart } from "./drawing-chart.tsx";
import { Button } from "./ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card.tsx";

const loadChart = () => import("./chart-view.tsx");
const ChartView = lazy(loadChart);

/** Starts loading the chart code while the agent works, so the chart can draw as soon as it comes. */
export function preloadChart() {
  // A failed download shows when the chart renders, so it's ignored here.
  void loadChart().catch(() => undefined);
}

interface Props {
  run: Exclude<Run, { status: "idle" }>;
  onAsk: (question: string) => void;
  pins: Pins;
}

/** What the question got: the chart, a question back, a refusal, or an error. */
export function Answer({ run, onAsk, pins }: Props) {
  if (run.status === "opened") {
    return <ChartCard chart={run.saved.chart} saved={run.saved} pins={pins} />;
  }
  if (run.status === "failed") {
    // The error comes first. The answer before it stays below, labeled so
    // it isn't taken for this question's, and still usable.
    return (
      <div className="space-y-4">
        <Failed
          failure={run.failure}
          onRetry={() => {
            onAsk(run.question);
          }}
        />
        {run.previous && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Your last answer
            </p>
            <Outcome answer={run.previous} onAsk={onAsk} pins={pins} />
          </div>
        )}
      </div>
    );
  }
  const working = run.status === "asking" || run.status === "streaming";
  const answer = run.status === "answered" ? run.answer : run.previous;
  if (!answer) return working ? <Waiting /> : null;
  // While the next question runs, the last answer stays, dimmed and out of
  // reach, so the page doesn't go blank, with the waiting sign over it.
  // Stopping brings it back. A short answer's card, like a question back,
  // stretches to hold the sign.
  return (
    <div className="relative">
      <div
        inert={working}
        className={cn(
          "grid transition-opacity",
          working && "min-h-48 opacity-40",
        )}
      >
        <Outcome answer={answer} onAsk={onAsk} pins={pins} />
      </div>
      {working && <WaitingOver />}
    </div>
  );
}

function Outcome({
  answer,
  onAsk,
  pins,
}: {
  answer: RunAnswer;
  onAsk: (question: string) => void;
  pins: Pins;
}) {
  switch (answer.outcome) {
    case "chart":
      return <ChartCard chart={answer.chart} pins={pins} />;
    case "clarify":
      return (
        <Choices
          icon={<MessageCircleQuestion aria-hidden />}
          message={answer.message}
          questions={answer.choices}
          onAsk={onAsk}
        />
      );
    case "decline":
      return (
        <Choices
          icon={<SearchX aria-hidden />}
          message={answer.message}
          questions={answer.examples}
          hint="Try one of these:"
          onAsk={onAsk}
        />
      );
  }
}

function Waiting() {
  return (
    <Card
      aria-busy
      className="min-h-72 items-center justify-center sm:min-h-96"
    >
      <DrawingChart />
      <p className="text-sm text-muted-foreground">
        The chart appears here when the agent is done.
      </p>
    </Card>
  );
}

/**
 * The waiting sign over the last answer, outside its dimmed part, so it
 * stays at full strength. On a small card of its own, so the answer under
 * it doesn't show through the words.
 */
function WaitingOver() {
  return (
    <div
      role="status"
      className="absolute inset-0 flex items-center justify-center p-2 motion-safe:animate-in motion-safe:fade-in"
    >
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card/95 px-6 py-4 text-center">
        <DrawingChart />
        <p className="text-sm text-muted-foreground">
          The new chart appears here when the agent is done.
        </p>
      </div>
    </div>
  );
}

const X_HEADINGS = { day: "Day (UTC)", hour: "Hour", category: "Service" };
const X_DESCRIPTIONS = {
  day: "Per day, in UTC.",
  hour: "Per hour, in your time zone.",
  category: "One value per service.",
};

const PINNED_AT = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Where a saved chart's numbers came from, since no run fetched them. */
const savedNote = (saved: SavedChart) =>
  saved.from === "pin"
    ? `Pinned ${PINNED_AT.format(new Date(saved.pinnedAt))}. It keeps the numbers it had then.`
    : "Opened from a link, which carries its own numbers.";

function ChartCard({
  chart,
  saved,
  pins,
}: {
  chart: Chart;
  saved?: SavedChart;
  pins: Pins;
}) {
  const partial = chart.series.some((s) => s.points.some((p) => p.partial));
  // The drawn chart, once its code has loaded, which can download itself.
  const [drawn, setDrawn] = useState<AgChartInstance | null>(null);
  const [table, setTable] = useState(false);
  const tableId = useId();
  return (
    <Card className="motion-safe:animate-in motion-safe:fade-in">
      <CardHeader>
        <CardTitle className="leading-snug">
          <h2>{chart.title}</h2>
        </CardTitle>
        <CardDescription>
          {X_DESCRIPTIONS[chart.x]}
          {partial && " Lighter points have under 24 hours of data."}
          {saved && ` ${savedNote(saved)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Summary chart={chart} />
        <ChartBoundary fallback={<ChartFailed />}>
          <Suspense fallback={<ChartLoading />}>
            <ChartView chart={chart} ref={setDrawn} />
          </Suspense>
        </ChartBoundary>
        <div className="flex flex-wrap items-center gap-2">
          <ChartActions chart={chart} drawn={drawn} pins={pins} />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            aria-expanded={table}
            aria-controls={tableId}
            onClick={() => {
              setTable(!table);
            }}
          >
            <Table aria-hidden />
            Data table
          </Button>
        </div>
        <div id={tableId} hidden={!table}>
          <DataTable chart={chart} />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The numbers that sum up the chart, side by side over it, from its own
 * points. They show before the chart's code loads, and even if it fails.
 */
function Summary({ chart }: { chart: Chart }) {
  const stats = summary(chart);
  if (stats.length === 0) return null;
  return (
    // Three columns even for two numbers, so they line up from chart to
    // chart. Each column spans the same three rows, so a label that wraps on
    // a phone keeps the numbers level.
    <dl className="grid grid-cols-3 divide-x">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="row-span-3 grid min-w-0 grid-rows-subgrid px-3 first:pl-0 last:pr-0 sm:px-5"
        >
          <dt className="text-sm text-muted-foreground">{stat.label}</dt>
          <dd className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">
            {stat.value}
          </dd>
          <dd className="text-xs text-muted-foreground">{stat.note}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Where the chart will be, the chart's height, while its code downloads: a
 * pinned chart or a link can open before it's there.
 */
function ChartLoading() {
  return (
    <div className="flex h-72 items-center justify-center sm:h-96">
      <DrawingChart />
      <p role="status" className="sr-only">
        Loading the chart…
      </p>
    </div>
  );
}

/** Where the chart would be, when its code didn't load. */
function ChartFailed() {
  return (
    <p
      role="alert"
      className="flex h-72 items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground sm:h-96"
    >
      <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      The chart couldn't load. Reload the page to try again. Its numbers are
      under Data table, below.
    </p>
  );
}

/** The chart's numbers as a table, for screen readers and anyone who wants exact values. */
function DataTable({ chart }: { chart: Chart }) {
  // A row per x value, with each series' point at it.
  type Point = Chart["series"][number]["points"][number];
  const rows = new Map<string, Map<string, Point>>();
  for (const series of chart.series) {
    for (const point of series.points) {
      const row = rows.get(point.x) ?? new Map<string, Point>();
      row.set(series.name, point);
      rows.set(point.x, row);
    }
  }
  // In time order, even when the first series lacks a day another one has.
  // ISO times sort by time as strings.
  const xs = [...rows.keys()];
  if (chart.x !== "category") xs.sort();
  return (
    <div className="overflow-x-auto text-sm">
      <table className="w-full tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-1.5 pr-4 text-left font-medium">
              {X_HEADINGS[chart.x]}
            </th>
            {chart.series.map((series) => (
              <th
                key={series.name}
                scope="col"
                className="py-1.5 pl-4 text-right font-medium"
              >
                {series.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {xs.map((x) => (
            <tr key={x} className="border-b last:border-0">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                {formatX(x, chart.x)}
              </th>
              {chart.series.map((series) => {
                const point = rows.get(x)?.get(series.name);
                return (
                  <td key={series.name} className="py-1.5 pl-4 text-right">
                    {point ? formatValue(point.y, chart.unit) : "–"}
                    {point?.partial && " (partial)"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A message with questions to click, for a question back or a refusal. */
function Choices({
  icon,
  message,
  questions,
  hint,
  onAsk,
}: {
  icon: ReactNode;
  message: string;
  questions: string[];
  hint?: string;
  onAsk: (question: string) => void;
}) {
  return (
    <Card className="motion-safe:animate-in motion-safe:fade-in">
      <CardHeader className="flex items-start gap-3 [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-primary">
        {icon}
        <h2 className="leading-snug font-semibold">{message}</h2>
      </CardHeader>
      {questions.length > 0 && (
        <CardContent className="space-y-3">
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          <div className="flex flex-wrap gap-2">
            {questions.map((question, index) => (
              <Button
                // The model could repeat a question, so its text isn't a unique key.
                key={index}
                variant="outline"
                className="h-auto py-2 text-left whitespace-normal"
                onClick={() => {
                  onAsk(question);
                }}
              >
                {question}
              </Button>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** Errors where asking again right away would fail the same way. */
const NO_RETRY: ReadonlySet<string> = new Set([
  "invalid_question",
  "rate_limited",
] satisfies ApiErrorCode[]);

function Failed({
  failure,
  onRetry,
}: {
  failure: Failure;
  onRetry: () => void;
}) {
  const retry = !NO_RETRY.has(failure.code);
  return (
    <Card role="alert" className="motion-safe:animate-in motion-safe:fade-in">
      <CardHeader className="flex items-start gap-3">
        <CircleAlert
          className="mt-0.5 size-5 shrink-0 text-destructive"
          aria-hidden
        />
        <div className="space-y-1.5">
          <h2 className="leading-none font-semibold">No answer this time</h2>
          <p className="text-sm text-muted-foreground">{failure.message}</p>
        </div>
      </CardHeader>
      {retry && (
        <CardContent>
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
