import type { ReactNode } from "react";
import { Button } from "./button";

/** A step's actions: an optional Back on the left, the primary action on the right. */
export function FormActions({
  onBack,
  isBackDisabled = false,
  children,
}: {
  onBack: (() => void) | null;
  isBackDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex gap-3 ${onBack ? "justify-between" : "justify-end"}`}>
      {onBack && (
        <Button type="button" variant="ghost" onClick={onBack} disabled={isBackDisabled}>
          Back
        </Button>
      )}
      {children}
    </div>
  );
}
