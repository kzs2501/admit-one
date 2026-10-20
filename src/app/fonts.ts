import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

/**
 * The app's three typefaces, self-hosted by next/font. They live here, not in the root
 * layout, so the component catalogue (Storybook) loads exactly the same fonts.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap", preload: false });

/** Class names that define the fonts' CSS variables; put them on `<html>`. */
export const fontVariables = `${inter.variable} ${display.variable} ${mono.variable}`;
