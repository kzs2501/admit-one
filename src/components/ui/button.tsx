import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-60",
  secondary: "border border-line bg-card text-ink hover:bg-sunk disabled:opacity-60",
  ghost: "text-ink-2 hover:bg-sunk hover:text-ink disabled:opacity-60",
};

export function Button({
  variant = "primary",
  isBusy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; isBusy?: boolean }) {
  return (
    <button
      {...props}
      aria-busy={isBusy || undefined}
      disabled={Boolean(props.disabled) || isBusy}
      className={`inline-flex min-h-11 press items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {/* The label stays visible while busy, so the button never changes width or meaning. */}
      {isBusy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
