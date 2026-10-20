import type { Meta, StoryObj } from "@storybook/nextjs-vite";

/** Three typefaces, each with one job: Space Grotesk for headings, Inter for reading, JetBrains Mono for numbers. */
function Typography() {
  return (
    <div className="max-w-3xl space-y-8 p-8">
      <div>
        <p className="tabular text-xs tracking-[0.14em] text-ink-3 uppercase">Step 2 of 4 · eyebrow</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Who’s coming? · page heading</h1>
        <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">Your order · section heading</h2>
        <h3 className="mt-4 font-display text-lg font-semibold tracking-tight">Payment · card heading</h3>
      </div>
      <div className="space-y-2">
        <p className="text-base">Body: tickets are held for ten minutes while you check out.</p>
        <p className="text-sm text-ink-2">Secondary: we’ll send them to the email you give us.</p>
        <p className="text-xs text-ink-3">Fine print: all events, venues and people are fictional.</p>
      </div>
      <div className="space-y-1">
        <p className="tabular text-2xl">₹6,075.79</p>
        <p className="tabular text-sm text-ink-2">
          Ticket ₹4,999.00 + booking fee ₹149.97 + GST ₹926.82 · tabular numbers line up in columns
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Typography",
  component: Typography,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Typography>;

export default meta;

export const Scale: StoryObj<typeof meta> = {};
