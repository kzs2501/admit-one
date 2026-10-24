import { Inter, Space_Grotesk } from "next/font/google";

/**
 * The app's two typefaces, self-hosted by next/font. They live here, not in the root
 * layout, so the component catalogue (Storybook) loads exactly the same fonts.
 * Monospace text, which only code-like strings use, comes from the system.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });

/** Class names that define the fonts' CSS variables; put them on `<html>`. */
export const fontVariables = `${inter.variable} ${display.variable}`;
