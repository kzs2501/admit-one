import type { InputHTMLAttributes } from "react";

/**
 * A labelled input with its error wired up for assistive technology: the error is
 * the input's description, and `aria-invalid` marks it. Spread a form library's
 * `register(...)` result into `inputProps`.
 */
export function TextField({
  id,
  label,
  hint,
  error,
  inputProps,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-ink-2">
        {label}
        {hint && <span className="text-ink-3"> ({hint})</span>}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
        className={`mt-1.5 h-11 w-full rounded-lg border border-line bg-paper px-3 text-base aria-[invalid=true]:border-bad ${inputProps.className ?? ""}`}
      />
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
