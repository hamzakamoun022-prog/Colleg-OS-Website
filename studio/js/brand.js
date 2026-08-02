// Brand system for College OS, mirrored from the live landing page so every
// frame the studio renders is on-brand without anyone re-typing hex codes.

export const BRAND = {
  name: 'College OS',
  domain: 'getcollegeos.com',
  price: '$19',
  checkout: 'https://whop.com/checkout/plan_lk3dEacmMHMPv',
  tagline: 'Your all-in-one college system',

  palette: {
    cream: '#F7F3ED',
    beige: '#EDE5D8',
    warmTan: '#C9B99A',
    brown: '#8B6F47',
    darkBrown: '#5C4A32',
    text: '#2C1F0E',
    textLight: '#7A6550',
    white: '#FDFAF6',
    ink: '#1B1206',
    // Accents borrowed from the Notion template's own tag colours.
    green: '#3E7D5A',
    red: '#C1553F',
    amber: '#D89B3C',
    blue: '#4A6FA5',
    violet: '#7A5EA8',
  },

  fonts: {
    display: "'Cormorant Garamond', Georgia, serif",
    body: "'DM Sans', -apple-system, Segoe UI, sans-serif",
  },

  // Deliverables promised on the sales page — used by the director for
  // feature-led scenes and by the price card.
  deliverables: [
    'Assignment Tracker with 3 views',
    'Auto Exam Countdown formula',
    'Finance Tracker with donut chart',
    'Weekly Schedule calendar',
    'Study Notes hub by subject',
    'Wellbeing Check-in page',
    'Resource Library',
    '13 AI study prompts',
    'Live flip clock widget',
    'Daily habit tracker',
  ],

  proof: [
    { quote: 'My grades improved because I stopped missing deadlines.', who: 'Sarah K.', role: '2nd year Psychology' },
    { quote: 'Seeing 14 days left makes me actually sit down and study.', who: 'Marcus T.', role: 'Engineering' },
    { quote: 'I stopped overspending in my second month using this.', who: 'Priya M.', role: 'International student' },
  ],

  guarantees: ['One-time payment', 'Works on free Notion', 'Instant delivery'],
};

export const P = BRAND.palette;

/** Aspect ratio presets, keyed the way ad platforms describe them. */
export const FORMATS = {
  '9:16': { w: 1080, h: 1920, label: 'Reels / TikTok / Shorts', ratio: 9 / 16 },
  '4:5':  { w: 1080, h: 1350, label: 'Instagram feed', ratio: 4 / 5 },
  '1:1':  { w: 1080, h: 1080, label: 'Square feed', ratio: 1 },
  '16:9': { w: 1920, h: 1080, label: 'YouTube / landscape', ratio: 16 / 9 },
};

/** Render scale multipliers applied on top of the format's base size. */
export const QUALITY = {
  preview: { scale: 0.5, label: 'Preview (fast)' },
  hd:      { scale: 1,   label: '1080p' },
  max:     { scale: 4 / 3, label: '1440p' },
};

/**
 * Colour grades. Each is applied as a pair of composited washes over the
 * finished frame — cheap, deterministic, and film-like.
 */
export const GRADES = {
  warm: {
    label: 'Warm Paper',
    lift: { color: '#F3E4CC', alpha: 0.1, op: 'soft-light' },
    tint: { color: '#8B6F47', alpha: 0.06, op: 'multiply' },
    contrast: 0.06,
  },
  clean: {
    label: 'Clean Studio',
    lift: { color: '#FFFFFF', alpha: 0.05, op: 'soft-light' },
    tint: { color: '#C9B99A', alpha: 0.03, op: 'multiply' },
    contrast: 0.03,
  },
  moody: {
    label: 'Moody Espresso',
    lift: { color: '#2C1F0E', alpha: 0.14, op: 'multiply' },
    tint: { color: '#8B6F47', alpha: 0.12, op: 'soft-light' },
    contrast: 0.12,
  },
  punch: {
    label: 'Punch',
    lift: { color: '#FFE9C4', alpha: 0.12, op: 'overlay' },
    tint: { color: '#5C4A32', alpha: 0.05, op: 'multiply' },
    contrast: 0.16,
  },
};

/** CSS font shorthand builder used everywhere in the renderer. */
export const font = (weight, size, family = 'body', italic = false) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px ${family === 'display' ? BRAND.fonts.display : BRAND.fonts.body}`;
