import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Notice } from "./notice";

const meta = {
  title: "UI/Notice",
  component: Notice,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Notice>;

export default meta;
type Story = StoryObj<typeof meta>;

const HELD = { title: "Your seats are held", children: "We’ll keep them for 10 minutes while you check out." };

export const Info: Story = { args: HELD };

export const Ok: Story = { args: { tone: "ok", title: "Payment confirmed", children: "Your tickets are ready." } };

export const Warn: Story = {
  args: {
    tone: "warn",
    title: "Just missed it",
    children: "Someone else took the last two. The numbers are up to date.",
  },
};

/** Errors are alerts: announced at once, without moving focus. */
export const Bad: Story = {
  args: { tone: "bad", role: "alert", title: "Couldn’t reserve those tickets", children: "Check your connection." },
};

export const TitleOnly: Story = { args: { title: HELD.title } };

export const BodyOnly: Story = { args: { children: HELD.children } };
