const express = require("express");
const { chromium } = require("patchright");

const app = express();
app.use(express.json());

app.get("/", (_, res) => res.json({ status: "ok" }));

app.get("/api/solve", async (req, res) => {
  const { url, sitekey } = req.query;
  return solve(res, url, sitekey);
});

app.post("/api/solve", async (req, res) => {
  const { url, sitekey } = req.body;
  return solve(res, url, sitekey);
});

async function solve(res, url, sitekey) {
  if (!url || !sitekey) {
    return res.status(400).json({ error: "Missing url or sitekey" });
  }

  console.log("[solve] Starting", { url, sitekey });
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--enable-unsafe-swiftshader",
        "--window-size=1920,1080",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await context.newPage();

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head><body style="margin:0;padding:0">
<div class="cf-turnstile" data-sitekey="${sitekey}" data-theme="light" style="width:300px;margin:50px auto"></div>
</body></html>`;

    await page.route(url + "*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: html })
    );

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    console.log("[solve] Page loaded, waiting for Turnstile...");

    let token = null;
    for (let i = 0; i < 60; i++) {
      token = await page.evaluate(() => {
        const el = document.querySelector('[name="cf-turnstile-response"]');
        if (el && el.value && el.value.length > 10) return el.value;
        return null;
      });

      if (token && token.length > 20) {
        console.log("[solve] Token found at", i, "len:", token.length);
        break;
      }

      if (i === 3) {
        try {
          const frame = page.frames().find(f => f.url().includes("challenges.cloudflare.com"));
          if (frame) {
            console.log("[solve] Found Turnstile iframe");
            await frame.click("body").catch(() => {});
          }
        } catch (e) {}
      }

      if (i % 15 === 0 && i > 0) {
        const info = await page.evaluate(() => {
          return {
            iframes: document.querySelectorAll("iframe").length,
            inputs: document.querySelectorAll('input[name="cf-turnstile-response"]').length,
            widgetDiv: !!document.querySelector(".cf-turnstile"),
          };
        });
        console.log("[solve] Iteration", i, JSON.stringify(info));
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!token) {
      console.log("[solve] Failed - no token");
      return res.status(500).json({ error: "Failed to solve Turnstile" });
    }

    console.log("[solve] Success");
    return res.status(200).json({ token });
  } catch (err) {
    console.error("[solve] Error:", err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));