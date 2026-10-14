/** Quantity stepper: − and + buttons around a live, announced count. */
export function Stepper({
  label,
  value,
  min = 0,
  max,
  onChange,
  isDisabled = false,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (quantity: number) => void;
  isDisabled?: boolean;
}) {
  const buttonClassName =
    "press grid size-11 place-items-center rounded-lg border border-line bg-card text-lg text-ink hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1.5">
      <button
        type="button"
        className={buttonClassName}
        aria-label={`Fewer: ${label}`}
        disabled={isDisabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output aria-live="polite" className="tabular w-8 text-center text-base">
        {value}
      </output>
      <button
        type="button"
        className={buttonClassName}
        aria-label={`More: ${label}`}
        disabled={isDisabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
