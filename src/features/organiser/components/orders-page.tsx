"use client";

import { useEffect, useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ORDER_STATUSES } from "@/core/statuses";
import type { OrderFilters } from "@/contract/queries";
import { formatCount } from "@/lib/format";
import { organiserApi } from "@/lib/organiser-api";
import { organiserQueries } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { hasAnyFilter, nextOrderBy } from "@/features/organiser/domain/order-filters";
import { useOrderFilters } from "@/features/organiser/hooks/use-order-filters";
import { useOrderList } from "@/features/organiser/hooks/use-order-list";
import { OrdersTable } from "./orders-table";

const STATUS_LABELS: Record<(typeof ORDER_STATUSES)[number], string> = {
  fulfilled: "Fulfilled",
  refunded: "Refunded",
  paid: "Paid",
  pending: "Pending",
  failed: "Payment failed",
  expired: "Expired",
};

/** Typing waits this long before it searches, so every keystroke isn't a request. */
const SEARCH_DEBOUNCE_MS = 300;

function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [typed, setTyped] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  // Back or a cleared filter changes the URL: show what it now says.
  if (value !== lastValue) {
    setLastValue(value);
    setTyped(value);
  }
  useEffect(() => {
    if (typed === value) return;
    const timer = setTimeout(() => {
      onSearch(typed);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed, value, onSearch]);
  return (
    <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
      <span className="text-ink-2">Search</span>
      <input
        type="search"
        value={typed}
        onChange={(change) => {
          setTyped(change.target.value);
        }}
        placeholder="Order id, name or email"
        className="min-h-10 rounded-lg border border-line bg-card px-3"
      />
    </label>
  );
}

function Filters({
  filters,
  setFilters,
}: {
  filters: OrderFilters;
  setFilters: ReturnType<typeof useOrderFilters>["setFilters"];
}) {
  const events = useQuery(organiserQueries.events());
  return (
    <div className="space-y-4 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <SearchBox
          value={filters.q ?? ""}
          onSearch={(q) => {
            setFilters({ q: q.trim() || undefined }, { isTyping: true });
          }}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">Event</span>
          <select
            value={filters.event ?? ""}
            onChange={(change) => {
              setFilters({ event: change.target.value || undefined });
            }}
            className="min-h-10 rounded-lg border border-line bg-card px-3"
          >
            <option value="">All events</option>
            {events.data?.map((event) => (
              <option key={event.slug} value={event.slug}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">Paid with</span>
          <select
            value={filters.method ?? ""}
            onChange={(change) => {
              const method = change.target.value;
              setFilters({ method: method === "upi" || method === "card" ? method : undefined });
            }}
            className="min-h-10 rounded-lg border border-line bg-card px-3"
          >
            <option value="">Any method</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">From</span>
          <input
            type="date"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(change) => {
              setFilters({ from: change.target.value || undefined });
            }}
            className="min-h-10 rounded-lg border border-line bg-card px-3"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">To</span>
          <input
            type="date"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(change) => {
              setFilters({ to: change.target.value || undefined });
            }}
            className="min-h-10 rounded-lg border border-line bg-card px-3"
          />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm text-ink-2">Status</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
          {ORDER_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.status.includes(status)}
                onChange={(change) => {
                  setFilters({
                    status: change.target.checked
                      ? [...filters.status, status]
                      : filters.status.filter((chosen) => chosen !== status),
                  });
                }}
                className="size-4 accent-[var(--accent)]"
              />
              {STATUS_LABELS[status]}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Save a file the browser was handed, under the name the server gave it. */
function saveFile({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** Every order the account may see, filtered and sorted on the server, with the filters in the URL. */
export function OrdersPage() {
  const account = useQuery(organiserQueries.account());
  const canExport = account.data?.permissions.includes("orders:export") ?? false;
  const { filters, setFilters } = useOrderFilters();
  const list = useOrderList(filters);
  const countId = useId();
  const exportCsv = useMutation({ mutationFn: () => organiserApi.exportOrders(filters), onSuccess: saveFile });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Orders</h1>
        <div className="flex flex-wrap gap-2">
          {hasAnyFilter(filters) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFilters({
                  event: undefined,
                  status: [],
                  method: undefined,
                  from: undefined,
                  to: undefined,
                  q: undefined,
                });
              }}
            >
              Clear filters
            </Button>
          )}
          {canExport && (
            <Button type="button" variant="secondary" onClick={() => exportCsv.mutate()} isBusy={exportCsv.isPending}>
              Export CSV
            </Button>
          )}
        </div>
      </div>
      <Filters filters={filters} setFilters={setFilters} />
      {exportCsv.isError && (
        <Notice tone="bad" title="Couldn’t export the orders" role="alert">
          {exportCsv.error.message}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={countId} role="status" className="text-sm text-ink-2">
          {list.isLoading
            ? "Loading orders…"
            : list.isUpdating
              ? "Updating…"
              : `${formatCount(list.totalSize)} ${list.totalSize === 1 ? "order" : "orders"}`}
        </p>
        {list.hasNewOrders && (
          <Button type="button" variant="secondary" onClick={list.showNewOrders} className="min-h-9 px-3">
            Orders have changed — show the latest
          </Button>
        )}
      </div>
      {list.isError ? (
        <Notice tone="bad" title="Couldn’t load the orders" role="alert">
          Check your connection, then{" "}
          <button type="button" onClick={list.retry} className="underline underline-offset-4">
            try again
          </button>
          .
        </Notice>
      ) : list.isLoading ? (
        <div className="flex justify-center py-16 text-ink-3">
          <Spinner className="size-5" />
        </div>
      ) : list.totalSize === 0 ? (
        <Notice title="No orders match">Try fewer filters, or clear them.</Notice>
      ) : (
        <OrdersTable
          isUpdating={list.isUpdating}
          rows={list.rows}
          totalSize={list.totalSize}
          orderBy={filters.orderBy}
          onSort={(field) => {
            setFilters({ orderBy: nextOrderBy(filters.orderBy, field) });
          }}
          hasNextPage={list.hasNextPage}
          isFetchingNextPage={list.isFetchingNextPage}
          fetchNextPage={list.fetchNextPage}
        />
      )}
    </div>
  );
}
