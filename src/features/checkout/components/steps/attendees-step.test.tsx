import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HoldDto } from "@/contract/dto";
import { createEmptyDraft, type Draft } from "@/features/checkout/hooks/use-draft";
import { eventDtoFor } from "@/features/checkout/testing/fixtures";
import { AttendeesStep } from "./attendees-step";

/** The element at `index`, or a clear failure if there isn't one. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Expected an element at index ${index}`);
  return item;
}

describe("AttendeesStep", () => {
  const event = eventDtoFor("frontend-systems-summit", 10);
  const hold: HoldDto = {
    id: "hold_1",
    eventSlug: event.slug,
    items: [
      { tierId: "fss-general", quantity: 1 },
      { tierId: "fss-workshop", quantity: 1 },
    ],
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(0).toISOString(),
    status: "active",
    orderId: null,
  };

  function setup(draft: Draft = createEmptyDraft()) {
    const updateDraft = vi.fn();
    const goNext = vi.fn();
    render(
      <AttendeesStep
        context={{ event, hold, draft, order: null }}
        updateDraft={updateDraft}
        goNext={goNext}
        goBack={null}
        onExpired={vi.fn()}
      />,
    );
    return { updateDraft, goNext, user: userEvent.setup() };
  }

  it("asks for one attendee per ticket, labelled by ticket type", () => {
    setup();
    expect(screen.getByRole("group", { name: "Ticket 1 · General" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Ticket 2 · Workshop + General" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Full name")).toHaveLength(2);
  });

  it("blocks an incomplete submission with accessible errors", async () => {
    const { goNext, user } = setup();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const name = nth(screen.getAllByLabelText("Full name"), 0);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter the attendee’s full name.");
    expect(name).toHaveFocus(); // the first error gets focus
    expect(goNext).not.toHaveBeenCalled();
  });

  it("saves the draft and moves on when every ticket is filled", async () => {
    const { goNext, updateDraft, user } = setup();
    const names = screen.getAllByLabelText("Full name");
    const emails = screen.getAllByLabelText(/^Email/);
    await user.type(nth(names, 0), "Asha Rao");
    await user.type(nth(emails, 0), "asha@example.com");
    await user.type(nth(names, 1), "Dev Mehta");
    await user.type(nth(emails, 1), "dev@example.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(goNext).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenLastCalledWith({
      attendees: [
        { name: "Asha Rao", email: "asha@example.com" },
        { name: "Dev Mehta", email: "dev@example.com" },
      ],
    });
  });

  it("starts from the saved draft", () => {
    setup({ ...createEmptyDraft(), attendees: [{ name: "Asha Rao", email: "asha@example.com" }] });
    expect(nth(screen.getAllByLabelText("Full name"), 0)).toHaveValue("Asha Rao");
  });
});
