import { ArrowUp, LoaderCircle } from "lucide-react";
import type { Ref } from "react";

import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

/** The backend takes up to 300 characters, after trimming. */
const MAX_LENGTH = 300;

interface Props {
  ref?: Ref<HTMLInputElement>;
  question: string;
  onChange: (question: string) => void;
  onAsk: (question: string) => void;
  /** A question is on its way, so another can't start yet. */
  busy: boolean;
}

export function QuestionBox({ ref, question, onChange, onAsk, busy }: Props) {
  const trimmed = question.trim();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "" && !busy) onAsk(trimmed);
      }}
      className="flex gap-2"
    >
      <label htmlFor="question" className="sr-only">
        Your question
      </label>
      <Input
        ref={ref}
        id="question"
        value={question}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        maxLength={MAX_LENGTH}
        placeholder="Show errors for payments-service this week"
        autoComplete="off"
        className="h-11 md:text-base"
      />
      <Button
        type="submit"
        size="lg"
        disabled={busy || trimmed === ""}
        className="h-11"
      >
        {busy ? (
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
        ) : (
          <ArrowUp aria-hidden />
        )}
        Ask
      </Button>
    </form>
  );
}
