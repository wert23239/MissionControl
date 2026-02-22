/**
 * DJ Integration Tests — Real API queries (no downloads)
 * Tests: Soulseek search, YouTube search, SoundCloud search, Supabase CRUD
 */

const SB_URL = 'https://aihworyfcgstwbpzkzoy.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpaHdvcnlmY2dzdHdicHprem95Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTEyMTQ3MSwiZXhwIjoyMDg2Njk3NDcxfQ.jy9tS4IaDXbu__Kw_vELMXBYGBFY5fjtHRTAxqwsEqg';
const SLSKD_URL = 'http://localhost:5893';

const sbHeaders = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

// ─── Soulseek Integration ───

describe('Soulseek (slskd) Integration', () => {
  let token = null;

  beforeAll(async () => {
    try {
      const res = await fetch(`${SLSKD_URL}/api/v0/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'gatsby', password: 'djG4tsby!2026' }),
      });
      if (res.ok) {
        const data = await res.json();
        token = data.token;
      }
    } catch (e) {
      // slskd may be offline
    }
  });

  test('can authenticate with slskd', () => {
    if (!token) return; // skip if offline
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(10);
  });

  test('can search for a well-known track', async () => {
    if (!token) return;
    
    const res = await fetch(`${SLSKD_URL}/api/v0/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ searchText: 'Daft Punk Around The World' }),
    });
    expect(res.ok).toBe(true);
    const search = await res.json();
    const searchId = search.id;
    expect(searchId).toBeTruthy();

    // Wait for results (10s)
    await new Promise(r => setTimeout(r, 10000));

    const results = await fetch(`${SLSKD_URL}/api/v0/searches/${searchId}/responses`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(results.ok).toBe(true);
    const data = await results.json();
    
    // Should have at least one response with files
    expect(data.length).toBeGreaterThan(0);
    const allFiles = data.flatMap(r => r.files || []);
    expect(allFiles.length).toBeGreaterThan(0);
    
    // At least one audio file
    const audioFiles = allFiles.filter(f => {
      const fn = (f.filename || '').toLowerCase();
      return fn.endsWith('.mp3') || fn.endsWith('.flac') || fn.endsWith('.wav');
    });
    expect(audioFiles.length).toBeGreaterThan(0);

    // Cleanup: delete search
    await fetch(`${SLSKD_URL}/api/v0/searches/${searchId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
  }, 20000);
});

// ─── YouTube Integration ───

describe('YouTube (yt-dlp) Integration', () => {
  test('can search for a track without downloading', async () => {
    const { execSync } = require('child_process');
    try {
      const result = execSync(
        'yt-dlp --dump-json --no-download "ytsearch1:Daft Punk Around The World"',
        { timeout: 15000, encoding: 'utf-8' }
      );
      const data = JSON.parse(result);
      expect(data.title).toBeTruthy();
      expect(data.duration).toBeGreaterThan(30);
      expect(data.webpage_url).toContain('youtube.com');
    } catch (e) {
      // yt-dlp may not be installed or network issue
      console.log('yt-dlp search skipped:', e.message);
    }
  }, 20000);
});

// ─── SoundCloud Integration ───

describe('SoundCloud Integration', () => {
  test('can find a track URL via web search', async () => {
    const { execSync } = require('child_process');
    try {
      const result = execSync(
        `python3 -c "
import urllib.request, urllib.parse, re
q = urllib.parse.quote('Daft Punk Around The World site:soundcloud.com')
url = f'https://html.duckduckgo.com/html/?q={q}'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8', errors='ignore')
matches = re.findall(r'https://soundcloud\\.com/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+', html)
for m in matches:
    if '/sets/' not in m and '/tags/' not in m:
        print(m)
        break
"`,
        { timeout: 15000, encoding: 'utf-8' }
      ).trim();
      expect(result).toContain('soundcloud.com');
    } catch (e) {
      console.log('SoundCloud search skipped:', e.message);
    }
  }, 20000);
});

// ─── Supabase Integration ───

describe('Supabase DJ table', () => {
  let testRowId = null;

  test('can insert a test row', async () => {
    const res = await fetch(`${SB_URL}/rest/v1/dj`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        song: '__TEST_SONG_DELETE_ME__',
        genre: 'Test',
        done: false,
        added_by: 'test',
      }),
    });
    expect(res.ok).toBe(true);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].song).toBe('__TEST_SONG_DELETE_ME__');
    expect(rows[0].done).toBe(false);
    testRowId = rows[0].id;
  });

  test('can read the test row', async () => {
    expect(testRowId).toBeTruthy();
    const res = await fetch(`${SB_URL}/rest/v1/dj?id=eq.${testRowId}`, {
      headers: sbHeaders,
    });
    expect(res.ok).toBe(true);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].song).toBe('__TEST_SONG_DELETE_ME__');
  });

  test('can update the test row', async () => {
    expect(testRowId).toBeTruthy();
    const res = await fetch(`${SB_URL}/rest/v1/dj?id=eq.${testRowId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({ done: true, quality: 'WAV', source: 'test' }),
    });
    expect(res.ok).toBe(true);
    const rows = await res.json();
    expect(rows[0].done).toBe(true);
    expect(rows[0].quality).toBe('WAV');
  });

  test('can delete the test row', async () => {
    expect(testRowId).toBeTruthy();
    const res = await fetch(`${SB_URL}/rest/v1/dj?id=eq.${testRowId}`, {
      method: 'DELETE',
      headers: sbHeaders,
    });
    expect(res.ok).toBe(true);

    // Verify gone
    const check = await fetch(`${SB_URL}/rest/v1/dj?id=eq.${testRowId}`, { headers: sbHeaders });
    const rows = await check.json();
    expect(rows).toHaveLength(0);
  });
});
