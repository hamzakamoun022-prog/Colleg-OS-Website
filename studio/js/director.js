// The AI director.
//
// Turns a short brief into a shot-by-shot storyboard. Two engines:
//
//   1. A built-in generative engine — a scene grammar over hook/beat/copy banks,
//      seeded so a given seed always produces the same ad and a new seed produces
//      a genuinely different one. Works offline, always available.
//   2. Claude (optional) — the user supplies their own API key and the copy is
//      written fresh, then poured into the same beat structure so the result is
//      still a valid, renderable storyboard.

import { BRAND, P } from './brand.js';
import { rng, hashSeed, pick, shuffle, clamp, uid } from './util.js';

/* ------------------------------------------------------------------ */
/* Copy banks                                                          */
/* ------------------------------------------------------------------ */

// Accents stay inside the warm brand family — a saturated blue or violet
// highlight on cream paper reads as a different product.
export const ANGLES = {
  deadlines: { label: 'Missed deadlines',  accent: P.red },
  money:     { label: 'Money stress',      accent: P.green },
  chaos:     { label: 'App overload',      accent: P.brown },
  burnout:   { label: 'Burnout / balance', accent: '#6E7F6A' },
  grades:    { label: 'Better grades',     accent: P.amber },
  aesthetic: { label: 'Aesthetic setup',   accent: P.darkBrown },
};

const HOOKS = {
  deadlines: [
    "You have *3 assignments* due and no idea when.",
    "It's 11pm. The essay is due at *9am*. Again.",
    "Missing deadlines isn't a *discipline* problem. It's a *system* problem.",
    "Every semester starts organised. Then *week 4* happens.",
    "The assignment didn't sneak up on you. You just had *nowhere to put it*.",
  ],
  money: [
    "Broke by the *17th* of every month. Every month.",
    "Where did *$400* go? You genuinely don't know.",
    "You're not bad with money. You just *never wrote it down*.",
    "Student loan in. Student loan *gone*.",
  ],
  chaos: [
    "Stop juggling *10 apps*.",
    "Notes here. Calendar there. Deadlines *nowhere*.",
    "Your entire degree is scattered across *five apps*.",
    "You don't need another app. You need *one system*.",
  ],
  burnout: [
    "You're not lazy. You're *running college with no system*.",
    "Exhausted, behind, and pretending it's fine.",
    "Nobody teaches you *how to run* college.",
    "Surviving the semester shouldn't take *everything you have*.",
  ],
  grades: [
    "My grades went up when I stopped *relying on memory*.",
    "Same brain. Same effort. *Completely different* semester.",
    "The students getting A's aren't smarter. They're *organised*.",
  ],
  aesthetic: [
    "The Notion setup that runs my *entire* degree.",
    "This is what an organised semester actually *looks like*.",
    "One workspace. Every class, every deadline, every dollar.",
  ],
};

const AGITATE = {
  deadlines: ["Nothing talks to anything.", "So things slip. Quietly."],
  money:     ["No budget. No tracking. Just vibes.", "And then the account is empty."],
  chaos:     ["Nothing syncs. Nothing reminds you.", "So you forget. Constantly."],
  burnout:   ["No system means every week starts from zero.", "That's the exhaustion."],
  grades:    ["Effort without structure just burns you out.", "You can work less and score higher."],
  aesthetic: ["Most templates look pretty and do nothing.", "This one actually runs."],
};

const REVEALS = [
  "Meet *College OS*.",
  "So I built *College OS*.",
  "This is *College OS*.",
  "*College OS* fixes it in one place.",
  "One workspace. *Everything* in it.",
];

/** Feature beats — each maps to a real page in the product. */
const FEATURES = [
  {
    key: 'assignments', scene: 'assignmentBoard', kicker: 'Assignment Tracker',
    lines: [
      "Every deadline. *One board.*",
      "Table, board, calendar — *your choice*.",
      "Drag it to done. That's the *whole* workflow.",
    ],
    sub: 'Track every assignment across every subject.',
  },
  {
    key: 'today', scene: 'todoChecklist', kicker: "Today's Tasks",
    lines: ["Open it once. Know *exactly* what today is.", "Five things. Not *fifty*."],
    sub: 'A daily list that actually ends.',
  },
  {
    key: 'exams', scene: 'examCountdown', kicker: 'Auto Exam Countdown',
    lines: [
      "*14 days* until your final. It counts down by itself.",
      "The countdown updates *every single day*. You do nothing.",
      "You'll never be *surprised* by an exam again.",
    ],
    sub: 'Type the date once. Notion does the rest.',
  },
  {
    key: 'finance', scene: 'financeDonut', kicker: 'Finance Tracker',
    lines: [
      "Finally see where the money *actually* goes.",
      "Every dollar, *categorised*, automatically charted.",
      "Know what's left *before* you spend it.",
    ],
    sub: 'Real budgets, not guesses.',
  },
  {
    key: 'expenses', scene: 'expenseTable', kicker: 'Expense Log',
    lines: ["Log it in *four seconds*.", "Income in. Expenses out. *Nothing hidden*."],
    sub: 'Every transaction in one table.',
  },
  {
    key: 'schedule', scene: 'weekSchedule', kicker: 'Weekly Schedule',
    lines: ["Your whole week, *at a glance*.", "Classes, labs, study blocks — *set once*."],
    sub: 'Build the week, then just follow it.',
  },
  {
    key: 'wellbeing', scene: 'wellbeing', kicker: 'Wellbeing Check-in',
    lines: ["Because grades *aren't* everything.", "Track how you're *actually* doing."],
    sub: 'Mood, habits, energy — in the same place.',
  },
];

const PROOF_LINES = [
  "Loved by students who were *drowning* three weeks ago.",
  "★★★★★ — and they're not paid reviews.",
];

const OFFERS = [
  "*$19.* Once. Forever.",
  "One payment. *No subscription*. Ever.",
  "Costs less than *one* takeaway.",
  "*$19* for the rest of your degree.",
];

const CTAS = [
  "Get College OS — $19",
  "Fix your semester — $19",
  "Start your best semester",
  "Grab it at getcollegeos.com",
];

const END_TAGS = [
  "Your most organised semester starts today.",
  "Your entire college life. One workspace.",
  "Stop juggling. Start running it.",
];

/* ------------------------------------------------------------------ */
/* Motion vocabularies                                                 */
/* ------------------------------------------------------------------ */

// Each beat type draws from a pool, so repeated renders feel choreographed
// rather than random.
const MOTION_POOL = {
  hook:    ['crashZoomIn', 'impactShake', 'snapZoomSteps', 'whipPan', 'vertigo'],
  agitate: ['handheld', 'whipPan', 'crashZoomOut', 'impactShake'],
  reveal:  ['pullOut', 'focusPull', 'fpvDrone', 'bulletTime'],
  feature: ['pushIn', 'orbitRight', 'orbitLeft', 'tiltDown', 'handheld', 'float', 'snapZoomSteps'],
  proof:   ['float', 'pushIn', 'handheld'],
  offer:   ['pushIn', 'crashZoomIn', 'vertigo'],
  cta:     ['pushIn', 'float', 'static'],
};

const TRANSITION_POOL = {
  hard: ['whip', 'glitch', 'zoomBlur', 'flash'],
  soft: ['dip', 'burn', 'wipe', 'cut'],
};

/* ------------------------------------------------------------------ */
/* Arcs                                                                */
/* ------------------------------------------------------------------ */

/**
 * An arc is a beat list with relative weights. Durations are distributed by
 * weight across the target runtime, then snapped to the music grid.
 */
export const ARCS = {
  problemSolution: {
    label: 'Problem → Solution',
    hint: 'The workhorse. Name the pain, agitate it, reveal the fix, close.',
    beats: ['hook', 'agitate', 'reveal', 'feature', 'feature', 'offer', 'cta'],
    weights: [1.15, 0.85, 0.9, 1, 1, 0.95, 1.1],
  },
  demoFirst: {
    label: 'Demo First',
    hint: 'Leads with the product on screen. Best for warm audiences.',
    beats: ['hook', 'feature', 'feature', 'feature', 'proof', 'offer', 'cta'],
    weights: [1, 1, 1, 1, 0.9, 0.85, 1.05],
  },
  beforeAfter: {
    label: 'Before / After',
    hint: 'Visual contrast. Chaos on one side, the system on the other.',
    beats: ['hook', 'contrast', 'reveal', 'feature', 'feature', 'offer', 'cta'],
    weights: [1, 1.2, 0.85, 1, 1, 0.85, 1.05],
  },
  listicle: {
    label: 'Three Things',
    hint: 'Numbered feature run. Very high retention on short form.',
    beats: ['hookList', 'feature', 'feature', 'feature', 'offer', 'cta'],
    weights: [1, 1, 1, 1, 0.9, 1.05],
  },
  founder: {
    label: 'Student Story',
    hint: 'First person. Reads as a recommendation rather than an ad.',
    beats: ['hook', 'agitate', 'reveal', 'feature', 'proof', 'offer', 'cta'],
    weights: [1.1, 0.9, 0.95, 1.1, 0.95, 0.85, 1.05],
  },
  statHook: {
    label: 'Stat Interrupt',
    hint: 'Opens on a hard number. Strong scroll-stopper for cold traffic.',
    beats: ['stat', 'agitate', 'reveal', 'feature', 'feature', 'offer', 'cta'],
    weights: [1, 0.85, 0.9, 1, 1, 0.9, 1.1],
  },
};

/* ------------------------------------------------------------------ */
/* Beat builders                                                       */
/* ------------------------------------------------------------------ */

function textBlock(text, o = {}) {
  return {
    text,
    pos: o.pos ?? 'center',
    size: o.size ?? 0.082,
    anim: o.anim ?? 'stagger',
    align: o.align ?? 'center',
    maxLines: o.maxLines ?? 3,
    at: o.at ?? 0.02,
    dur: o.dur ?? 0.34,
    scrim: o.scrim,
    family: o.family ?? 'display',
    weight: o.weight,
    color: o.color,
    out: o.out,
  };
}

const BUILDERS = {
  hook: (ctx, r) => {
    // Half the time the hook is pure type; the rest of the time the footage is
    // washed back so the headline still owns the frame.
    const layer = pick(['typePlate', 'typePlate', 'chaosApps', 'notifPanic'], r);
    return {
      layer,
      wash: layer === 'typePlate' ? 0.06 : 0.52,
      motion: pick(MOTION_POOL.hook, r),
      motionAmount: 1.05,
      text: [textBlock(ctx.copy.hook, {
        size: 0.095, anim: pick(['slam', 'stagger', 'mask'], r),
      })],
    };
  },

  hookList: (ctx, r) => ({
    layer: 'typePlate',
    wash: 0.06,
    motion: 'snapZoomSteps',
    text: [
      textBlock(ctx.copy.hookList || 'Three things that fixed my *entire* semester.', {
        size: 0.092, anim: 'mask',
      }),
    ],
  }),

  stat: (ctx, r) => ({
    layer: 'statBurst',
    layerOpts: { statFrom: '10', statTo: '1', statLabel: 'apps replaced by one system' },
    motion: pick(['impactShake', 'crashZoomIn', 'vertigo'], r),
    text: [textBlock(ctx.copy.stat || 'Ten apps. *One* workspace.', { pos: 0.8, size: 0.055, anim: 'stagger', at: 0.5 })],
  }),

  agitate: (ctx, r) => ({
    layer: pick(['notifPanic', 'chaosApps'], r),
    wash: 0.18,
    motion: pick(MOTION_POOL.agitate, r),
    motionAmount: 1.1,
    text: [textBlock(ctx.copy.agitate, { pos: 'bottom', size: 0.055, anim: 'stagger', scrim: 0.92, family: 'body', weight: 500 })],
  }),

  contrast: (ctx, r) => ({
    layer: 'beforeAfter',
    motion: pick(['pushIn', 'static', 'float'], r),
    motionAmount: 0.8,
    text: [],
  }),

  reveal: (ctx, r) => ({
    layer: pick(['dashboardHub', 'laptopShot'], r),
    layerOpts: { shot: 'homepage', scroll: 0.14 },
    motion: pick(MOTION_POOL.reveal, r),
    motionAmount: 0.7,
    text: [textBlock(ctx.copy.reveal, { pos: 'bottom', size: 0.07, anim: 'mask', scrim: 0.94 })],
  }),

  feature: (ctx, r) => {
    const f = ctx.nextFeature();
    return {
      layer: f.scene,
      kicker: f.kicker,
      kickerOpts: { y: 0.12 },
      motion: pick(MOTION_POOL.feature, r),
      motionAmount: 0.55,
      text: [textBlock(f.line, {
        pos: 'bottom', size: 0.058, anim: pick(['stagger', 'mask'], r),
        scrim: 0.94, family: 'body', weight: 500,
      })],
    };
  },

  proof: (ctx, r) => ({
    layer: 'testimonial',
    layerOpts: { proof: ctx.nextProof() },
    motion: pick(MOTION_POOL.proof, r),
    motionAmount: 0.7,
    text: [],
  }),

  offer: (ctx, r) => ({
    layer: 'priceCard',
    kicker: ctx.copy.offer.replace(/\*/g, ''),
    motion: pick(MOTION_POOL.offer, r),
    motionAmount: 0.5,
    text: [],
  }),

  cta: (ctx, r) => ({
    layer: 'endCard',
    layerOpts: { cta: ctx.copy.cta, tagline: ctx.copy.endTag },
    motion: pick(MOTION_POOL.cta, r),
    motionAmount: 0.55,
    text: [],
  }),
};

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} Brief
 * @property {string} angle      key of ANGLES
 * @property {string} arc        key of ARCS
 * @property {number} duration   target seconds
 * @property {string} format     '9:16' | '4:5' | '1:1' | '16:9'
 * @property {number} seed
 * @property {number} bpm
 * @property {string} grade
 * @property {string[]} [features]  preferred feature keys
 */

export function generateStoryboard(brief) {
  const seed = brief.seed ?? Math.floor(Math.random() * 1e9);
  const r = rng(hashSeed(`${seed}:${brief.angle}:${brief.arc}`));
  const angle = ANGLES[brief.angle] ? brief.angle : 'chaos';
  const arcKey = ARCS[brief.arc] ? brief.arc : 'problemSolution';
  const arc = ARCS[arcKey];

  // Copy selection
  const agitatePair = AGITATE[angle];
  const copy = brief.copy || {
    hook: pick(HOOKS[angle], r),
    agitate: pick(agitatePair, r),
    reveal: pick(REVEALS, r),
    offer: pick(OFFERS, r),
    cta: pick(CTAS, r),
    endTag: pick(END_TAGS, r),
    hookList: 'Three things that fixed my *entire* semester.',
    stat: 'Ten apps. *One* workspace.',
  };

  // Feature rotation — prefer the ones the brief asked for, then fill.
  const preferred = (brief.features || []).map(k => FEATURES.find(f => f.key === k)).filter(Boolean);
  const rest = shuffle(FEATURES.filter(f => !preferred.includes(f)), r);
  const featureQueue = [...preferred, ...rest];
  let fi = 0;
  const proofQueue = shuffle(BRAND.proof, r);
  let pi = 0;

  const ctx = {
    copy,
    brief,
    nextFeature() {
      const f = featureQueue[fi % featureQueue.length];
      fi++;
      const line = brief.copy?.features?.[fi - 1] || pick(f.lines, r);
      return { ...f, line };
    },
    nextProof() {
      const p = proofQueue[pi % proofQueue.length];
      pi++;
      return p;
    },
  };

  // Build scenes
  const beats = arc.beats;
  const weights = arc.weights;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const target = clamp(brief.duration || 22, 8, 90);

  const scenes = beats.map((beatKey, i) => {
    const build = BUILDERS[beatKey] || BUILDERS.feature;
    const s = build(ctx, r);
    const dur = (weights[i] / totalWeight) * target;
    return {
      id: `${beatKey}-${i}-${uid()}`,
      beat: beatKey,
      dur: Math.round(dur * 100) / 100,
      accent: ANGLES[angle].accent,
      transition: i === 0 ? 'cut'
        : pick(i < 3 ? TRANSITION_POOL.hard : (r() > 0.45 ? TRANSITION_POOL.hard : TRANSITION_POOL.soft), r),
      transitionDur: 0.3,
      ...s,
    };
  });

  // Snap cuts to the beat grid so edits land on the music.
  const bpm = brief.bpm || 96;
  snapToBeats(scenes, bpm, target);

  return {
    id: uid(),
    title: `${ARCS[arcKey].label} — ${ANGLES[angle].label}`,
    seed,
    angle,
    arc: arcKey,
    format: brief.format || '9:16',
    bpm,
    look: {
      grade: brief.grade || 'warm',
      grain: brief.grain ?? 0.35,
      vignette: brief.vignette ?? 0.5,
      bloom: 0.2,
      leak: brief.leak ?? 0.22,
      letterbox: brief.letterbox ?? 0,
    },
    scenes,
  };
}

/**
 * Round every cut to the nearest half-beat, then rescale so the ad still lands
 * on the requested runtime. Beat-locked cuts are what make an edit feel "cut to
 * the music" rather than arbitrary.
 */
function snapToBeats(scenes, bpm, target) {
  const half = 30 / bpm; // half a beat, in seconds
  let sum = 0;
  for (const s of scenes) {
    s.dur = Math.max(half * 2, Math.round(s.dur / half) * half);
    sum += s.dur;
  }
  const k = target / sum;
  // Rescale in whole half-beats where possible so the grid survives.
  let acc = 0;
  scenes.forEach((s, i) => {
    const scaled = Math.max(half * 2, Math.round((s.dur * k) / half) * half);
    s.dur = Math.round(scaled * 1000) / 1000;
    acc += s.dur;
  });
  return acc;
}

/** Re-roll only the copy, keeping the visual structure the user liked. */
export function rerollCopy(board) {
  const r = rng(hashSeed(`copy:${Math.random()}`));
  const angle = board.angle;
  for (const s of board.scenes) {
    if (s.beat === 'hook' && s.text[0]) s.text[0].text = pick(HOOKS[angle], r);
    if (s.beat === 'agitate' && s.text[0]) s.text[0].text = pick(AGITATE[angle], r);
    if (s.beat === 'reveal' && s.text[0]) s.text[0].text = pick(REVEALS, r);
    if (s.beat === 'offer' && s.text[0]) s.text[0].text = pick(OFFERS, r);
    if (s.beat === 'feature' && s.text[0]) {
      const f = FEATURES.find(x => x.scene === s.layer);
      if (f) s.text[0].text = pick(f.lines, r);
    }
    if (s.beat === 'cta') {
      s.layerOpts = { ...s.layerOpts, cta: pick(CTAS, r), tagline: pick(END_TAGS, r) };
    }
  }
  return board;
}

/* ------------------------------------------------------------------ */
/* Claude-powered copywriting (optional, user-supplied key)            */
/* ------------------------------------------------------------------ */

const COPY_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string', description: 'Scroll-stopping opening line, max 9 words. Wrap 1-2 key words in *asterisks* for emphasis.' },
    agitate: { type: 'string', description: 'One short line twisting the knife on the problem. Max 10 words.' },
    reveal: { type: 'string', description: 'The line that introduces College OS. Max 7 words.' },
    features: {
      type: 'array',
      description: 'One benefit line per feature scene, in order. Max 9 words each.',
      items: { type: 'string' },
    },
    offer: { type: 'string', description: 'The price/offer line. Must communicate $19 one-time. Max 8 words.' },
    cta: { type: 'string', description: 'Button text. Max 5 words.' },
    endTag: { type: 'string', description: 'Closing tagline under the wordmark. Max 9 words.' },
  },
  required: ['hook', 'agitate', 'reveal', 'features', 'offer', 'cta', 'endTag'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a direct-response copywriter who writes short-form video ads for student-facing products.

The product is College OS: a $19 one-time Notion template that gives college students one workspace for assignments, exam countdowns, finances, weekly schedule, study notes and wellbeing. It works on the free Notion plan and is delivered instantly.

House style:
- Write the way a 20-year-old talks, not the way a brand writes. No corporate voice.
- Short lines. Most land in under nine words because they appear on screen for about two seconds.
- Concrete over abstract: "3 assignments due" beats "improved productivity".
- Never invent features, statistics, or testimonials that were not given to you.
- Never promise grades, income, or outcomes you cannot support.
- Wrap one or two words per line in *asterisks* to mark the emphasis word. Use it sparingly.
- No hashtags, no emoji, no exclamation-mark stacking.`;

/**
 * Ask Claude for fresh copy, then pour it into the chosen arc.
 * The key is supplied by the user and stays in their browser.
 */
export async function generateWithClaude({ apiKey, brief, model = 'claude-opus-5', signal }) {
  if (!apiKey) throw new Error('No API key set.');

  const arc = ARCS[brief.arc] || ARCS.problemSolution;
  const featureCount = arc.beats.filter(b => b === 'feature').length;
  const angleLabel = (ANGLES[brief.angle] || ANGLES.chaos).label;

  const userPrompt = [
    `Write copy for one ${brief.duration}-second vertical video ad.`,
    `Angle: ${angleLabel}.`,
    `Structure: ${arc.label} — ${arc.hint}`,
    `Audience: ${brief.audience || 'college students, 18-23, scrolling on their phone'}.`,
    `Tone: ${brief.tone || 'direct, warm, a little dry'}.`,
    `Provide exactly ${featureCount} feature line${featureCount === 1 ? '' : 's'}, one per product screen shown.`,
    brief.notes ? `Extra direction from the marketer: ${brief.notes}` : '',
    '',
    'Product facts you may use:',
    ...BRAND.deliverables.map(d => `- ${d}`),
    `- Price: ${BRAND.price}, one-time, no subscription`,
    `- Site: ${BRAND.domain}`,
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for calls made directly from a browser.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: COPY_SCHEMA },
      },
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* body not JSON */ }
    throw new Error(`Claude API ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json();

  // A safety decline arrives as a normal 200 — check before reading content.
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined this brief. Try rewording the notes field.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Response was cut short. Try a shorter brief.');
  }

  const textBlockOut = (data.content || []).find(b => b.type === 'text');
  if (!textBlockOut) throw new Error('Claude returned no copy.');

  let copy;
  try {
    copy = JSON.parse(textBlockOut.text);
  } catch {
    throw new Error('Could not parse the copy Claude returned.');
  }

  const board = generateStoryboard({ ...brief, copy });
  board.title += ' · Claude';
  board.copySource = 'claude';
  return board;
}

export const FEATURE_LIST = FEATURES.map(f => ({ key: f.key, label: f.kicker }));
