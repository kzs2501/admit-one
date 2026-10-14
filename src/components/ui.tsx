import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 disabled:opacity-60",
  secondary: "border border-line bg-card text-ink hover:bg-sunk disabled:opacity-60",
  ghost: "text-ink-2 hover:bg-sunk hover:text-ink disabled:opacity-60",
};

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      disabled={props.disabled || busy}
      className={`inline-flex min-h-11 press items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {/* The label stays visible while busy, so the button never changes width or meaning. */}
      {busy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-5", label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} className="inline-flex">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`spinner ${className}`}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

type Tone = "info" | "ok" | "warn" | "bad";
const tones: Record<Tone, string> = {
  info: "border-line bg-sunk text-ink",
  ok: "border-ok/30 bg-ok-soft text-ink",
  warn: "border-warn/30 bg-warn-soft text-ink",
  bad: "border-bad/30 bg-bad-soft text-ink",
};

export function Notice({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div role={role} className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1 text-ink-2" : "text-ink-2"}>{children}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-card ${className}`}>{children}</div>;
}

/** Quantity stepper: buttons for pointer users, a native number input for everything else. */
export function Stepper({
  label,
  value,
  min = 0,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const btn =
    "press grid size-11 place-items-center rounded-lg border border-line bg-card text-lg text-ink hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1.5">
      <button
        type="button"
        className={btn}
        aria-label={`Fewer: ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output aria-live="polite" className="tabular w-8 text-center text-base">
        {value}
      </output>
      <button
        type="button"
        className={btn}
        aria-label={`More: ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
