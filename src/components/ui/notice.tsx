import type { ReactNode } from "react";

type Tone = "info" | "ok" | "warn" | "bad";
const TONE_CLASSES: Record<Tone, string> = {
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
    <div role={role} className={`rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[tone]}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1 text-ink-2" : "text-ink-2"}>{children}</div>}
    </div>
  );
}
