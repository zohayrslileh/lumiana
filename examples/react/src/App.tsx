import { useState } from 'react';
import puppeteer from 'puppeteer';

type TestResult = {
  title: string;
  heading: string | null;
  pid: number | undefined;
  screenshot: string;
};

export function App() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function testPuppeteer() {
    setRunning(true);
    setError(null);
    setResult(null);

    let browser;

    try {
      browser = await puppeteer.launch({
        headless: true,
      });

      const page = await browser.newPage();

      await page.goto('https://example.com', {
        waitUntil: 'networkidle0',
      });

      const title = await page.title();

      const heading = await page.$eval(
        'h1',
        (el) => el.textContent,
      );

      const screenshot = await page.screenshot({
        encoding: 'base64',
      });

      setResult({
        title,
        heading,
        pid: browser.process()?.pid,
        screenshot: `data:image/png;base64,${screenshot}`,
      });
    } catch (error: unknown) {
      console.error(error);

      setError(
        error instanceof Error
          ? error.stack ?? error.message
          : String(error),
      );
    } finally {
      await browser?.close();
      setRunning(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 900,
        margin: '40px auto',
        padding: 24,
        fontFamily: 'system-ui',
      }}
    >
      <h1>Puppeteer × Lumiana</h1>

      <p>
        Chromium is launched through Puppeteer while this React UI
        continues running in the browser.
      </p>

      <button
        onClick={testPuppeteer}
        disabled={running}
        style={{
          padding: '10px 16px',
          fontSize: 16,
          cursor: running ? 'wait' : 'pointer',
        }}
      >
        {running ? 'Running…' : 'Run Puppeteer'}
      </button>

      {error && (
        <pre
          style={{
            marginTop: 24,
            padding: 16,
            overflow: 'auto',
            background: '#181818',
            color: '#ff8c8c',
          }}
        >
          {error}
        </pre>
      )}

      {result && (
        <section style={{ marginTop: 32 }}>
          <p>
            <strong>Chromium PID:</strong>{' '}
            {result.pid ?? 'unknown'}
          </p>

          <p>
            <strong>Title:</strong> {result.title}
          </p>

          <p>
            <strong>H1:</strong> {result.heading}
          </p>

          <img
            src={result.screenshot}
            alt="Puppeteer screenshot"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 20,
              border: '1px solid #ccc',
            }}
          />
        </section>
      )}
    </main>
  );
}