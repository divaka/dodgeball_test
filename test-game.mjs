import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const screenshotDir = path.resolve("output/web-game");
fs.mkdirSync(screenshotDir, { recursive: true });

const actions = [
  { keys: ["ArrowRight"], frames: 22 },
  { keys: ["ArrowDown"], frames: 12 },
  { keys: ["Shift"], frames: 18 },
  { keys: [], frames: 40 },
];

const TEST_URL = process.env.TEST_URL || "http://127.0.0.1:4173";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 430, height: 980 },
    isMobile: true,
    hasTouch: true,
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(TEST_URL, { waitUntil: "networkidle" });
  await page.click("#startBtn");

  for (const action of actions) {
    for (const key of action.keys) await page.keyboard.down(key);
    for (let i = 0; i < action.frames; i += 1) {
      await page.evaluate(async () => {
        if (typeof window.advanceTime === "function") await window.advanceTime(1000 / 60);
      });
    }
    for (const key of action.keys) await page.keyboard.up(key);
  }

  const stateAfterMove = await page.evaluate(() => window.render_game_to_text());
  await page.locator("canvas").screenshot({ path: path.join(screenshotDir, "play-state.png") });

  await page.evaluate(async () => {
    if (typeof window.advanceTime === "function") await window.advanceTime(35000);
  });

  const stateAfterSurvival = await page.evaluate(() => window.render_game_to_text());
  await page.locator("canvas").screenshot({ path: path.join(screenshotDir, "late-state.png") });

  await page.evaluate(async () => {
    if (typeof window.advanceTime === "function") await window.advanceTime(70000);
  });

  const gameOverVisible = await page.locator("#gameOverOverlay").evaluate((node) => {
    return !node.classList.contains("hidden");
  });

  await page.click("#restartBtn");
  const stateAfterRestart = await page.evaluate(() => window.render_game_to_text());

  console.log(
    JSON.stringify(
      {
        stateAfterMove: JSON.parse(stateAfterMove),
        stateAfterSurvival: JSON.parse(stateAfterSurvival),
        gameOverVisible,
        stateAfterRestart: JSON.parse(stateAfterRestart),
        consoleErrors,
        screenshotDir,
      },
      null,
      2,
    ),
  );

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
