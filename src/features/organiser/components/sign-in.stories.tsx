import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SignIn } from "./sign-in";

const meta = {
  title: "Features/Organiser/Sign in",
  component: SignIn,
  tags: ["screen"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SignIn>;

export default meta;

/** Demo accounts, each saying what its role may do: the box office can't refund. */
export const Accounts: StoryObj<typeof meta> = {};
