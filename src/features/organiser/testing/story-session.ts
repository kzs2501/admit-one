/** Signing in for the catalogue's dashboard stories, over HTTP like the sign-in page. */
import { expect, within } from "storybook/test";
import { organiserApi } from "@/lib/organiser-api";
import { saveOrganiserToken } from "@/lib/organiser-session";

export const LAKESIDE_OWNER = "acc-lakeside-owner";
export const LAKESIDE_BOX_OFFICE = "acc-lakeside-box-office";

/** A fulfilled order from Lakeside Live's history (the festival), and a refunded one. */
export const FULFILLED_ORDER_ID = "ord_h09076";
export const REFUNDED_ORDER_ID = "ord_h09072";

/** A story's `beforeEach`: sign in to the story's own sandbox as `accountId`. */
export const signedInAs = (accountId: string) => async () => {
  const { token } = await organiserApi.signIn(accountId);
  saveOrganiserToken(token);
};

/** Wait until the dashboard's live stream is open, so the page has stopped changing. */
export async function untilLive(canvasElement: HTMLElement) {
  await expect(await within(canvasElement).findByText("Live", {}, { timeout: 5_000 })).toBeVisible();
}
