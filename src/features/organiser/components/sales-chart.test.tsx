import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SalesMetricsDto } from "@/contract/dto";
import { SalesChart } from "./sales-chart";

const metrics = (salesByDay: SalesMetricsDto["salesByDay"]) => ({ currency: "INR", salesByDay }) as SalesMetricsDto;

describe("SalesChart", () => {
  it("is an image named by its summary, with the numbers in a table", () => {
    render(
      <SalesChart
        metrics={metrics([
          { date: "2026-10-17", tickets: 4, revenueMinor: 1_200_00 },
          { date: "2026-10-18", tickets: 9, revenueMinor: 2_700_00 },
          { date: "2026-10-19", tickets: 2, revenueMinor: 600_00 },
        ])}
      />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "15 tickets sold from 17 Oct to 19 Oct. The busiest day was 18 Oct, with 9.",
    );
    const table = screen.getByRole("table", { name: "Tickets sold and revenue, by day" });
    const busiest = within(table).getByRole("rowheader", { name: "18 Oct" }).closest("tr");
    expect(busiest).toHaveTextContent("₹2,700.00");
  });

  it("says so when there's nothing to chart", () => {
    render(<SalesChart metrics={metrics([])} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("No sales yet.");
  });
});
