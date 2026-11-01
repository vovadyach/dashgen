import { Check, Square, X } from "lucide-react";

import type { Run, Step } from "../run.ts";
import { describeStep } from "../steps.ts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.tsx";
import { Skeleton } from "./ui/skeleton.tsx";

/**
 * The agent's tool calls, each as it arrives, beside the answer. A question
 * that failed before its first step has none, so nothing shows.
 */
export function Steps({ run }: { run: Exclude<Run, { status: "idle" }> }) {
  const steps = run.status === "asking" ? [] : run.steps;
  const working = run.status === "asking" || run.status === "streaming";
  if (!working && steps.length === 0) return null;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <h2>Steps</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3" aria-live="polite">
          {steps.map((step, index) => (
            <StepRow key={index} step={step} />
          ))}
          {working && <NextStep first={steps.length === 0} />}
          {run.status === "stopped" && (
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <Square className="size-4 shrink-0" aria-hidden />
              Stopped.
            </li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: Step }) {
  const failed = "error" in step;
  return (
    <li className="flex gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1">
      {failed ? (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      ) : (
        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      )}
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm">
          <span className="sr-only">{failed ? "Failed:" : "Done:"}</span>
          {describeStep(step)}
        </p>
        <p className="font-mono text-xs break-words text-muted-foreground">
          {step.tool} · {step.ms} ms{failed ? "" : ` · ${step.result}`}
        </p>
        {failed && (
          <p className="text-sm break-words text-muted-foreground">
            {step.error}
          </p>
        )}
      </div>
    </li>
  );
}

/** Where the agent's next step will be, while it decides. */
function NextStep({ first }: { first: boolean }) {
  return (
    <li className="flex gap-3">
      <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm text-muted-foreground">
          {first ? "Reading the question…" : "Choosing the next step…"}
        </p>
        <Skeleton className="h-3 w-3/4" />
      </div>
    </li>
  );
}
