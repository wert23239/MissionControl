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
 * @returns {number} Quality score: WAV=3, FLAC=2, MP3=1, other=0
 */
function qualityScore(filename) {
  const fn = filename.toLowerCase();
  if (fn.endsWith('.wav')) return 3;
  if (fn.endsWith('.flac')) return 2;
  if (fn.endsWith('.mp3')) return 1;
  return 0;
}

/**
 * Pick the best file from a list of search results
 * Priority: WAV > FLAC > MP3, then largest file size
 * @param {Array} files - Array of {filename, size} objects
 * @returns {object|null} Best file or null
 */
function pickBestFile(files) {
  if (!files || !files.length) return null;
  
  let best = null;
  for (const f of files) {
    const score = qualityScore(f.filename || '');
    if (score === 0) continue;
    
    if (!best) {
      best = f;
      continue;
    }
    
    const bestScore = qualityScore(best.filename || '');
    if (score > bestScore || (score === bestScore && (f.size || 0) > (best.size || 0))) {
      best = f;
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
  const toDelete = [];   // Junk files (m4a, jpg, empty folders)

  for (const f of files) {
    if (f.isDirectory && f.name !== '.incomplete') {
      // Directories should be flattened then removed
      continue;
    }
    
    const ext = (f.extension || '').toLowerCase();
    
    if (ext === 'flac') {
      toConvert.push(f);
    } else if (ext === 'm4a' || ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
      toDelete.push(f);
    }
    
    if (f.depth && f.depth > 0 && (ext === 'wav' || ext === 'mp3')) {
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
