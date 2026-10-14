/** What a buyer asks for: some quantity of a ticket tier. */
export interface LineItem {
  tierId: string;
  quantity: number;
}

export const MAX_TICKETS_PER_ORDER = 6;

export const ticketCount = (items: readonly LineItem[]) => items.reduce((total, item) => total + item.quantity, 0);

/** At or below this many tickets left, a tier (or an event) is "almost gone". */
const LOW_STOCK_THRESHOLD = 5;

export type StockLevel = "sold-out" | "low" | "plenty";

export const stockLevel = (available: number): StockLevel =>
  available === 0 ? "sold-out" : available <= LOW_STOCK_THRESHOLD ? "low" : "plenty";
