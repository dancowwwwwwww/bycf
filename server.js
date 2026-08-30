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

    const html = `<!DOCTYPE html>
<html><head>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head><body>
<div class="cf-turnstile" data-sitekey="${sitekey}" data-theme="light"></div>
</body></html>`;

    await page.route(url + "*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: html })
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("[solve] Page loaded");

    let token = null;
    for (let i = 0; i < 45; i++) {
      token = await page.evaluate(() => {
        const el = document.querySelector('[name="cf-turnstile-response"]');
        if (el && el.value && el.value.length > 10) return el.value;
        const all = document.querySelectorAll("input");
        for (const inp of all) {
          if (inp.name && inp.name.includes("turnstile") && inp.value && inp.value.length > 20) return inp.value;
        }
        return null;
      });

      if (token && token.length > 20) {
        console.log("[solve] Token found at iteration", i);
        break;
      }

      if (i === 5) {
        await page.evaluate(() => {
          const w = document.querySelector(".cf-turnstile");
          if (w) w.style.width = "70px";
        });
        await page.click(".cf-turnstile").catch(() => {});
      }

      if (i % 10 === 0 && i > 0) {
        console.log("[solve] Still waiting, iteration", i);
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!token) {
      console.log("[solve] No token found after 45s");
      return res.status(500).json({ error: "Failed to solve Turnstile" });
    }

    console.log("[solve] Success, token length:", token.length);
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