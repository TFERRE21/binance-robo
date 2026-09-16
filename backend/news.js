const express = require("express");

const router = express.Router();

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const REQUEST_TIMEOUT = 10000;

const RSS_SOURCES = [
  {
    name: "Google News",
    url:
      "https://news.google.com/rss/search?q=crypto%20OR%20bitcoin%20OR%20ethereum&hl=pt-BR&gl=BR&ceid=BR:pt-419"
  },
  {
    name: "Cointelegraph",
    url:
      "https://cointelegraph.com/rss"
  }
];

const BINANCE_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT"
];

// ============================================================
// FETCH COM TIMEOUT
// ============================================================

async function fetchWithTimeout(
  url,
  options = {},
  timeout = REQUEST_TIMEOUT
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    const response =
      await fetch(url, {
        ...options,
        signal:
          controller.signal
      });

    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// ESCAPAR HTML
// ============================================================

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// REMOVER TAGS HTML
// ============================================================

function stripHtml(value) {
  return String(value || "")
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

// ============================================================
// EXTRAIR TAG XML
// ============================================================

function extractTag(
  xml,
  tag
) {
  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    xml.match(regex);

  if (!match) {
    return "";
  }

  return match[1]
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
      "$1"
    )
    .trim();
}

// ============================================================
// EXTRAIR ATRIBUTO XML
// ============================================================

function extractAttribute(
  xml,
  tag,
  attribute
) {
  const regex =
    new RegExp(
      `<${tag}[^>]*${attribute}=["']([^"']+)["'][^>]*>`,
      "i"
    );

  const match =
    xml.match(regex);

  return match
    ? match[1]
    : "";
}

// ============================================================
// PARSER RSS
// ============================================================

function parseRss(
  xml,
  sourceName
) {
  const items = [];

  const matches =
    xml.match(
      /<item[\s\S]*?<\/item>/gi
    ) || [];

  for (const item of matches) {
    const title =
      stripHtml(
        extractTag(
          item,
          "title"
        )
      );

    const link =
      extractTag(
        item,
        "link"
      );

    const pubDate =
      extractTag(
        item,
        "pubDate"
      );

    const description =
      stripHtml(
        extractTag(
          item,
          "description"
        )
      );

    const image =
      extractAttribute(
        item,
        "media:content",
        "url"
      ) ||
      extractAttribute(
        item,
        "media:thumbnail",
        "url"
      );

    if (!title) {
      continue;
    }

    items.push({
      title,
      link,
      description,
      publishedAt:
        pubDate
          ? new Date(
              pubDate
            ).toISOString()
          : null,
      source:
        sourceName,
      image:
        image || null
    });
  }

  return items;
}

// ============================================================
// BUSCAR RSS
// ============================================================

async function fetchRssSource(
  source
) {
  try {
    const response =
      await fetchWithTimeout(
        source.url,
        {
          headers: {
            "User-Agent":
              "CriptoPro/1.0"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const xml =
      await response.text();

    return parseRss(
      xml,
      source.name
    );
  } catch (error) {
    console.error(
      `Erro RSS ${source.name}:`,
      error.message
    );

    return [];
  }
}

// ============================================================
// FILTRAR POR DATA
// ============================================================

function filterByDays(
  articles,
  days
) {
  const limit =
    Date.now() -
    days *
      24 *
      60 *
      60 *
      1000;

  return articles.filter(
    (article) => {
      if (
        !article.publishedAt
      ) {
        return true;
      }

      const time =
        new Date(
          article.publishedAt
        ).getTime();

      return (
        Number.isFinite(time) &&
        time >= limit
      );
    }
  );
}

// ============================================================
// REMOVER DUPLICADOS
// ============================================================

function deduplicateArticles(
  articles
) {
  const seen =
    new Set();

  const result = [];

  for (const article of articles) {
    const key =
      (
        article.link ||
        article.title
      )
        .toLowerCase()
        .trim();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    result.push(article);
  }

  return result;
}

// ============================================================
// BUSCAR DADOS DA BINANCE
// ============================================================

async function fetchBinanceMarket(
  symbol
) {
  try {
    const tickerResponse =
      await fetchWithTimeout(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
      );

    if (!tickerResponse.ok) {
      throw new Error(
        `Ticker HTTP ${tickerResponse.status}`
      );
    }

    const ticker =
      await tickerResponse.json();

    return {
      symbol,
      price:
        Number(
          ticker.lastPrice || 0
        ),
      changePercent:
        Number(
          ticker.priceChangePercent ||
            0
        ),
      high:
        Number(
          ticker.highPrice || 0
        ),
      low:
        Number(
          ticker.lowPrice || 0
        ),
      volume:
        Number(
          ticker.volume || 0
        ),
      quoteVolume:
        Number(
          ticker.quoteVolume || 0
        )
    };
  } catch (error) {
    console.error(
      `Erro Binance ${symbol}:`,
      error.message
    );

    return null;
  }
}

// ============================================================
// GET /api/news/crypto
// ============================================================

router.get(
  "/crypto",
  async (req, res) => {
    try {
      let days =
        Number(
          req.query.days || 7
        );

      if (
        !Number.isFinite(days)
      ) {
        days = 7;
      }

      days = Math.min(
        Math.max(days, 1),
        30
      );

      // ======================================================
      // RSS EM PARALELO
      // ======================================================

      const rssResults =
        await Promise.allSettled(
          RSS_SOURCES.map(
            fetchRssSource
          )
        );

      let articles = [];

      for (const result of rssResults) {
        if (
          result.status ===
          "fulfilled"
        ) {
          articles.push(
            ...result.value
          );
        }
      }

      // ======================================================
      // FILTRO E ORDENAÇÃO
      // ======================================================

      articles =
        filterByDays(
          articles,
          days
        );

      articles =
        deduplicateArticles(
          articles
        );

      articles.sort(
        (a, b) => {
          const dateA =
            a.publishedAt
              ? new Date(
                  a.publishedAt
                ).getTime()
              : 0;

          const dateB =
            b.publishedAt
              ? new Date(
                  b.publishedAt
                ).getTime()
              : 0;

          return (
            dateB - dateA
          );
        }
      );

      // ======================================================
      // LIMITAR NOTÍCIAS
      // ======================================================

      articles =
        articles.slice(
          0,
          40
        );

      // ======================================================
      // MERCADO BINANCE
      // ======================================================

      const marketResults =
        await Promise.allSettled(
          BINANCE_SYMBOLS.map(
            fetchBinanceMarket
          )
        );

      const market = [];

      for (
        const result of
        marketResults
      ) {
        if (
          result.status ===
            "fulfilled" &&
          result.value
        ) {
          market.push(
            result.value
          );
        }
      }

      // ======================================================
      // RESPOSTA
      // ======================================================

      return res.json({
        success: true,

        generatedAt:
          new Date().toISOString(),

        days,

        articles,

        market,

        sources:
          RSS_SOURCES.map(
            (source) =>
              source.name
          )
      });
    } catch (error) {
      console.error(
        "ERRO AO BUSCAR NOTÍCIAS:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          "Não foi possível consultar as notícias.",

        articles: [],

        market: []
      });
    }
  }
);

module.exports = router;
