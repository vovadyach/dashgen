// From shadcn/ui (MIT): https://ui.shadcn.com/docs/components/button
// Without its asChild option, which nothing here uses, so radix-ui isn't
// needed. A component that needs Radix brings in just its own package.
// The default variant's look is ours: a light sheen and shadow, a lift on
// hover, and a quiet grey when disabled, where shadcn's fades the blue to
// half, which reads as broken.

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary bg-linear-to-b from-white/12 to-transparent text-primary-foreground shadow-sm inset-shadow-xs shadow-primary/25 inset-shadow-white/25 hover:shadow-md hover:shadow-primary/30 motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 disabled:bg-foreground/8 disabled:bg-none disabled:text-foreground/40 disabled:opacity-100 disabled:shadow-none disabled:inset-shadow-none",
        outline:
          "border bg-card shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
