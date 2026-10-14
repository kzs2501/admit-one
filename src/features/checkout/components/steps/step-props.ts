import type { Draft } from "@/features/checkout/hooks/use-draft";
import type { StepContext } from "@/features/checkout/domain/step-registry";

export type StepProps = {
  ctx: StepContext;
  holdId: string;
  draft: Draft;
  updateDraft: (patch: Partial<Draft>) => void;
  goNext: () => void;
  goBack: (() => void) | null;
  /** The server said the hold is gone: re-read it so the flow shows the expired state. */
  onExpired: () => void;
};
