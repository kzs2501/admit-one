import type { Draft } from "../draft";
import type { StepContext } from "../registry";

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
