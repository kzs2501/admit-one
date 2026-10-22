import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { saveDoorVoids } from "@/lib/door-voids";
import { organiserApi } from "@/lib/organiser-api";
import { saveOrganiserToken } from "@/lib/organiser-session";
import { useDoorVoids } from "./use-door-voids";

const problem = (code: "not_in_server_mode" | "unauthenticated", status: number) =>
  new ApiError({ type: "https://admit-one.test/p", title: code, status, detail: code, code }, null);

afterEach(() => {
  vi.restoreAllMocks();
  saveOrganiserToken(null);
});

describe("a door's refunds", () => {
  it("signed out, uses the list this device has, and says it can't check for newer ones", async () => {
    await saveDoorVoids("night-market-jazz", { codes: ["AO-OLD"], asOfMs: 5_000 });
    const download = vi.spyOn(organiserApi, "getDoorList");
    const { result } = renderHook(() => useDoorVoids("night-market-jazz"));
    await waitFor(() => {
      expect(result.current.check).toEqual({ kind: "signed-out", asOfMs: 5_000 });
    });
    expect(result.current.codes.has("AO-OLD")).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it("signed in, downloads the event's list and keeps it", async () => {
    saveOrganiserToken("token-1");
    vi.spyOn(organiserApi, "getDoorList").mockResolvedValue({
      eventSlug: "open-studio-ceramics",
      voidedCodes: ["AO-REFUNDED"],
      asOf: "2026-11-21T14:12:00.000Z",
    });
    const { result } = renderHook(() => useDoorVoids("open-studio-ceramics"));
    await waitFor(() => {
      expect(result.current.check).toEqual({ kind: "checked", asOfMs: Date.parse("2026-11-21T14:12:00.000Z") });
    });
    expect(result.current.codes.has("AO-REFUNDED")).toBe(true);
  });

  it("in server mode, where there are no organisers, says nothing", async () => {
    saveOrganiserToken("token-1");
    vi.spyOn(organiserApi, "getDoorList").mockRejectedValue(problem("not_in_server_mode", 501));
    const { result } = renderHook(() => useDoorVoids("lakeside-lights"));
    await waitFor(() => {
      expect(result.current.check).toEqual({ kind: "unavailable" });
    });
  });
});
