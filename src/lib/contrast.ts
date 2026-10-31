/**
 * Colour contrast, measured the two ways that matter: WCAG 2.x's ratio, which audits
 * use, and APCA's Lc (WCAG 3's candidate), which judges dark themes more strictly.
 * Colours are OKLCH, as globals.css writes them, converted to sRGB the way a browser
 * does (CSS Color 4), with out-of-gamut channels clipped.
 */

export type Oklch = readonly [lightness: number, chroma: number, hue: number];
type Rgb = readonly [number, number, number];

/** OKLCH to gamma-encoded sRGB, each channel 0–1. */
export function oklchToSrgb([lightness, chroma, hue]: Oklch): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [red = 0, green = 0, blue = 0] = linear.map((value) => {
    const clipped = Math.min(1, Math.max(0, value));
    return clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
  });
  return [red, green, blue];
}

function relativeLuminance(rgb: Rgb) {
  const [red = 0, green = 0, blue = 0] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.x contrast ratio, 1 to 21. Order doesn't matter. */
export function wcagRatio(foreground: Rgb, background: Rgb) {
  const [a, b] = [relativeLuminance(foreground), relativeLuminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** APCA's screen luminance, with its soft clamp for near-black. */
function apcaLuminance([red, green, blue]: Rgb) {
  const y = 0.2126729 * red ** 2.4 + 0.7151522 * green ** 2.4 + 0.072175 * blue ** 2.4;
  return y < 0.022 ? y + (0.022 - y) ** 1.414 : y;
}

/**
 * APCA lightness contrast (APCA-W3 0.0.98G-4g), as a magnitude: text on a background,
 * in either polarity. Body text wants 75 or more; large text, labels and fills, 60.
 */
export function apcaContrast(text: Rgb, background: Rgb) {
  const yText = apcaLuminance(text);
  const yBackground = apcaLuminance(background);
  if (Math.abs(yBackground - yText) < 0.0005) return 0;
  if (yBackground > yText) {
    const sapc = (yBackground ** 0.56 - yText ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (yBackground ** 0.65 - yText ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : -(sapc + 0.027) * 100;
}
