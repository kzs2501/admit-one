import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "@/shared/catalog";
import type { EventView, HoldView } from "@/shared/api-types";
import { HoldTimer } from "./hold-timer";
import { AttendeesStep } from "./steps/attendees-step";
import { emptyDraft, type Draft } from "./draft";

describe("HoldTimer", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-12T10:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("shows the time left and announces only at thresholds", () => {
    const now = Date.now();
    const onExpire = vi.fn();
    render(<HoldTimer expiresAt={now + 122_000} offset={0} onExpire={onExpire} />);
    expect(screen.getByText("2:02")).toBeInTheDocument();
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("");

    act(() => vi.advanceTimersByTime(1_000));
    expect(live).toHaveTextContent(""); // 2:01 — nothing to say yet

    act(() => vi.advanceTimersByTime(2_000));
    expect(live).toHaveTextContent("2 minutes left to complete your order.");

    act(() => vi.advanceTimersByTime(30_000));
    expect(live).toHaveTextContent("2 minutes left to complete your order."); // no chatter in between
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("calls onExpire exactly once when time runs out", () => {
    const onExpire = vi.fn();
    render(<HoldTimer expiresAt={Date.now() + 2_000} offset={0} onExpire={onExpire} />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("applies the server clock offset", () => {
    render(<HoldTimer expiresAt={Date.now() + 60_000} offset={20_000} onExpire={() => {}} />);
    expect(screen.getByText("0:40")).toBeInTheDocument();
  });
});

describe("AttendeesStep", () => {
  const summit = catalog.find((e) => e.slug === "frontend-systems-summit")!;
  const event: EventView = { ...summit, tiers: summit.tiers.map((t) => ({ ...t, available: 10 })) };
  const hold: HoldView = {
    id: "hold_1",
    eventSlug: summit.slug,
    items: [
      { tierId: "fss-general", qty: 1 },
      { tierId: "fss-workshop", qty: 1 },
    ],
    createdAt: 0,
    expiresAt: 0,
    status: "active",
    orderId: null,
  };

  function setup(draft: Draft = emptyDraft()) {
    const updateDraft = vi.fn();
    const goNext = vi.fn();
    render(
      <AttendeesStep
        ctx={{ event, hold, draft, order: null }}
        holdId="hold_1"
        draft={draft}
        updateDraft={updateDraft}
        goNext={goNext}
        goBack={null}
        onExpired={() => {}}
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
    const name = screen.getAllByLabelText("Full name")[0];
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter the attendee’s full name.");
    expect(name).toHaveFocus(); // the first error gets focus
    expect(goNext).not.toHaveBeenCalled();
  });

  it("saves the draft and moves on when every ticket is filled", async () => {
    const { goNext, updateDraft, user } = setup();
    const names = screen.getAllByLabelText("Full name");
    const emails = screen.getAllByLabelText(/^Email/);
    await user.type(names[0], "Asha Rao");
    await user.type(emails[0], "asha@example.com");
    await user.type(names[1], "Dev Mehta");
    await user.type(emails[1], "dev@example.com");
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
    setup({ ...emptyDraft(), attendees: [{ name: "Asha Rao", email: "asha@example.com" }] });
    expect(screen.getAllByLabelText("Full name")[0]).toHaveValue("Asha Rao");
  });
});
