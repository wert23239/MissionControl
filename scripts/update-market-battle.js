#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = path.resolve(__dirname, "..");
const HTML_PATH = path.join(PROJECT_DIR, "market-battle.html");
const DEFAULT_BATTLE_KEY = "alex-elizabeth-2026-09-market-battle";
const SUPABASE_URL = "https://aihworyfcgstwbpzkzoy.supabase.co";
const PLAYERS = ["alex", "elizabeth"];
const CRYPTO_IDS = {
  doge: "dogecoin",
  dogecoin: "dogecoin",
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana"
};
const QUOTE_ALIASES = {
  doge: { symbol: "DOGE-USD", type: "Crypto" },
  dogecoin: { symbol: "DOGE-USD", type: "Crypto" },
  umg: { symbol: "UMG.AS", type: "Stock" },
  nvd: { symbol: "NVD.DE", type: "Stock" },
  lacr: { symbol: "LACR.PA", type: "Stock" }
};

const args = new Set(process.argv.slice(2));
const battleKey = process.env.MARKET_BATTLE_KEY || DEFAULT_BATTLE_KEY;
const resetEntryPrices = args.has("--reset-entry-prices");

function anonKey() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const match = html.match(/const ANON_KEY = "([^"]+)"/);
  if (!match) throw new Error(`Could not find ANON_KEY in ${HTML_PATH}`);
  return match[1];
}

function headers() {
  const key = anonKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

function cleanAssetKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const cleaned = String(value).trim().replace(/usd|eur|gbp/gi, "").replace(/[$€£\s,]/g, "");
  const num = Number(cleaned.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function formatNumber(value) {
  return Number(value.toFixed(value < 1 ? 6 : 4)).toString();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function quoteSymbolFor(pick) {
  const raw = String(pick.symbol || "").trim();
  const key = cleanAssetKey(raw);
  const alias = QUOTE_ALIASES[key];
  if (alias) return alias;
  if (pick.type === "Crypto" && !raw.includes("-")) return { symbol: `${raw.toUpperCase()}-USD`, type: "Crypto" };
  return { symbol: raw.toUpperCase(), type: pick.type || "Stock" };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*"
    }
  });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

async function fetchCoinGeckoPrice(pick) {
  const id = CRYPTO_IDS[cleanAssetKey(pick.symbol)];
  if (!id) return null;
  const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`);
  const price = data?.[id]?.usd;
  if (!Number.isFinite(price)) return null;
  return {
    price,
    symbol: String(pick.symbol || "").toUpperCase(),
    currency: "USD",
    source: "CoinGecko",
    marketTime: new Date().toISOString()
  };
}

async function fetchYahooChartPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&corsDomain=finance.yahoo.com&.tsrc=finance`;
  const data = await fetchJson(url);
  const error = data?.chart?.error;
  if (error) throw new Error(`${symbol}: ${error.description || error.code}`);
  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice ?? meta?.chartPreviousClose;
  if (!Number.isFinite(price)) throw new Error(`${symbol}: missing regularMarketPrice`);
  return {
    price,
    symbol: meta.symbol || symbol,
    currency: meta.currency || "USD",
    source: `Yahoo ${meta.fullExchangeName || meta.exchangeName || ""}`.trim(),
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString()
  };
}

async function quoteForPick(pick) {
  if (!String(pick.symbol || "").trim()) return null;
  const mapped = quoteSymbolFor(pick);
  if (mapped.type === "Crypto") {
    const coinGecko = await fetchCoinGeckoPrice(pick).catch(() => null);
    if (coinGecko) return coinGecko;
  }
  return fetchYahooChartPrice(mapped.symbol);
}

async function loadBattle() {
  const url = `${SUPABASE_URL}/rest/v1/market_battles?battle_key=eq.${encodeURIComponent(battleKey)}&select=payload,updated_at`;
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`Supabase load failed ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  if (!rows.length) throw new Error(`Battle not found: ${battleKey}`);
  return rows[0].payload;
}

function currentValueForPick(pick) {
  const startValue = asNumber(pick.start);
  const entryPrice = asNumber(pick.entryPrice);
  const currentPrice = asNumber(pick.currentPrice);
  if (startValue === null || entryPrice === null || currentPrice === null || entryPrice <= 0) return null;
  return startValue * currentPrice / entryPrice;
}

function summarize(payload, player) {
  let start = 0;
  let current = 0;
  for (const pick of payload.players[player].picks || []) {
    const startValue = asNumber(pick.start);
    const currentValue = currentValueForPick(pick);
    if (startValue !== null && currentValue !== null) {
      start += startValue;
      current += currentValue;
    }
  }
  const gain = current - start;
  return {
    value: Number(current.toFixed(2)),
    returnPct: start > 0 ? gain / start : 0
  };
}

function upsertSnapshot(payload) {
  const date = isoDate(new Date());
  const alex = summarize(payload, "alex");
  const elizabeth = summarize(payload, "elizabeth");
  const next = {
    date,
    alexValue: alex.value,
    alexReturn: alex.returnPct,
    elizabethValue: elizabeth.value,
    elizabethReturn: elizabeth.returnPct,
    automatic: true
  };
  const history = Array.isArray(payload.history) ? payload.history.filter((point) => point.date !== date) : [];
  history.push(next);
  payload.history = history.slice(-90);
}

async function saveBattle(payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/market_battles?on_conflict=battle_key`, {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ battle_key: battleKey, payload, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Supabase save failed ${response.status}: ${await response.text()}`);
  return response.json();
}

async function main() {
  const payload = await loadBattle();
  const priced = [];
  const failed = [];
  for (const player of PLAYERS) {
    for (const pick of payload.players[player].picks || []) {
      if (!String(pick.symbol || "").trim()) continue;
      try {
        const quote = await quoteForPick(pick);
        if (!quote) continue;
        const value = formatNumber(quote.price);
        if (resetEntryPrices || !asNumber(pick.entryPrice)) pick.entryPrice = value;
        pick.currentPrice = value;
        pick.current = formatNumber(currentValueForPick(pick) ?? asNumber(pick.start) ?? 100);
        pick.pricedAt = quote.marketTime;
        pick.quoteSymbol = quote.symbol;
        pick.quoteCurrency = quote.currency;
        pick.quoteSource = quote.source;
        delete pick.quoteError;
        priced.push(`${player}:${pick.symbol}->${quote.symbol} ${value} ${quote.currency}`);
      } catch (error) {
        pick.quoteError = String(error.message || error);
        failed.push(`${player}:${pick.symbol} ${pick.quoteError}`);
      }
    }
  }
  payload.quoteUpdatedAt = new Date().toISOString();
  upsertSnapshot(payload);
  await saveBattle(payload);
  console.log(`Updated ${priced.length} quotes for ${battleKey}`);
  for (const line of priced) console.log(`  ${line}`);
  if (failed.length) {
    console.log(`Failed ${failed.length} quotes`);
    for (const line of failed) console.log(`  ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
