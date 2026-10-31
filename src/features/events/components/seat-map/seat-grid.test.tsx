import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expandLayout, type Seat } from "@/core/seating";
import type { SeatCellState } from "./seat-cell";
import { SeatGrid } from "./seat-grid";

const plan = expandLayout({
  id: "test-hall",
  sections: [
    {
      id: "stalls",
      name: "Stalls",
      rows: [
        { label: "A", tierId: "front", blocks: [2, 2] },
        { label: "B", tierId: "front", blocks: [2, 2], wheelchairSeatNumbers: [4] },
      ],
    },
  ],
});
const [section] = plan.sections;
if (!section) throw new Error("The test hall needs a section");
const tiers = new Map([["front", { name: "Front", price: "₹1,000" }]]);

const renderGrid = ({ taken = [], selected = [] }: { taken?: string[]; selected?: string[] } = {}) => {
  const onToggle = vi.fn();
  const stateOf = (seat: Seat): SeatCellState =>
    taken.includes(seat.id) ? "taken" : selected.includes(seat.id) ? "selected" : "free";
  render(
    <SeatGrid
      section={section}
      stateOf={stateOf}
      tiers={tiers}
      tones={new Map()}
      onToggle={onToggle}
      isLoading={false}
    />,
  );
  return { onToggle, grid: screen.getByRole("grid", { name: "Stalls" }) };
};

const tabbable = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole("gridcell")
    .filter((cell) => cell.tabIndex === 0);

describe("SeatGrid", () => {
  it("is one tab stop, landing on the first free seat", async () => {
    const { grid } = renderGrid({ taken: ["stalls-A-1"] });
    expect(tabbable(grid)).toHaveLength(1);
    await userEvent.tab();
    expect(screen.getByRole("gridcell", { name: "Row A, seat 2, Front, ₹1,000" })).toHaveFocus();
  });

  it("lands on a chosen seat first, when there is one", async () => {
    renderGrid({ selected: ["stalls-B-2"] });
    await userEvent.tab();
    expect(screen.getByRole("gridcell", { name: /Row B, seat 2,/ })).toHaveFocus();
  });

  it("moves focus with the arrow keys, and the tab stop moves with it", async () => {
    const { grid } = renderGrid();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    const focused = screen.getByRole("gridcell", { name: /Row B, seat 3,/ });
    expect(focused).toHaveFocus();
    expect(tabbable(grid)).toEqual([focused]);
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("gridcell", { name: /Row B, seat 1,/ })).toHaveFocus();
  });

  it("chooses a seat with Space, Enter or a click", async () => {
    const { onToggle } = renderGrid();
    await userEvent.tab();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("gridcell", { name: /Row A, seat 4,/ }));
    expect(onToggle.mock.calls).toEqual([["stalls-A-1"], ["stalls-A-1"], ["stalls-A-4"]]);
  });

  it("says what each seat is: chosen, taken, or a wheelchair space", () => {
    renderGrid({ taken: ["stalls-A-2"], selected: ["stalls-A-1"] });
    expect(screen.getByRole("gridcell", { name: /Row A, seat 1,/ })).toHaveAttribute("aria-selected", "true");
    const taken = screen.getByRole("gridcell", { name: "Row A, seat 2, Front, ₹1,000, taken" });
    expect(taken).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("gridcell", { name: "Row B, seat 4, Front, ₹1,000, wheelchair space" })).toBeVisible();
    expect(screen.getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["A", "B"]);
  });
});
