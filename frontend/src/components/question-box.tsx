import { ArrowUp, Square } from "lucide-react";
import { type RefObject, useLayoutEffect } from "react";

import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

/** The backend takes up to 300 characters, after trimming. */
const MAX_LENGTH = 300;

interface Props {
  ref: RefObject<HTMLTextAreaElement | null>;
  question: string;
  onChange: (question: string) => void;
  onAsk: (question: string) => void;
  onStop: () => void;
  /** A question is on its way, so the button stops it instead. */
  busy: boolean;
}

export function QuestionBox({
  ref,
  question,
  onChange,
  onAsk,
  onStop,
  busy,
}: Props) {
  const trimmed = question.trim();
  // The box grows with the question, up to a few lines, so a long one stays
  // readable, mostly on phones. CSS's field-sizing does the same, but not
  // in every browser yet.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.height = "auto";
    // The height includes the borders, which scrollHeight leaves out. Short
    // by them, one line would overflow and show a scrollbar.
    const borders = box.offsetHeight - box.clientHeight;
    box.style.height = `${String(box.scrollHeight + borders)}px`;
  }, [ref, question]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "" && !busy) onAsk(trimmed);
      }}
      className="flex items-end gap-2"
    >
      <label htmlFor="question" className="sr-only">
        Your question
      </label>
      <Textarea
        ref={ref}
        id="question"
        rows={1}
        value={question}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          // Enter asks, and Shift+Enter starts a new line.
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        maxLength={MAX_LENGTH}
        placeholder="Show errors for payments-service this week"
        autoComplete="off"
        className="max-h-40 min-h-11 resize-none py-2.5 md:text-base"
      />
      {/* Separate keys, so React swaps the element: reused, the Stop button
          would turn into Ask while its own click is still running, and the
          browser would then submit the form, asking the question again. */}
      {busy ? (
        <Button
          key="stop"
          type="button"
          variant="outline"
          size="lg"
          className="h-11"
          onClick={onStop}
          title="Stop (Esc)"
          aria-keyshortcuts="Escape"
        >
          <Square aria-hidden />
          Stop
        </Button>
      ) : (
        <Button
          key="ask"
          type="submit"
          size="lg"
          disabled={trimmed === ""}
          className="h-11"
        >
          <ArrowUp aria-hidden />
          Ask
        </Button>
      )}
    </form>
  );
}
