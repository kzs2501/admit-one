import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost";

// Busy looks like disabled; see below for why it isn't `disabled`.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-60 aria-busy:opacity-60",
  secondary: "border border-line bg-card text-ink hover:bg-sunk disabled:opacity-60 aria-busy:opacity-60",
  ghost: "text-ink-2 hover:bg-sunk hover:text-ink disabled:opacity-60 aria-busy:opacity-60",
};

export function Button({
  variant = "primary",
  isBusy = false,
  className = "",
  children,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; isBusy?: boolean }) {
  return (
    <button
      {...props}
      // Busy, the button keeps keyboard focus, which `disabled` would drop to the page,
      // but ignores presses. That includes Enter in one of its form's fields: a form
      // submits by clicking its default button, and a cancelled click doesn't submit.
      aria-busy={isBusy || undefined}
      aria-disabled={isBusy || undefined}
      onClick={(event) => {
        if (isBusy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={`inline-flex min-h-11 press items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium disabled:cursor-not-allowed aria-busy:cursor-progress ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {/* The label stays visible while busy, so the button never changes width or meaning. */}
      {isBusy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
