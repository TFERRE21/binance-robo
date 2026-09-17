const express = require("express");

const router = express.Router();

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    })
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function cleanText(value) {
  return decodeEntities(value)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRss(xml, source) {
  const items = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const item of matches) {
    const get = (tag) => {
      const re = new RegExp(
        `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
        "i"
      );
      const match = item.match(re);
      return cleanText(match ? match[1] : "");
    };

    const title = get("title");
    const description = get("description");
    const pubDate = get("pubDate");
    const link = get("link");

    if (!title) continue;

    const parsed = Date.parse(pubDate);
    const publishedAt = Number.isFinite(parsed) ? parsed : null;

    items.push({
      source,
      title,
      description: description.slice(0, 320),
      publishedAt,
      url: link
    });
  }

  return items;
}

async function getFeed(url, source) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 CriptoPro/1.0",
      "Accept": "application/rss+xml,application/xml,text/xml,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`${source}: HTTP ${response.status}`);
  }

  return parseRss(await response.text(), source);
}

async function market7(symbol) {
  const url =
    `https://api.binance.com/api/v3/klines?symbol=${symbol}` +
    `&interval=1d&limit=8`;

  const response = await fetch(url, {
    headers: { "User-Agent": "CriptoPro/1.0" }
  });

  if (!response.ok) {
    throw new Error(`Binance ${symbol}: HTTP ${response.status}`);
  }

  const rows = await response.json();

  if (!Array.isArray(rows) || rows.length < 2) return null;

  // Primeiro candle aberto e último candle fechado/disponível.
  const firstOpen = Number(rows[0][1]);
  const lastClose = Number(rows[rows.length - 1][4]);

  if (!Number.isFinite(firstOpen) || firstOpen <= 0) return null;
  if (!Number.isFinite(lastClose) || lastClose <= 0) return null;

  return ((lastClose / firstOpen) - 1) * 100;
}

router.get("/crypto", async (req, res) => {
  try {
    const days = Math.min(7, Math.max(1, Number(req.query.days || 7)));
    const cutoff = Date.now() - days * 86400000;

    const sources = [
      [
        "https://news.google.com/rss/search?q=bitcoin%20OR%20ethereum%20OR%20binance%20OR%20crypto&hl=pt-BR&gl=BR&ceid=BR:pt-419",
        "Google News · Cripto"
      ],
      [
        "https://news.google.com/rss/search?q=criptomoedas%20OR%20Bitcoin%20OR%20Ethereum&hl=pt-BR&gl=BR&ceid=BR:pt-419",
        "Google News · Cripto BR"
      ],
      [
        "https://cointelegraph.com/rss",
        "Cointelegraph"
      ]
    ];

    const feedResults = await Promise.allSettled(
      sources.map(([url, source]) => getFeed(url, source))
    );

    let articles = [];

    for (const result of feedResults) {
      if (result.status === "fulfilled") {
        articles.push(...result.value);
      }
    }

    articles = articles
      .filter(article =>
        article.publishedAt !== null &&
        article.publishedAt >= cutoff
      )
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .filter((article, index, arr) => {
        const key = article.title.toLowerCase();
        return index === arr.findIndex(
          x => x.title.toLowerCase() === key
        );
      })
      .slice(0, 18);

    const symbols = [
      "BTCUSDT",
      "ETHUSDT",
      "BNBUSDT",
      "XRPUSDT"
    ];

    const marketResults = await Promise.allSettled(
      symbols.map(market7)
    );

    const value = (result) =>
      result.status === "fulfilled" && Number.isFinite(Number(result.value))
        ? Number(result.value)
        : null;

    return res.json({
      success: true,
      updatedAt: Date.now(),
      days,
      feedsOk: feedResults.filter(
        result => result.status === "fulfilled"
      ).length,
      market7: {
        btc7d: value(marketResults[0]),
        eth7d: value(marketResults[1]),
        bnb7d: value(marketResults[2]),
        xrp7d: value(marketResults[3])
      },
      articles
    });
  } catch (error) {
    console.error("ERRO JORNAL CRIPTOPRO:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Não foi possível atualizar o Jornal CriptoPro."
    });
  }
});

module.exports = router;
