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

  console.log("[solve] Starting solve for", { url, sitekey });

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    page.on("console", (msg) => {
      console.log("[page]", msg.type(), msg.text());
    });

    page.on("pageerror", (err) => {
      console.log("[page-error]", err.message);
    });

    const html = `<!DOCTYPE html>
<html><head>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head><body>
<h1>Turnstile Test</h1>
<div class="cf-turnstile" data-sitekey="${sitekey}" data-theme="light"></div>
<div id="debug">No token yet</div>
</body></html>`;

    await page.route(url + "*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: html })
    );
    
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("[solve] Page loaded");

    await page.waitForTimeout(5000);

    const pageContent = await page.content();
    console.log("[solve] Page has cf-turnstile:", pageContent.includes("cf-turnstile"));
    console.log("[solve] Page has turnstile script:", pageContent.includes("turnstile/v0/api.js"));

    let token = null;
    for (let i = 0; i < 45; i++) {
      const debugInfo = await page.evaluate(() => {
        const el = document.querySelector('[name="cf-turnstile-response"]');
        const widget = document.querySelector('.cf-turnstile');
        const iframes = document.querySelectorAll('iframe');
        const scripts = document.querySelectorAll('script[src*="turnstile"]');
        return {
          hasTokenInput: !!el,
          tokenValue: el ? el.value.substring(0, 50) : null,
          hasWidget: !!widget,
          widgetHTML: widget ? widget.innerHTML.substring(0, 200) : null,
          iframeCount: iframes.length,
          scriptCount: scripts.length,
        };
      });

      if (debugInfo.hasTokenInput && debugInfo.tokenValue && debugInfo.tokenValue.length > 20) {
        token = debugInfo.tokenValue;
        console.log("[solve] Token found!", { length: token.length });
        break;
      }

      if (i === 5) {
        await page.evaluate(() => {
          const w = document.querySelector(".cf-turnstile");
          if (w) w.style.width = "70px";
        });
        await page.click(".cf-turnstile").catch(() => {});
      }

      if (i % 10 === 0) {
        console.log("[solve] Iteration", i, JSON.stringify(debugInfo));
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!token) {
      console.log("[solve] No token found after 45s");
      return res.status(500).json({ error: "Failed to solve Turnstile" });
    }

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