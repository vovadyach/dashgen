// Based on shadcn/ui's Skeleton (MIT): https://ui.shadcn.com/docs/components/skeleton
// A light band sweeps across it instead of a pulse, and stays still for
// visitors who turned off motion.

import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "rounded-md bg-muted bg-linear-to-r from-transparent via-shimmer to-transparent bg-size-[200%_100%] bg-no-repeat motion-safe:animate-shimmer",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
