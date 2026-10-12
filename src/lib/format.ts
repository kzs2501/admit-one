/** Event dates are shown in the venue's own time zone, whatever the visitor's is. */
const VENUE_TZ = "Asia/Kolkata";

export const formatEventDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: VENUE_TZ,
  }).format(new Date(iso));

export const formatEventTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: VENUE_TZ })
    .format(new Date(iso))
    .replace(" ", " ");
