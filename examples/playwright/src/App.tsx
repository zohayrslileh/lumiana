import { useState } from "react";
import { chromium } from "playwright";

export function App() {
  const [result, setResult] = useState("Not started");

  async function run() {
    setResult("Launching Chromium...");

    const browser = await chromium.launch({
      headless: true,
    });

    const page = await browser.newPage();

    await page.goto("https://example.com");

    const title = await page.title();
    const heading = await page.locator("h1").textContent();

    await browser.close();

    setResult(
      JSON.stringify(
        {
          title,
          heading,
        },
        null,
        2
      )
    );
  }

  return (
    <main>
      <h1>Playwright + React + Lumiana</h1>

      <button onClick={run}>
        Run Playwright
      </button>

      <pre>{result}</pre>
    </main>
  );
}