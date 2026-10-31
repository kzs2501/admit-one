import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The card a shared link shows: the wordmark on terrazzo inside a double brass rule, and
 * a row of seats in the three tier colours. Made once, at build time, from the fonts in
 * _og/ (TTF, which the image renderer needs; both under the SIL Open Font License).
 */
export const alt = "Dress Circle: a ticket box office you can try";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f2f7f4";
const JADE = "#02675a";
const BRASS = "#dcb05b";
const INK = "#09251f";
const INK_2 = "#39504a";
const TIERS = ["#deb86b", "#9dd5c7", "#aac8e7"];

export default async function OpenGraphImage() {
  const [limelight, josefin] = await Promise.all([
    readFile(join(process.cwd(), "src/app/_og/Limelight-Regular.ttf")),
    readFile(join(process.cwd(), "src/app/_og/JosefinSans-SemiBold.ttf")),
  ]);
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: PAPER, padding: 36 }}>
      <div style={{ display: "flex", flex: 1, border: `4px solid ${BRASS}`, padding: 10 }}>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            border: `2px solid ${BRASS}`,
            gap: 28,
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            {TIERS.flatMap((colour) =>
              [0, 1, 2].map((seat) => (
                <div
                  key={`${colour}-${String(seat)}`}
                  style={{
                    width: 34,
                    height: 34,
                    background: colour,
                    border: `3px solid ${INK_2}`,
                    borderRadius: "8px 8px 3px 3px",
                  }}
                />
              )),
            )}
          </div>
          <div style={{ fontFamily: "Limelight", fontSize: 128, color: JADE, letterSpacing: 6 }}>DRESS CIRCLE</div>
          <div style={{ fontFamily: "Josefin Sans", fontSize: 36, color: INK, letterSpacing: 3 }}>
            A TICKET BOX OFFICE YOU CAN TRY
          </div>
          <div style={{ fontFamily: "Josefin Sans", fontSize: 24, color: INK_2, letterSpacing: 2 }}>
            SEAT MAPS · FAIR QUEUES · CARD AND UPI · OFFLINE TICKETS
          </div>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Limelight", data: limelight, weight: 400, style: "normal" },
        { name: "Josefin Sans", data: josefin, weight: 600, style: "normal" },
      ],
    },
  );
}
