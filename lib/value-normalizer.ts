// Normalizes the many ways pedal builders write component values so they can
// be compared to a supplier's part description, e.g.:
//   resistors: "100k", "4k7" (European notation), "100R", "1M", "0R1"
//   capacitors: "47uF", "0.047uF", ".047uF", "47nF", "470pF", "104" (EIA 3-digit code)
//
// Returns values in base SI units (ohms, farads) so two different spellings
// of the same value normalize to the same number and can be matched exactly.

const SI_PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  "": 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
};

// Potentiometer taper-code letters seen in real PedalPCB BOMs: A (audio/log),
// B (linear), C (reverse-log), W (special/reverse-audio taper — confirmed
// real via docs.pedalpcb.com/project/Pacifier.pdf: "MENACE W100K", "PUNK
// W100K", "SPIKES W100K"). Shared across bom-parser.ts (recognizing a value
// as a pot in the first place), match-ranker.ts and query-builder.ts
// (stripping the letter before treating the rest as a plain resistance) so
// the accepted letter set can't drift out of sync between them the way two
// other transforms already have (see resolveSearchedValue in query-builder.ts).
export const POT_TAPER_LETTERS = "ABCW";

export function stripPotTaperLetter(value: string): string {
  return value.replace(new RegExp(`^[${POT_TAPER_LETTERS}](?=\\d)`, "i"), "");
}

export function parseResistanceOhms(raw: string): number | null {
  const value = stripNotes(raw);

  // European notation: a unit letter embedded where the decimal point goes,
  // e.g. "4k7" = 4.7k, "0R1" = 0.1 ohm, "1M2" = 1.2M.
  const european = value.match(/^(\d+)([RkKmM])(\d+)$/);
  if (european) {
    const [, whole, unitChar, frac] = european;
    const unit = unitChar.toUpperCase() === "R" ? "" : unitChar;
    const multiplier = SI_PREFIX[unit === "K" ? "k" : unit] ?? 1;
    return parseFloat(`${whole}.${frac}`) * multiplier;
  }

  // Standard notation: "100k", "4.7k", "1M", "220" (bare ohms).
  const standard = value.match(/^([\d.]+)\s*([pnuµmkKMG]?)(?:ohm|Ω|R)?$/i);
  if (standard) {
    const [, num, unitChar] = standard;
    const unit = unitChar === "K" ? "k" : unitChar;
    const multiplier = SI_PREFIX[unit] ?? 1;
    return parseFloat(num) * multiplier;
  }

  return null;
}

// Strips a trailing parenthetical note, e.g. "470n (0.47uF Electro or Tant)" -> "470n".
// Notes are always appended at the end, so truncate from the first "(" rather
// than matching a single balanced "(...)" group — a note can itself contain
// parens (e.g. "2N5457 (JFET transistor ... Alternate MMBF5457 (SMD))") and a
// non-nesting-aware regex would leave a stray trailing ")" behind.
export function stripNotes(raw: string): string {
  return raw.replace(/\(.*$/, "").trim();
}

export function parseCapacitanceFarads(raw: string): number | null {
  const value = stripNotes(raw);

  // European notation: unit letter embedded where the decimal point goes,
  // e.g. "2n7" = 2.7nF, "6u8" = 6.8uF.
  const european = value.match(/^(\d+)([pnuµm])(\d+)$/i);
  if (european) {
    const [, whole, unitChar, frac] = european;
    const multiplier = SI_PREFIX[unitChar.toLowerCase()] ?? 1;
    return parseFloat(`${whole}.${frac}`) * multiplier;
  }

  // EIA 3-digit code (common on ceramic caps in pF): first two digits are
  // significant figures, third is the power-of-ten multiplier, e.g.
  // "104" = 10 * 10^4 pF = 100,000 pF = 100nF = 0.1uF.
  const eiaCode = value.match(/^(\d{2})(\d)$/);
  if (eiaCode) {
    const [, sig, exp] = eiaCode;
    const picofarads = parseFloat(sig) * Math.pow(10, parseFloat(exp));
    return picofarads * 1e-12;
  }

  // Standard notation with explicit unit: "47uF", "0.047uF", ".1uF", "470pF", "47nF".
  const standard = value.match(/^(\d*\.?\d+)\s*([pnuµm]?)F?$/i);
  if (standard) {
    const [, num, unitChar] = standard;
    // Bare numbers (no unit letter) default to uF per pedal-BOM convention —
    // but SI_PREFIX[""] is already 1 (for parseResistanceOhms's bare-ohms
    // case above), so the intended "?? 1e-6" fallback never actually fired
    // for capacitors; a code-review pass caught that this silently parsed a
    // bare value as literal Farads instead. Handle the empty-unit case
    // explicitly rather than relying on the shared lookup's default.
    //
    // unitChar is lowercased before the SI_PREFIX lookup — found live via
    // rc2014-bom capacitor-matching tests: real supplier descriptions
    // routinely write units in caps ("100NF", "0.1UF"), and SI_PREFIX's
    // keys are lowercase, so an uppercase unit silently missed the lookup
    // and fell through to the 1e-6 (micro) default — parsing "100NF" as
    // 100 microfarads instead of 100 nanofarads, a 1000x error. Unlike
    // resistors (where "M" vs "m" genuinely mean mega vs milli),
    // capacitor-unit letters have no case-distinct alternate meaning, so
    // lowercasing here is always safe. This exact code is shared verbatim
    // with smart-bom and eurorack-bom's value-normalizer.ts — same latent
    // bug likely affects live capacitor matching there too.
    const multiplier = unitChar === "" ? 1e-6 : (SI_PREFIX[unitChar.toLowerCase()] ?? 1e-6);
    return parseFloat(num) * multiplier;
  }

  return null;
}

// Formats a normalized ohm value back into the conventional "100k" style,
// for building supplier search keywords.
export function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${trimZero(ohms / 1e6)}M`;
  if (ohms >= 1e3) return `${trimZero(ohms / 1e3)}k`;
  return `${trimZero(ohms)}`;
}

export function formatFarads(farads: number): string {
  if (farads >= 1e-6) return `${trimZero(farads / 1e-6)}uF`;
  if (farads >= 1e-9) return `${trimZero(farads / 1e-9)}nF`;
  return `${trimZero(farads / 1e-12)}pF`;
}

function trimZero(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

const CAPACITOR_TYPE_PATTERNS: [RegExp, string][] = [
  // "\balum\b" catches a real supplier-description abbreviation ("CAP ALUM
  // 100UF 20% 16V RADIAL") found live via Eurorack BOM testing — without
  // it, an aluminum electrolytic with no literal "electro"/"tant" substring
  // produces no type hint at all, which this function's caller has to treat
  // as "uncertain, don't demote" and so silently lets a same-value ceramic
  // part through as a false "exact" match.
  [/electro|\balum\b/i, "electrolytic"],
  [/tant/i, "tantalum"],
  [/ceramic|\bcer\b/i, "ceramic"],
  [/poly(?:ester|propylene)?/i, "film"],
  [/\bfilm\b/i, "film"],
];

// Crystal/oscillator frequency, e.g. "7.3728MHz", "7.3728 Mhz", "32.768kHz".
// Unlike resistors/caps, retro-computing BOMs (RC2014 and similar) name an
// exact frequency a builder needs — there's no tolerance-band matching here,
// just base-unit normalization so "7.3728MHz" and "7372800Hz" compare equal.
export function parseFrequencyHz(raw: string): number | null {
  const value = stripNotes(raw);
  const match = value.match(/^([\d.]+)\s*(k|M)?Hz$/i);
  if (!match) return null;
  const [, num, unitChar] = match;
  const multiplier = unitChar === undefined ? 1 : unitChar.toLowerCase() === "k" ? 1e3 : 1e6;
  return parseFloat(num) * multiplier;
}

export function formatHz(hz: number): string {
  if (hz >= 1e6) return `${trimZero(hz / 1e6)}MHz`;
  if (hz >= 1e3) return `${trimZero(hz / 1e3)}kHz`;
  return `${trimZero(hz)}Hz`;
}

// Pulls a physical capacitor-type hint out of a BOM note, e.g.
// "470n (0.47uF Electro or Tant)" -> ["electrolytic", "tantalum"]. A BOM
// value's TYPE matters as much as its farad value — an electrolytic and a
// ceramic cap of the same capacitance aren't interchangeable in a circuit —
// but plain value-matching has no way to know that on its own.
export function extractCapacitorTypeHints(raw: string): string[] {
  const hints = new Set<string>();
  for (const [pattern, type] of CAPACITOR_TYPE_PATTERNS) {
    if (pattern.test(raw)) hints.add(type);
  }
  return [...hints];
}
