#!/usr/bin/env node
/**
 * DJ Multi-Source Search API
 * Runs on localhost:8787 — queries Spotify, YouTube, SoundCloud, Soulseek in parallel
 * Returns up to 8 results (2 per source) with source labels and relevance scores
 */

const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

const PORT = 8787;
const SLSKD_URL = 'http://localhost:5893';
const SLSKD_USER = 'gatsby';
const SLSKD_PASS = 'djG4tsby!2026';
const SP_CLIENT_ID = 'f265d9bb8bea479081633c5c94efc50f';
const SP_CLIENT_SECRET = '201d3532910149f7960b2fd11f46377a';

let spToken = null, spTokenExp = 0;

// ── Helpers ──

function fetchJSON(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (url.startsWith('https') ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      timeout: opts.timeout || 10000,
    };
    const req = mod.request(reqOpts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

function classifyVersion(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('extended')) return 'Extended';
  if (n.includes('edit')) return 'Edit';
  if (n.includes('remix') || n.includes(' mix')) return 'Remix';
  return 'Original';
}

const versionOrder = { Original: 0, Extended: 1, Edit: 2, Remix: 3 };

// ── Spotify ──

async function getSpotifyToken() {
  if (spToken && Date.now() < spTokenExp) return spToken;
  const data = await fetchJSON('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${SP_CLIENT_ID}&client_secret=${SP_CLIENT_SECRET}`,
  });
  if (data && data.access_token) {
    spToken = data.access_token;
    spTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  }
  return spToken;
}

async function searchSpotify(query) {
  const token = await getSpotifyToken();
  if (!token) return [];
  const data = await fetchJSON(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=6`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!data?.tracks?.items) return [];
  // Sort by popularity, take top 2
  return data.tracks.items
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 2)
    .map(t => ({
      title: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      art: t.album.images[0]?.url || '',
      source: 'spotify',
      sourceIcon: '🟢',
      popularity: t.popularity,
      tag: classifyVersion(t.name),
      duration: Math.round(t.duration_ms / 1000),
    }));
}

// ── YouTube (yt-dlp) ──

async function searchYouTube(query) {
  try {
    const raw = execSync(
      `yt-dlp --dump-json --no-download --flat-playlist "ytsearch3:${query.replace(/"/g, '\\"')}"`,
      { timeout: 12000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // yt-dlp outputs one JSON per line
    const results = raw.trim().split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    return results.slice(0, 2).map(r => ({
      title: r.title || r.fulltitle || query,
      artist: r.channel || r.uploader || '',
      art: r.thumbnail || '',
      source: 'youtube',
      sourceIcon: '🔴',
      popularity: Math.min(99, Math.round((r.view_count || 0) / 100000)) || 50,
      tag: classifyVersion(r.title || ''),
      duration: r.duration || 0,
    }));
  } catch (e) {
    return [];
  }
}

// ── SoundCloud (DuckDuckGo scrape) ──

async function searchSoundCloud(query) {
  try {
    const raw = execSync(
      `python3 -c "
import urllib.request, urllib.parse, re, json
q = urllib.parse.quote('${query.replace(/'/g, "\\'")} site:soundcloud.com')
url = f'https://html.duckduckgo.com/html/?q={q}'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req, timeout=8).read().decode('utf-8', errors='ignore')
matches = re.findall(r'https://soundcloud\\.com/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+', html)
seen = set()
results = []
for m in matches:
    if '/sets/' in m or '/tags/' in m or '/likes' in m or m in seen: continue
    seen.add(m)
    # Extract title from URL
    parts = m.rstrip('/').split('/')
    title = parts[-1].replace('-', ' ').title()
    artist = parts[-2].replace('-', ' ').title()
    results.append({'title': title, 'artist': artist, 'url': m})
    if len(results) >= 2: break
print(json.dumps(results))
"`,
      { timeout: 12000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const results = JSON.parse(raw);
    return results.map(r => ({
      title: r.title,
      artist: r.artist,
      art: '',
      source: 'soundcloud',
      sourceIcon: '🟠',
      popularity: 40, // No popularity data from scrape
      tag: classifyVersion(r.title),
      duration: 0,
    }));
  } catch {
    return [];
  }
}

// ── Soulseek (slskd) ──

async function searchSoulseek(query) {
  // Auth
  const auth = await fetchJSON(`${SLSKD_URL}/api/v0/session`, {
    method: 'POST',
    body: { username: SLSKD_USER, password: SLSKD_PASS },
  });
  if (!auth?.token) return [];
  const token = auth.token;
  const headers = { Authorization: `Bearer ${token}` };

  // Start search
  const search = await fetchJSON(`${SLSKD_URL}/api/v0/searches`, {
    method: 'POST',
    headers,
    body: { searchText: query },
  });
  if (!search?.id) return [];

  // Poll for results (up to 8 seconds)
  await new Promise(r => setTimeout(r, 8000));
  const responses = await fetchJSON(`${SLSKD_URL}/api/v0/searches/${search.id}/responses`, { headers });

  // Cleanup search
  fetchJSON(`${SLSKD_URL}/api/v0/searches/${search.id}`, { method: 'DELETE', headers });

  if (!Array.isArray(responses)) return [];

  // Collect all audio files, score them
  const candidates = [];
  for (const resp of responses) {
    for (const f of (resp.files || [])) {
      const fn = (f.filename || '').toLowerCase();
      if (!fn.endsWith('.wav') && !fn.endsWith('.flac') && !fn.endsWith('.mp3')) continue;
      const qualScore = fn.endsWith('.wav') ? 3 : fn.endsWith('.flac') ? 2 : 1;
      const basename = (f.filename || '').split(/[/\\]/).pop();
      candidates.push({
        title: basename.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
        artist: resp.username || '',
        art: '',
        source: 'soulseek',
        sourceIcon: '🟣',
        popularity: qualScore * 25 + Math.min(25, Math.round((f.size || 0) / 2000000)),
        tag: classifyVersion(basename),
        duration: 0,
        quality: fn.endsWith('.wav') ? 'WAV' : fn.endsWith('.flac') ? 'FLAC' : 'MP3',
        sizeBytes: f.size || 0,
      });
    }
  }

  // Sort by quality score desc, take top 2
  candidates.sort((a, b) => b.popularity - a.popularity);
  return candidates.slice(0, 2);
}

// ── Server ──

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/search') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', endpoints: ['/search?q=QUERY'] }));
    return;
  }

  const query = url.searchParams.get('q');
  if (!query) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing ?q= parameter' }));
    return;
  }

  console.log(`[search] "${query}"`);

  // Search all sources in parallel
  const [spotify, youtube, soundcloud, soulseek] = await Promise.all([
    searchSpotify(query).catch(() => []),
    searchYouTube(query).catch(() => []),
    searchSoundCloud(query).catch(() => []),
    searchSoulseek(query).catch(() => []),
  ]);

  // Combine and sort: Original → Extended → Remix, then by popularity
  const all = [...spotify, ...youtube, ...soundcloud, ...soulseek];
  all.sort((a, b) => {
    const typeA = versionOrder[a.tag] ?? 99;
    const typeB = versionOrder[b.tag] ?? 99;
    if (typeA !== typeB) return typeA - typeB;
    return b.popularity - a.popularity;
  });

  // Check for cross-source duplicates (quality signal)
  const titleKey = t => t.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
  const titleSources = {};
  all.forEach(t => {
    const k = titleKey(t);
    if (!titleSources[k]) titleSources[k] = new Set();
    titleSources[k].add(t.source);
  });
  all.forEach(t => {
    const k = titleKey(t);
    t.multiSource = titleSources[k].size > 1;
    if (t.multiSource) t.popularity = Math.min(99, t.popularity + 10);
  });

  console.log(`[search] Found: Spotify=${spotify.length} YT=${youtube.length} SC=${soundcloud.length} Slsk=${soulseek.length}`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    query,
    results: all,
    sources: {
      spotify: spotify.length,
      youtube: youtube.length,
      soundcloud: soundcloud.length,
      soulseek: soulseek.length,
    },
  }));
});

server.listen(PORT, () => {
  console.log(`DJ Search API running on http://localhost:${PORT}`);
  console.log('Endpoints: GET /search?q=QUERY');
});
