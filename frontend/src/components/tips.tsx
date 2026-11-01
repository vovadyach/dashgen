import { EXAMPLE_QUESTIONS, SAMPLE_SERVICES } from "@dashgen/contracts";

import { Button } from "./ui/button.tsx";

// Short labels, so the four fit on one row. A click puts the whole question
// in the box, which shows how to ask, and hovering shows it too.
const LABELS: Record<(typeof EXAMPLE_QUESTIONS)[number], string> = {
  "Show errors for payments-service this week": "payments-service errors",
  "Compare errors across all services over the last 7 days":
    "Errors, all services",
  "Which service was slowest over the last 3 days?": "Slowest service",
  "Show each service's share of errors this week as a pie chart":
    "Share of errors, as a pie",
};

const SERVICES = new Intl.ListFormat("en", { type: "conjunction" }).format(
  SAMPLE_SERVICES,
);

interface Props {
  onAsk: (question: string) => void;
  /** A question is on its way, so another can't start yet. */
  busy: boolean;
}

/** Questions to click, and what the sample data covers, so a new visitor knows what to ask. */
export function Tips({ onAsk, busy }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-sm text-muted-foreground">Try:</span>
        {EXAMPLE_QUESTIONS.map((question) => (
          <Button
            key={question}
            variant="outline"
            size="sm"
            className="rounded-full"
            title={question}
            disabled={busy}
            onClick={() => {
              onAsk(question);
            }}
          >
            {LABELS[question]}
          </Button>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        The sample data covers {SERVICES}, over the last 30 days.
      </p>
    </div>
  );
}
