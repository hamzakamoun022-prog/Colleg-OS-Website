// Asset loading: real product screenshots plus the brand webfonts.
//
// Canvas text measurement silently falls back to a system font if the webfont
// hasn't loaded yet, which would shift every layout. So nothing renders until
// both fonts and images are ready.

const SHOTS = {
  homepage: 'assets/homepage.jpg',
  assignments: 'assets/assignments.jpg',
  exams: 'assets/exams.jpg',
  finance: 'assets/finance.jpg',
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Explicitly load every weight the renderer draws with. */
async function loadFonts() {
  if (!document.fonts) return;
  const faces = [
    '300 48px "Cormorant Garamond"',
    '400 48px "Cormorant Garamond"',
    '500 48px "Cormorant Garamond"',
    '600 48px "Cormorant Garamond"',
    '300 32px "DM Sans"',
    '400 32px "DM Sans"',
    '500 32px "DM Sans"',
    '700 32px "DM Sans"',
  ];
  await Promise.all(faces.map(f => document.fonts.load(f, 'Aa 0123 —').catch(() => {})));
  await document.fonts.ready;
}

export async function loadAssets(onProgress = () => {}) {
  const entries = Object.entries(SHOTS);
  const assets = {};
  let done = 0;
  const total = entries.length + 1;

  await loadFonts();
  onProgress(++done / total, 'fonts');

  await Promise.all(entries.map(async ([key, src]) => {
    try {
      assets[key] = await loadImage(src);
    } catch {
      assets[key] = null; // device mockups degrade to an empty screen
    }
    onProgress(++done / total, key);
  }));

  return assets;
}

export const SHOT_KEYS = Object.keys(SHOTS);
