"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { OrderRowDto } from "@/contract/dto";
import type { OrderBy, OrderSortField } from "@/contract/queries";
import { formatCount, formatEventDate, formatEventTime, formatMoney } from "@/lib/format";
import { routes } from "@/lib/routes";
import { spacers, withFocusedRow } from "@/features/organiser/domain/visible-rows";

/** Every row is one height, so the virtualiser needs no measuring. */
const ROW_HEIGHT = 56;
/** Load the next page this many rows before the end, so scrolling rarely waits. */
const FETCH_AHEAD = 20;

const STATUS_LABELS: Record<OrderRowDto["status"], string> = {
  pending: "Pending",
  paid: "Paid",
  fulfilled: "Fulfilled",
  failed: "Payment failed",
  expired: "Expired",
  refunded: "Refunded",
};

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, OrderRowDto>();

// Module scope, as TanStack Table asks: new columns on every render would rebuild every row.
const columns = helper.columns([
  helper.accessor("id", {
    header: "Order",
    cell: (info) => (
      <Link
        href={routes.organiserOrder(info.getValue())}
        className="font-mono text-xs underline underline-offset-4 hover:text-accent"
      >
        {info.getValue()}
      </Link>
    ),
  }),
  helper.accessor("createdAt", {
    header: "Placed",
    cell: (info) => (
      <span className="tabular-nums">
        {formatEventDate(info.getValue(), "Asia/Kolkata")}, {formatEventTime(info.getValue(), "Asia/Kolkata")}
      </span>
    ),
  }),
  helper.accessor("buyerName", {
    header: "Buyer",
    cell: (info) => (
      <span className="block truncate">
        {info.getValue()}
        <span className="block truncate text-xs text-ink-3">{info.row.original.buyerEmail}</span>
      </span>
    ),
  }),
  helper.accessor("eventName", {
    header: "Event",
    cell: (info) => <span className="block truncate">{info.getValue()}</span>,
  }),
  helper.accessor("ticketCount", {
    header: "Tickets",
    cell: (info) => <span className="tabular-nums">{formatCount(info.getValue())}</span>,
  }),
  helper.accessor("totalMinor", {
    header: "Total",
    cell: (info) => <span className="tabular-nums">{formatMoney(info.getValue(), info.row.original.currency)}</span>,
  }),
  helper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const { refundStatus, paymentMethod } = info.row.original;
      return (
        <span>
          {refundStatus === "pending" ? "Refund pending" : STATUS_LABELS[info.getValue()]}
          {paymentMethod && (
            <span className="block text-xs text-ink-3">{paymentMethod === "upi" ? "UPI" : "Card"}</span>
          )}
        </span>
      );
    },
  }),
]);

/** The columns the server can sort by, and the column each one is. */
const SORTABLE: Partial<Record<string, OrderSortField>> = {
  createdAt: "createdAt",
  buyerName: "buyerName",
  ticketCount: "ticketCount",
  totalMinor: "totalMinor",
};

const WIDTHS: Record<string, string> = {
  id: "w-36",
  createdAt: "w-44",
  buyerName: "w-56",
  eventName: "w-48",
  ticketCount: "w-20",
  totalMinor: "w-32",
  status: "w-36",
};

/**
 * The orders, as one table however many there are. It stays a real `<table>` —
 * rows aren't positioned absolutely, which would strip its semantics in some
 * browsers — and only the rows in view are drawn, with spacer rows holding the rest
 * of the height. `aria-rowcount` and `aria-rowindex` tell a screen reader where it is
 * in the whole list, not just the rows in the DOM. Sorting is the server's (it's in
 * the URL); headers are buttons, with `aria-sort` on the sorted one, as the APG
 * sortable table does it.
 */
export function OrdersTable({
  isUpdating,
  rows,
  totalSize,
  orderBy,
  onSort,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  isUpdating: boolean;
  rows: readonly OrderRowDto[];
  totalSize: number;
  orderBy: OrderBy;
  onSort: (field: OrderSortField) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  const captionId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedIndex = useRef<number | null>(null);
  const table = useTable({ features, columns, data: rows });
  const tableRows = table.getRowModel().rows;

  // useVirtualizer returns new functions each render, so the React Compiler can't memoise
  // around it. This app doesn't use the compiler; the table re-renders when the virtualiser asks.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => tableRows[index]?.id ?? index,
    rangeExtractor: (range) => withFocusedRow(defaultRangeExtractor(range), focusedIndex.current),
  });
  const drawn = virtualizer.getVirtualItems();
  const lastDrawn = drawn.at(-1)?.index ?? 0;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastDrawn >= tableRows.length - FETCH_AHEAD) fetchNextPage();
  }, [lastDrawn, tableRows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const gaps = spacers(drawn, virtualizer.getTotalSize());
  const gapBefore = new Map(gaps.flatMap((gap) => (gap.beforeIndex === null ? [] : [[gap.beforeIndex, gap.height]])));
  const gapAfter = gaps.find((gap) => gap.beforeIndex === null)?.height ?? 0;
  const columnCount = columns.length;
  const spacer = (height: number, key: string) => (
    <tr key={key} aria-hidden="true">
      <td colSpan={columnCount} className="p-0" style={{ height }} />
    </tr>
  );

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="region"
      aria-labelledby={captionId}
      aria-busy={isUpdating || undefined}
      className={`max-h-[70vh] overflow-auto rounded-xl border border-line bg-card transition-opacity focus-visible:outline-2 focus-visible:outline-accent ${isUpdating ? "opacity-60" : ""}`}
    >
      <table aria-rowcount={totalSize + 1} className="w-full min-w-[60rem] table-fixed text-left text-sm">
        <caption id={captionId} className="sr-only">
          Orders, {formatCount(totalSize)} in all
        </caption>
        <thead className="sticky top-0 z-10 bg-sunk text-ink-2">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} aria-rowindex={1}>
              {group.headers.map((header) => {
                const field = SORTABLE[header.column.id];
                const isSorted = field !== undefined && orderBy.field === field;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={isSorted ? (orderBy.isDescending ? "descending" : "ascending") : undefined}
                    className={`px-4 py-3 font-medium ${WIDTHS[header.column.id] ?? ""}`}
                  >
                    {field ? (
                      <button
                        type="button"
                        onClick={() => {
                          onSort(field);
                        }}
                        className="inline-flex items-center gap-1 rounded hover:text-ink"
                      >
                        <table.FlexRender header={header} />
                        <span aria-hidden="true" className={isSorted ? "text-ink" : "text-ink-3"}>
                          {isSorted ? (orderBy.isDescending ? "↓" : "↑") : "↕"}
                        </span>
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody
          onFocus={(focus) => {
            const index = (focus.target as HTMLElement).closest("tr")?.dataset["index"];
            focusedIndex.current = index === undefined ? null : Number(index);
          }}
        >
          {drawn.flatMap((item) => {
            const row = tableRows[item.index];
            if (!row) return [];
            const before = gapBefore.get(item.index);
            return [
              ...(before ? [spacer(before, `gap-${String(item.index)}`)] : []),
              <tr
                key={row.id}
                data-index={item.index}
                aria-rowindex={item.index + 2}
                className="border-t border-line"
                style={{ height: ROW_HEIGHT }}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="overflow-hidden px-4 py-2 align-middle">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>,
            ];
          })}
          {gapAfter > 0 && spacer(gapAfter, "gap-end")}
        </tbody>
      </table>
      {isFetchingNextPage && (
        <p role="status" className="border-t border-line px-4 py-3 text-sm text-ink-3">
          Loading more orders…
        </p>
      )}
    </div>
  );
}
