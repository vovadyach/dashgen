import type { ApiErrorCode, Chart } from "@dashgen/contracts";
import {
  ChartLine,
  CircleAlert,
  MessageCircleQuestion,
  RotateCcw,
  SearchX,
} from "lucide-react";
import { lazy, type ReactNode, Suspense } from "react";

import { formatValue, formatX } from "../chart/format.ts";
import type { Answer as RunAnswer, Failure, Run } from "../run.ts";
import { ChartBoundary } from "./chart-boundary.tsx";
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
}

/** What the question got: the chart, a question back, a refusal, or an error. */
export function Answer({ run, onAsk }: Props) {
  switch (run.status) {
    case "asking":
    case "streaming":
      return <Waiting />;
    case "answered":
      return <Outcome answer={run.answer} onAsk={onAsk} />;
    case "failed":
      return (
        <Failed
          failure={run.failure}
          onRetry={() => {
            onAsk(run.question);
          }}
        />
      );
  }
}

function Outcome({
  answer,
  onAsk,
}: {
  answer: RunAnswer;
  onAsk: (question: string) => void;
}) {
  switch (answer.outcome) {
    case "chart":
      return <ChartCard chart={answer.chart} />;
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
    <Card aria-busy className="min-h-72 items-center justify-center">
      <ChartLine
        className="size-8 text-muted-foreground motion-safe:animate-pulse"
        aria-hidden
      />
      <p className="text-sm text-muted-foreground">
        The chart appears here when the agent is done.
      </p>
    </Card>
  );
}

const X_HEADINGS = { day: "Day (UTC)", hour: "Hour", category: "Service" };
const X_DESCRIPTIONS = {
  day: "Per day, in UTC.",
  hour: "Per hour, in your time zone.",
  category: "One value per service.",
};

function ChartCard({ chart }: { chart: Chart }) {
  const partial = chart.series.some((s) => s.points.some((p) => p.partial));
  return (
    <Card className="motion-safe:animate-in motion-safe:fade-in">
      <CardHeader>
        <CardTitle className="leading-snug">
          <h2>{chart.title}</h2>
        </CardTitle>
        <CardDescription>
          {X_DESCRIPTIONS[chart.x]}
          {partial && " Lighter points have under 24 hours of data."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChartBoundary fallback={<ChartFailed />}>
          <Suspense fallback={<div className="h-72 sm:h-80" />}>
            <ChartView chart={chart} />
          </Suspense>
        </ChartBoundary>
        <DataTable chart={chart} />
      </CardContent>
    </Card>
  );
}

/** Where the chart would be, when its code didn't load. */
function ChartFailed() {
  return (
    <p
      role="alert"
      className="flex h-72 items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground sm:h-80"
    >
      <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      The chart couldn't load. Reload the page to try again. Its numbers are in
      the table below.
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
    <details className="text-sm">
      <summary className="w-fit cursor-pointer text-muted-foreground select-none hover:text-foreground">
        Data table
      </summary>
      <div className="mt-3 overflow-x-auto">
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
    </details>
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
