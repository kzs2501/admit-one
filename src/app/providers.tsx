"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError, isTransientError } from "@/lib/api-client";
import { reportError } from "@/lib/monitoring";
import { showToast, Toaster } from "@/components/ui/toast";

/** Client errors (4xx) are answers, not glitches — retrying them just repeats the answer. */
const retry = (failureCount: number, error: unknown) => isTransientError(error) && failureCount < 2;

/** A problem is the server's answer, handled where it's asked; anything else is worth knowing about. */
const reportUnlessAnswer = (error: Error, source: "query" | "mutation") => {
  if (!(error instanceof ApiError)) reportError(error, { source });
};

/**
 * Errors are handled once, here, rather than in every component (TkDodo, "React Query
 * Error Handling"). A query with nothing on screen yet shows its own error state; one
 * that already has data keeps it, and a toast says the refresh failed.
 */
const createQueryClient = () =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        reportUnlessAnswer(error, "query");
        if (query.state.data !== undefined && isTransientError(error)) {
          showToast("Couldn’t refresh — showing the last update", error.message);
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        reportUnlessAnswer(error, "mutation");
      },
    }),
    defaultOptions: {
      queries: { retry, staleTime: 2_000 },
      mutations: { retry: false },
    },
  });

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser session (and per server render), never shared between them.
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
