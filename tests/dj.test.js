const {
  sanitizeName,
  qualityScore,
  pickBestFile,
  validateDownload,
  getExtension,
  formatSize,
  classifyVersion,
  sortVersions,
  planCleanup,
} = require('../src/dj');

// ─── sanitizeName ───

describe('sanitizeName', () => {
  test('removes slskd bracket prefixes', () => {
    expect(sanitizeName('[2234686892] Actuation - We R Who We R.m4a'))
      .toBe('Actuation - We R Who We R.m4a');
  });

  test('removes illegal filesystem characters', () => {
    expect(sanitizeName('Track: "Best" <Song> | Mix?.mp3'))
      .toBe('Track Best Song Mix.mp3');
  });

  test('collapses multiple spaces', () => {
    expect(sanitizeName('Artist  -   Track   Name.wav'))
      .toBe('Artist - Track Name.wav');
  });

  test('trims whitespace', () => {
    expect(sanitizeName('  Song Name.mp3  '))
      .toBe('Song Name.mp3');
  });

  test('handles empty string', () => {
    expect(sanitizeName('')).toBe('');
  });

  test('handles string with only special chars', () => {
    expect(sanitizeName(':<>"|?*')).toBe('');
  });
});

// ─── qualityScore ───

describe('qualityScore', () => {
  test('WAV scores highest (3)', () => {
    expect(qualityScore('track.wav')).toBe(3);
  });

  test('FLAC scores 2', () => {
    expect(qualityScore('track.flac')).toBe(2);
  });

  test('MP3 scores 1', () => {
    expect(qualityScore('track.mp3')).toBe(1);
  });

  test('unknown format scores 0', () => {
    expect(qualityScore('track.m4a')).toBe(0);
    expect(qualityScore('track.ogg')).toBe(0);
  });

  test('case insensitive', () => {
    expect(qualityScore('track.WAV')).toBe(3);
    expect(qualityScore('track.FLAC')).toBe(2);
    expect(qualityScore('track.MP3')).toBe(1);
  });

  test('handles no extension', () => {
    expect(qualityScore('trackname')).toBe(0);
  });
});

// ─── pickBestFile ───

describe('pickBestFile', () => {
  test('picks WAV over FLAC and MP3', () => {
    const files = [
      { filename: 'song.mp3', size: 5000000 },
      { filename: 'song.flac', size: 30000000 },
      { filename: 'song.wav', size: 50000000 },
    ];
    expect(pickBestFile(files).filename).toBe('song.wav');
  });

  test('picks FLAC over MP3', () => {
    const files = [
      { filename: 'song.mp3', size: 5000000 },
      { filename: 'song.flac', size: 30000000 },
    ];
    expect(pickBestFile(files).filename).toBe('song.flac');
  });

  test('picks larger file when same format', () => {
    const files = [
      { filename: 'song_128.mp3', size: 3000000 },
      { filename: 'song_320.mp3', size: 8000000 },
    ];
    expect(pickBestFile(files).filename).toBe('song_320.mp3');
  });

  test('ignores non-audio files', () => {
    const files = [
      { filename: 'cover.jpg', size: 500000 },
      { filename: 'song.mp3', size: 5000000 },
      { filename: 'data.txt', size: 100 },
    ];
    expect(pickBestFile(files).filename).toBe('song.mp3');
  });

  test('returns null for empty array', () => {
    expect(pickBestFile([])).toBeNull();
  });

  test('returns null for null input', () => {
    expect(pickBestFile(null)).toBeNull();
  });

  test('returns null when no audio files', () => {
    const files = [
      { filename: 'cover.jpg', size: 500000 },
      { filename: 'data.nfo', size: 100 },
    ];
    expect(pickBestFile(files)).toBeNull();
  });

  test('prefers quality over size', () => {
    const files = [
      { filename: 'song.mp3', size: 90000000 },  // huge MP3
      { filename: 'song.wav', size: 50000000 },   // smaller WAV
    ];
    expect(pickBestFile(files).filename).toBe('song.wav');
  });
});

// ─── validateDownload ───

describe('validateDownload', () => {
  test('rejects files under 500KB', () => {
    const result = validateDownload(400000, 180);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too small/i);
  });

  test('rejects files shorter than 30s', () => {
    const result = validateDownload(5000000, 25);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too short/i);
  });

  test('accepts valid files', () => {
    const result = validateDownload(50000000, 240);
    expect(result.valid).toBe(true);
  });

  test('accepts files with unknown duration', () => {
    const result = validateDownload(5000000, null);
    expect(result.valid).toBe(true);
  });

  test('rejects exactly 30s as too short', () => {
    // 30s is still under the minimum
    const result = validateDownload(5000000, 29);
    expect(result.valid).toBe(false);
  });

  test('accepts exactly 30s', () => {
    const result = validateDownload(5000000, 30);
    expect(result.valid).toBe(true);
  });

  test('edge case: exactly 512000 bytes', () => {
    const result = validateDownload(512000, 60);
    expect(result.valid).toBe(true);
  });
});

// ─── getExtension ───

describe('getExtension', () => {
  test('extracts WAV', () => {
    expect(getExtension('song.wav')).toBe('WAV');
  });

  test('extracts from path', () => {
    expect(getExtension('/path/to/song.mp3')).toBe('MP3');
  });

  test('handles no extension', () => {
    expect(getExtension('noextension')).toBe('');
  });

  test('handles empty string', () => {
    expect(getExtension('')).toBe('');
  });

  test('handles null/undefined', () => {
    expect(getExtension(null)).toBe('');
    expect(getExtension(undefined)).toBe('');
  });

  test('handles multiple dots', () => {
    expect(getExtension('song.backup.wav')).toBe('WAV');
  });
});

// ─── formatSize ───

describe('formatSize', () => {
  test('formats bytes to MB', () => {
    expect(formatSize(52428800)).toBe('50.0MB');
  });

  test('formats small files', () => {
    expect(formatSize(1048576)).toBe('1.0MB');
  });

  test('formats with decimal', () => {
    expect(formatSize(55000000)).toBe('52.5MB');
  });

  test('handles zero', () => {
    expect(formatSize(0)).toBe('0.0MB');
  });
});

// ─── classifyVersion ───

describe('classifyVersion', () => {
  test('identifies original', () => {
    expect(classifyVersion('Closer')).toBe('Original');
  });

  test('identifies extended', () => {
    expect(classifyVersion('Closer (Extended Mix)')).toBe('Extended');
  });

  test('identifies edit', () => {
    expect(classifyVersion('Closer (Radio Edit)')).toBe('Edit');
  });

  test('identifies remix', () => {
    expect(classifyVersion('Closer (R3HAB Remix)')).toBe('Remix');
  });

  test('identifies mix as remix', () => {
    expect(classifyVersion('Closer (Club Mix)')).toBe('Remix');
  });

  test('extended takes priority over remix keyword', () => {
    expect(classifyVersion('Extended Remix Version')).toBe('Extended');
  });

  test('handles empty/null', () => {
    expect(classifyVersion('')).toBe('Original');
    expect(classifyVersion(null)).toBe('Original');
  });
});

// ─── sortVersions ───

describe('sortVersions', () => {
  test('sorts Original → Extended → Remix', () => {
    const versions = [
      { name: 'Song (R3HAB Remix)' },
      { name: 'Song' },
      { name: 'Song (Extended Mix)' },
    ];
    const sorted = sortVersions(versions);
    expect(sorted[0].name).toBe('Song');
    expect(sorted[1].name).toBe('Song (Extended Mix)');
    expect(sorted[2].name).toBe('Song (R3HAB Remix)');
  });

  test('handles all same type', () => {
    const versions = [
      { name: 'Song (Remix A)' },
      { name: 'Song (Remix B)' },
    ];
    const sorted = sortVersions(versions);
    expect(sorted).toHaveLength(2);
  });

  test('does not mutate original array', () => {
    const versions = [
      { name: 'Song (Remix)' },
      { name: 'Song' },
    ];
    const original = [...versions];
    sortVersions(versions);
    expect(versions).toEqual(original);
  });

  test('edit comes before remix', () => {
    const versions = [
      { name: 'Song (Remix)' },
      { name: 'Song (Radio Edit)' },
    ];
    const sorted = sortVersions(versions);
    expect(sorted[0].name).toBe('Song (Radio Edit)');
    expect(sorted[1].name).toBe('Song (Remix)');
  });
});

// ─── planCleanup ───

describe('planCleanup', () => {
  test('identifies FLACs for conversion', () => {
    const files = [
      { name: 'song.flac', extension: 'flac', depth: 0 },
      { name: 'song.wav', extension: 'wav', depth: 0 },
    ];
    const result = planCleanup(files);
    expect(result.toConvert).toHaveLength(1);
    expect(result.toConvert[0].name).toBe('song.flac');
  });

  test('identifies m4a for deletion', () => {
    const files = [
      { name: 'song.m4a', extension: 'm4a', depth: 0 },
    ];
    const result = planCleanup(files);
    expect(result.toDelete).toHaveLength(1);
  });

  test('identifies nested files for flattening', () => {
    const files = [
      { name: 'song.wav', extension: 'wav', depth: 1 },
      { name: 'song2.mp3', extension: 'mp3', depth: 1 },
    ];
    const result = planCleanup(files);
    expect(result.toFlatten).toHaveLength(2);
  });

  test('does not flatten root-level files', () => {
    const files = [
      { name: 'song.wav', extension: 'wav', depth: 0 },
    ];
    const result = planCleanup(files);
    expect(result.toFlatten).toHaveLength(0);
  });

  test('identifies jpg/png as junk', () => {
    const files = [
      { name: 'cover.jpg', extension: 'jpg', depth: 0 },
      { name: 'art.png', extension: 'png', depth: 0 },
    ];
    const result = planCleanup(files);
    expect(result.toDelete).toHaveLength(2);
  });

  test('skips .incomplete directory', () => {
    const files = [
      { name: '.incomplete', isDirectory: true, depth: 0 },
    ];
    const result = planCleanup(files);
    expect(result.toConvert).toHaveLength(0);
    expect(result.toDelete).toHaveLength(0);
  });

  test('handles empty array', () => {
    const result = planCleanup([]);
    expect(result.toConvert).toHaveLength(0);
    expect(result.toFlatten).toHaveLength(0);
    expect(result.toDelete).toHaveLength(0);
  });
});
