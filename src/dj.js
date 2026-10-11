/**
 * DJ Download System — Core Logic
 * Extracted from Mission Control for testability
 */

/**
 * Sanitize a filename — remove brackets, slskd prefixes, special chars
 * @param {string} name - Raw filename
 * @returns {string} Clean filename
 */
function sanitizeName(name) {
  return name
    .replace(/\[\d+\]\s*/g, '')        // Remove [12345] slskd prefixes
    .replace(/[<>:"/\\|?*]/g, '')      // Remove illegal filesystem chars
    .replace(/\s{2,}/g, ' ')           // Collapse multiple spaces
    .trim();
}

/**
 * Determine audio quality priority score (higher = better)
 * @param {string} filename - Filename or extension
 * @returns {number} Quality score: WAV/WAVE/AIFF=3, FLAC=2, MP3=1, other=0
 */
function qualityScore(filename) {
  const fn = filename.toLowerCase();
  if (fn.endsWith('.wav') || fn.endsWith('.wave')) return 3;
  if (fn.endsWith('.aiff') || fn.endsWith('.aif')) return 3;
  if (fn.endsWith('.flac')) return 2;
  if (fn.endsWith('.mp3')) return 1;
  return 0;
}

function stripExtension(name) {
  return (name || '').split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
}

function normalizeTokens(value) {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(feat|featuring|ft|with|x)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function normalizeCompact(value) {
  return normalizeTokens(value).join('');
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function looksLikeArtistList(value) {
  return /,|&|\band\b|\bfeat\b|\bfeaturing\b|\bft\b/i.test(value || '');
}

/**
 * Parse common DJ queue formats into title-first search pieces.
 * Supports "Song — Artist" from Mission Control and "Artist - Song".
 * Treats spaced en dash as artist-first unless the right side clearly looks
 * like an artist list, which keeps pasted Beatport-style rows searchable.
 * @param {string} query
 * @returns {{title: string, artist: string, searchText: string}}
 */
function parseSongQuery(query) {
  const raw = (query || '').trim();
  let title = raw;
  let artist = '';

  const emDash = raw.match(/^(.+?)\s*—\s*(.+)$/);
  if (emDash) {
    title = emDash[1].trim();
    artist = emDash[2].trim();
  } else {
    const byArtist = raw.match(/^(.+?)\s+by\s+(.+)$/i);
    if (byArtist) {
      title = byArtist[1].trim();
      artist = byArtist[2].trim();
    } else {
      const enDash = raw.match(/^(.+?)\s+–\s+(.+)$/);
      if (enDash) {
        const left = enDash[1].trim();
        const right = enDash[2].trim();
        if (looksLikeArtistList(right) && !looksLikeArtistList(left)) {
          title = left;
          artist = right;
        } else {
          artist = left;
          title = right;
        }
      } else {
        const tightEnDash = raw.match(/^(.+?)\s*–\s*(.+)$/);
        if (tightEnDash) {
          title = tightEnDash[1].trim();
          artist = tightEnDash[2].trim();
        } else {
          const dash = raw.match(/^(.+?)\s+-\s+(.+)$/);
          if (dash) {
            artist = dash[1].trim();
            title = dash[2].trim();
          }
        }
      }
    }
  }

  const searchText = title || raw;
  return { title: title || raw, artist, searchText };
}

/**
 * Score how well a Soulseek filename matches the intended track.
 * Title match is mandatory-ish; artist is a bonus so remixes and messy tags
 * still have a chance when the filename contains the song name.
 * @param {string} filename
 * @param {string|object} query
 * @returns {number}
 */
function songMatchScore(filename, query) {
  const parsed = typeof query === 'object' ? query : parseSongQuery(query || '');
  const base = stripExtension(filename);
  const fileCompact = normalizeCompact(base);
  const titleTokens = uniq(normalizeTokens(parsed.title));
  const artistTokens = uniq(normalizeTokens(parsed.artist));

  if (!titleTokens.length) return 0;

  const matchedTitle = titleTokens.filter(t => fileCompact.includes(t));
  const titleCoverage = matchedTitle.length / titleTokens.length;
  const titleCompact = normalizeCompact(parsed.title);
  let score = 0;

  if (titleCompact && fileCompact.includes(titleCompact)) score += 80;
  score += Math.round(titleCoverage * 70);

  const longTitleTokens = titleTokens.filter(t => t.length >= 4);
  const hasAnchor = longTitleTokens.some(t => fileCompact.includes(t)) || (titleCompact.length >= 4 && fileCompact.includes(titleCompact));
  if (!hasAnchor || titleCoverage < 0.45) return 0;

  if (artistTokens.length) {
    const matchedArtist = artistTokens.filter(t => fileCompact.includes(t));
    score += Math.round((matchedArtist.length / artistTokens.length) * 30);
  }

  return score;
}

/**
 * Pick the best file from a list of search results
 * Priority: title match, artist closeness, WAV > FLAC > MP3, then file size
 * @param {Array} files - Array of {filename, size} objects
 * @param {string|object} query - Optional requested track
 * @returns {object|null} Best file or null
 */
function pickBestFile(files, query = '') {
  if (!files || !files.length) return null;
  
  let best = null;
  let bestRank = null;
  for (const f of files) {
    const score = qualityScore(f.filename || '');
    if (score === 0) continue;
    if (typeof f.size === 'number' && f.size < 512000) continue;

    const match = query ? songMatchScore(f.filename || '', query) : 1;
    if (query && match <= 0) continue;
    const rank = {
      match,
      quality: score,
      size: f.size || 0,
    };
    
    if (!best) {
      best = f;
      bestRank = rank;
      continue;
    }
    
    if (
      rank.match > bestRank.match ||
      (rank.match === bestRank.match && rank.quality > bestRank.quality) ||
      (rank.match === bestRank.match && rank.quality === bestRank.quality && rank.size > bestRank.size)
    ) {
      best = f;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Validate a downloaded file
 * Rejects previews (too small or too short)
 * @param {number} sizeBytes - File size in bytes
 * @param {number|null} durationSec - Duration in seconds (null if unknown)
 * @returns {{valid: boolean, reason: string}}
 */
function validateDownload(sizeBytes, durationSec) {
  if (sizeBytes < 512000) {
    return { valid: false, reason: 'File too small — likely a preview' };
  }
  if (durationSec !== null && durationSec < 30) {
    return { valid: false, reason: 'Duration too short — likely a preview' };
  }
  return { valid: true, reason: 'ok' };
}

/**
 * Determine the file extension from a filename
 * @param {string} filename
 * @returns {string} Uppercase extension (e.g. 'WAV', 'MP3', 'FLAC')
 */
function getExtension(filename) {
  const parts = (filename || '').split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : '';
}

/**
 * Format file size in MB
 * @param {number} bytes
 * @returns {string} e.g. "52.4MB"
 */
function formatSize(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

/**
 * Classify a track version from its name
 * @param {string} name - Track name
 * @returns {string} 'Original' | 'Extended' | 'Edit' | 'Remix'
 */
function classifyVersion(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('extended')) return 'Extended';
  if (lower.includes('edit')) return 'Edit';
  if (/\boriginal\s+mix\b/.test(lower)) return 'Original';
  if (lower.includes('remix') || lower.includes(' mix')) return 'Remix';
  return 'Original';
}

/**
 * Sort track versions: Original → Extended → Remixes
 * @param {Array} versions - Array of {name, ...} objects
 * @returns {Array} Sorted array
 */
function sortVersions(versions) {
  const order = { 'Original': 0, 'Extended': 1, 'Edit': 2, 'Remix': 3 };
  return [...versions].sort((a, b) => {
    const aType = classifyVersion(a.name);
    const bType = classifyVersion(b.name);
    return (order[aType] ?? 99) - (order[bType] ?? 99);
  });
}

/**
 * Determine which files need cleanup in a DJ folder
 * @param {Array} files - Array of {name, path, isDirectory, extension}
 * @returns {{toConvert: Array, toFlatten: Array, toDelete: Array}}
 */
function planCleanup(files) {
  const toConvert = [];  // FLACs that need WAV conversion
  const toFlatten = [];  // Files in subfolders that need moving to root
  const toDelete = [];   // Junk files (m4a, cover art, playlists, empty folders)
  const junkExtensions = new Set([
    'm4a',
    'jpg',
    'jpeg',
    'png',
    'webp',
    'gif',
    'bmp',
    'txt',
    'nfo',
    'cue',
    'log',
    'm3u',
    'm3u8',
    'ini',
    'url',
    'db',
  ]);

  for (const f of files) {
    if (f.isDirectory && f.name !== '.incomplete') {
      // Directories should be flattened then removed
      toDelete.push(f);
      continue;
    }
    
    const ext = (f.extension || '').toLowerCase();
    
    if (ext === 'flac') {
      toConvert.push(f);
    } else if (junkExtensions.has(ext)) {
      toDelete.push(f);
    }
    
    if (f.depth && f.depth > 0 && (ext === 'wav' || ext === 'wave' || ext === 'aiff' || ext === 'aif' || ext === 'mp3')) {
      toFlatten.push(f);
    }
  }

  return { toConvert, toFlatten, toDelete };
}

/**
 * Check if slskd is reachable
 * @param {string} baseUrl - slskd API base URL
 * @param {number} timeoutMs - Timeout in ms
 * @returns {Promise<boolean>}
 */
async function checkSlskdHealth(baseUrl, timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}/`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// Export for testing (Node.js) or attach to window (browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeName,
    qualityScore,
    parseSongQuery,
    songMatchScore,
    pickBestFile,
    validateDownload,
    getExtension,
    formatSize,
    classifyVersion,
    sortVersions,
    planCleanup,
    checkSlskdHealth,
  };
}
