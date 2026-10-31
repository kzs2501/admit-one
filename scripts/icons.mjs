#!/usr/bin/env node
/**
 * The installable app's icons (public/icons/*.png), drawn from src/app/icon.svg, so they
 * never drift from the favicon. Run after changing the icon: node scripts/icons.mjs
 * The maskable one sits on the jade, inside the middle 80%, where every platform's mask
 * leaves it whole.
 */
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("src/app/icon.svg", "utf8");
const JADE = "#02675a";
const ICONS = [
  { file: "public/icons/icon-192.png", size: 192, background: "transparent", inset: 0 },
  { file: "public/icons/icon-512.png", size: 512, background: "transparent", inset: 0 },
  { file: "public/icons/maskable-512.png", size: 512, background: JADE, inset: 0.2 },
];

const browser = await chromium.launch();
for (const { file, size, background, inset } of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const pad = size * inset;
  // The maskable icon's ticket is drawn in brass, so it stands out from its jade ground.
  const art = inset
    ? svg.replace('fill="#02675a"', 'fill="#dcb05b"').replace('stroke="#dcb05b"', `stroke="${JADE}"`)
    : svg;
  await page.setContent(
    `<body style="margin:0;background:${background}"><div style="width:${size}px;height:${size}px;padding:${pad}px;box-sizing:border-box">${art.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body>`,
  );
  await page.screenshot({ path: file, omitBackground: background === "transparent" });
  await page.close();
  console.log(`${file} (${size}×${size})`);
}
await browser.close();
