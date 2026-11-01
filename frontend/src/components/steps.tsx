import { Check, LoaderCircle, X } from "lucide-react";

import type { Step } from "../run.ts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.tsx";

interface Props {
  steps: Step[];
  /** The agent is still working, so another step may come. */
  working: boolean;
}

/** The agent's tool calls, each as it arrives. */
export function Steps({ steps, working }: Props) {
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
          {working && (
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              {steps.length === 0
                ? "Reading the question…"
                : "Choosing the next step…"}
            </li>
          )}
          {!working && steps.length === 0 && (
            <li className="text-sm text-muted-foreground">No steps.</li>
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
        <p className="flex items-baseline gap-2 font-mono text-sm">
          <span className="sr-only">{failed ? "Failed:" : "Done:"}</span>
          <span className="font-medium">{step.tool}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {step.ms} ms
          </span>
        </p>
        <p className="text-sm break-words text-muted-foreground">
          {failed ? step.error : step.result}
        </p>
      </div>
    </li>
  );
}
