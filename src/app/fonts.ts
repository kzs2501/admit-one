import { Josefin_Sans, Limelight, Mukta, Space_Mono } from "next/font/google";

/**
 * The app's typefaces, self-hosted by next/font (ADR 022). They live here, not in the
 * root layout, so the component catalogue (Storybook) loads exactly the same fonts.
 * Latin files only: the rupee sign comes from the device (globals.css says why).
 */
// Text and prices: Mukta, from Ek Type in Mumbai, with tabular figures.
const text = Mukta({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mukta", display: "swap" });
// Headings, in capitals: Josefin Sans, a 1920s geometric face.
const display = Josefin_Sans({ subsets: ["latin"], weight: "600", variable: "--font-josefin", display: "swap" });
// The name alone: Limelight, the lettering of an Art Deco cinema's marquee.
const wordmark = Limelight({ subsets: ["latin"], weight: "400", variable: "--font-limelight", display: "swap" });
// Codes and ids. Few pages show any, so it isn't preloaded.
const mono = Space_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-space-mono",
  display: "swap",
  preload: false,
});

/** Class names that define the fonts' CSS variables; put them on `<html>`. */
export const fontVariables = `${text.variable} ${display.variable} ${wordmark.variable} ${mono.variable}`;
