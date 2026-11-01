import { QUESTION_MAX_LENGTH } from "@dashgen/contracts";
import { ArrowUp, Square } from "lucide-react";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

/** What the page can do with the box: put a question in it, or focus it. */
export interface QuestionBoxHandle {
  show: (question: string) => void;
  focus: () => void;
}

interface Props {
  ref: Ref<QuestionBoxHandle>;
  onAsk: (question: string) => void;
  onStop: () => void;
  /** A question is on its way, so the button stops it instead. */
  busy: boolean;
}

export function QuestionBox({ ref, onAsk, onStop, busy }: Props) {
  // The text lives here, not in the page, so typing redraws only the box,
  // not the chart, the steps and the watchlist with it.
  const [question, setQuestion] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      show: (text) => {
        setQuestion(text);
        box.current?.focus();
      },
      focus: () => {
        box.current?.focus();
      },
    }),
    [],
  );
  const trimmed = question.trim();
  // The box grows with the question, up to a few lines, so a long one stays
  // readable, mostly on phones. CSS's field-sizing does the same, but not
  // in every browser yet.
  useLayoutEffect(() => {
    if (box.current) fit(box.current);
  }, [question]);
  // And when its width changes, as when a phone turns sideways, since the
  // same question then takes more or fewer lines.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fit(element);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
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
        ref={box}
        id="question"
        rows={1}
        value={question}
        onChange={(event) => {
          setQuestion(event.target.value);
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
        maxLength={QUESTION_MAX_LENGTH}
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

/** Makes the box as tall as its text. */
function fit(box: HTMLTextAreaElement) {
  box.style.height = "auto";
  // The height includes the borders, which scrollHeight leaves out. Short by
  // them, one line would overflow and show a scrollbar.
  const borders = box.offsetHeight - box.clientHeight;
  box.style.height = `${String(box.scrollHeight + borders)}px`;
}
