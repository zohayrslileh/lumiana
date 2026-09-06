import { useEffect, useState } from 'react';
import { chromium } from 'playwright';

export function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');

  async function capture() {
    setStatus('Launching Chromium...');

    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const page = await browser.newPage({
        viewport: {
          width: 1440,
          height: 900,
        },
      });

      setStatus('Opening GitHub...');

      await page.goto('https://docs.phreshos.com', {
        waitUntil: 'domcontentloaded',
      });

      setStatus('Taking screenshot...');

      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true,
      });

      // Convert Playwright Buffer/Uint8Array → browser Blob
      const bytes = Uint8Array.from(screenshot);

      const blob = new Blob([bytes], {
        type: 'image/png',
      });

      const url = URL.createObjectURL(blob);

      setImageUrl((old) => {
        if (old) {
          URL.revokeObjectURL(old);
        }

        return url;
      });

      setStatus('Done');
    } finally {
      await browser.close();
    }
  }

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  return (
    <main style={{ padding: 24 }}>
      <h1>Playwright + React</h1>

      <button onClick={capture}>Capture GitHub</button>

      <p>{status}</p>

      {imageUrl && (
        <img
          src={imageUrl}
          alt="GitHub screenshot"
          style={{
            width: '100%',
            maxWidth: 1200,
            border: '1px solid #ccc',
          }}
        />
      )}
    </main>
  );
}
