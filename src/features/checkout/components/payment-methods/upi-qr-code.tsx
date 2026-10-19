import { useMemo } from "react";
import { encode } from "uqr";

/**
 * The dark modules as one path: each run of dark modules in a row becomes one
 * rectangle, so the whole code is a single element, not a thousand.
 */
export function qrPath(matrix: readonly (readonly boolean[])[]) {
  const rects: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const start = x;
      while (row[x] === true) x += 1;
      if (x > start) rects.push(`M${String(start)} ${String(y)}h${String(x - start)}v1h-${String(x - start)}z`);
      else x += 1;
    }
  });
  return rects.join("");
}

/**
 * A UPI intent link as a QR code, for a UPI app to scan. It's drawn in React — no
 * markup strings, so nothing for the content security policy to allow — and always
 * black on white, in dark mode too: scanners read dark-on-light codes most reliably,
 * and the spec asks for a light quiet zone around the code.
 */
export function UpiQrCode({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  // Error correction M (15%) suits a code on a screen; a border of 4 modules is the spec's quiet zone.
  const { size, data } = useMemo(() => encode(value, { ecc: "M", border: 4 }), [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className={`rounded-lg ${className}`}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(data)} fill="#000" />
    </svg>
  );
}
