import { CloudOff } from "lucide-react";

/**
 * Says the live demo is offline, at the top of the page, for as long as it
 * is, as between sessions, when no backend runs. Nothing can ask a question
 * then, but pins and links still open, with their own numbers. The status
 * is always there, empty while DashGen is online, so screen readers hear the
 * banner when it comes.
 */
export function OfflineBanner({ offline }: { offline: boolean }) {
  return (
    <div role="status">
      {offline && (
        <div className="border-b bg-muted motion-safe:animate-in motion-safe:fade-in">
          <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2.5 text-sm">
            <CloudOff
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span>
              <span className="font-medium">The live demo is offline.</span>{" "}
              <span className="text-muted-foreground">
                DashGen's backend runs only while it's being worked on, so it
                can't answer questions right now. Pinned charts and chart links
                still open.
              </span>
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
