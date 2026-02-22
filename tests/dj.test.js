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
  test('WAV scores highest (3)', () => expect(qualityScore('track.wav')).toBe(3));
  test('FLAC scores 2', () => expect(qualityScore('track.flac')).toBe(2));
  test('MP3 scores 1', () => expect(qualityScore('track.mp3')).toBe(1));
  test('unknown format scores 0', () => {
    expect(qualityScore('track.m4a')).toBe(0);
    expect(qualityScore('track.ogg')).toBe(0);
  });
  test('case insensitive', () => {
    expect(qualityScore('track.WAV')).toBe(3);
    expect(qualityScore('track.FLAC')).toBe(2);
  });
  test('handles no extension', () => expect(qualityScore('trackname')).toBe(0));
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
    ];
    expect(pickBestFile(files).filename).toBe('song.mp3');
  });

  test('returns null for empty/null', () => {
    expect(pickBestFile([])).toBeNull();
    expect(pickBestFile(null)).toBeNull();
  });

  test('prefers quality over size', () => {
    const files = [
      { filename: 'song.mp3', size: 90000000 },
      { filename: 'song.wav', size: 50000000 },
    ];
    expect(pickBestFile(files).filename).toBe('song.wav');
  });
});

// ─── validateDownload ───

describe('validateDownload', () => {
  test('rejects files under 500KB', () => {
    const r = validateDownload(400000, 180);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too small/i);
  });

  test('rejects files shorter than 30s', () => {
    const r = validateDownload(5000000, 25);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too short/i);
  });

  test('accepts valid files', () => {
    expect(validateDownload(50000000, 240).valid).toBe(true);
  });

  test('accepts files with unknown duration', () => {
    expect(validateDownload(5000000, null).valid).toBe(true);
  });

  test('edge: exactly 30s is valid', () => {
    expect(validateDownload(5000000, 30).valid).toBe(true);
  });

  test('edge: 29s is invalid', () => {
    expect(validateDownload(5000000, 29).valid).toBe(false);
  });

  test('edge: exactly 512000 bytes is valid', () => {
    expect(validateDownload(512000, 60).valid).toBe(true);
  });
});

// ─── getExtension ───

describe('getExtension', () => {
  test('extracts WAV', () => expect(getExtension('song.wav')).toBe('WAV'));
  test('extracts from path', () => expect(getExtension('/path/to/song.mp3')).toBe('MP3'));
  test('handles no extension', () => expect(getExtension('noext')).toBe(''));
  test('handles null/undefined', () => {
    expect(getExtension(null)).toBe('');
    expect(getExtension(undefined)).toBe('');
  });
  test('handles multiple dots', () => expect(getExtension('song.backup.wav')).toBe('WAV'));
});

// ─── formatSize ───

describe('formatSize', () => {
  test('formats bytes to MB', () => expect(formatSize(52428800)).toBe('50.0MB'));
  test('formats small', () => expect(formatSize(1048576)).toBe('1.0MB'));
  test('handles zero', () => expect(formatSize(0)).toBe('0.0MB'));
});

// ─── classifyVersion ───

describe('classifyVersion', () => {
  test('identifies original', () => expect(classifyVersion('Closer')).toBe('Original'));
  test('identifies extended', () => expect(classifyVersion('Closer (Extended Mix)')).toBe('Extended'));
  test('identifies edit', () => expect(classifyVersion('Closer (Radio Edit)')).toBe('Edit'));
  test('identifies remix', () => expect(classifyVersion('Closer (R3HAB Remix)')).toBe('Remix'));
  test('identifies mix as remix', () => expect(classifyVersion('Closer (Club Mix)')).toBe('Remix'));
  test('extended priority over remix', () => expect(classifyVersion('Extended Remix Version')).toBe('Extended'));
  test('handles empty/null', () => {
    expect(classifyVersion('')).toBe('Original');
    expect(classifyVersion(null)).toBe('Original');
  });
});

// ─── sortVersions ───

describe('sortVersions', () => {
  test('sorts Original → Extended → Remix', () => {
    const v = [{ name: 'Song (Remix)' }, { name: 'Song' }, { name: 'Song (Extended Mix)' }];
    const s = sortVersions(v);
    expect(s[0].name).toBe('Song');
    expect(s[1].name).toBe('Song (Extended Mix)');
    expect(s[2].name).toBe('Song (Remix)');
  });

  test('does not mutate original', () => {
    const v = [{ name: 'Remix' }, { name: 'Original' }];
    const orig = [...v];
    sortVersions(v);
    expect(v).toEqual(orig);
  });

  test('edit before remix', () => {
    const s = sortVersions([{ name: 'Song (Remix)' }, { name: 'Song (Radio Edit)' }]);
    expect(s[0].name).toBe('Song (Radio Edit)');
  });
});

// ─── planCleanup ───

describe('planCleanup', () => {
  test('identifies FLACs for conversion', () => {
    const r = planCleanup([{ name: 'song.flac', extension: 'flac', depth: 0 }]);
    expect(r.toConvert).toHaveLength(1);
  });

  test('identifies m4a for deletion', () => {
    const r = planCleanup([{ name: 'song.m4a', extension: 'm4a', depth: 0 }]);
    expect(r.toDelete).toHaveLength(1);
  });

  test('identifies nested files for flattening', () => {
    const r = planCleanup([{ name: 'song.wav', extension: 'wav', depth: 1 }]);
    expect(r.toFlatten).toHaveLength(1);
  });

  test('does not flatten root-level', () => {
    const r = planCleanup([{ name: 'song.wav', extension: 'wav', depth: 0 }]);
    expect(r.toFlatten).toHaveLength(0);
  });

  test('identifies jpg/png as junk', () => {
    const r = planCleanup([
      { name: 'cover.jpg', extension: 'jpg', depth: 0 },
      { name: 'art.png', extension: 'png', depth: 0 },
    ]);
    expect(r.toDelete).toHaveLength(2);
  });

  test('skips .incomplete directory', () => {
    const r = planCleanup([{ name: '.incomplete', isDirectory: true, depth: 0 }]);
    expect(r.toConvert).toHaveLength(0);
    expect(r.toDelete).toHaveLength(0);
  });

  test('handles empty array', () => {
    const r = planCleanup([]);
    expect(r.toConvert).toHaveLength(0);
    expect(r.toFlatten).toHaveLength(0);
    expect(r.toDelete).toHaveLength(0);
  });
});
