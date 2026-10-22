import type { ParsedBomLine } from "./bom-parser.ts";
import type { SupplierPart } from "./supplier-types.ts";
import {
  parseResistanceOhms,
  parseCapacitanceFarads,
  parseFrequencyHz,
  extractCapacitorTypeHints,
} from "./value-normalizer.ts";
import { firstAlternateValue } from "./query-builder.ts";
import { checkPackage, type PackageCheck } from "./package.ts";

export interface RankedCandidate {
  part: SupplierPart;
  // How well the part's VALUE matches (resistance, capacitance, part number).
  confidence: "exact" | "possible" | "unknown";
  // Whether the part's PACKAGE matches the line's requirement (see
  // package.ts, ported from eurorack-bom) — through-hole unless the BOM
  // line says otherwise.
  pkg: PackageCheck;
}

// Value ranking below runs first, without package information.
type ValueRanked = Omit<RankedCandidate, "pkg">;

// Same extraction/tie-break helpers Smart BOM and Eurorack BOM's rankers
// use — duplicated rather than shared across three small projects (revisit
// if a fourth BOM-matching project makes a shared package worth it).
function extractResistanceOhms(description: string): number | null {
  const withUnitWord = description.match(/(\d+\.?\d*)\s*(k|K|M|R)?\s*(?:OHM|Ω)/i);
  if (withUnitWord) {
    const [, num, unitChar] = withUnitWord;
    return parseResistanceOhms(`${num}${unitChar ?? ""}`);
  }
  const bareValue = description.match(/\b(\d+\.?\d*)\s*(k|K|M|R)\b(?!\w)/);
  if (bareValue) {
    const [, num, unitChar] = bareValue;
    return parseResistanceOhms(`${num}${unitChar}`);
  }
  return null;
}

function extractCapacitanceFarads(description: string): number | null {
  const match = description.match(/(\d*\.?\d+)\s*(p|n|u|µ|m)F/i);
  if (!match) return null;
  const [, num, unitChar] = match;
  return parseCapacitanceFarads(`${num}${unitChar}F`);
}

// Crystals need an exact frequency, not a tolerance band, but the
// nearlyEqual 1% tolerance below is still fine in practice — two different
// real crystals a builder would actually confuse at that tolerance don't
// occur in retro-computer designs (frequencies are chosen for exact baud-
// rate/clock-divider math, not interchangeable nearby values).
function extractFrequencyHz(description: string): number | null {
  const match = description.match(/(\d+\.?\d*)\s*(k|M)?Hz/i);
  if (!match) return null;
  const [, num, unitChar] = match;
  return parseFrequencyHz(`${num}${unitChar ?? ""}Hz`);
}

function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) / Math.max(a, b) < 0.01;
}

function parsePrice(price: string): number {
  const cleaned = price.replace(/[^\d.]/g, "");
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) return Infinity;
  // A real (non-mock) supplier listing priced at exactly 0 is a data-quality
  // signal (inactive/no-price-available/call-for-quote), not an actual free
  // part — same real bug class found in Eurorack BOM. Treat it the same way
  // (sort last, not first).
  if (value === 0) return Infinity;
  return value;
}

// Same placeholder-never-wins fix Smart BOM and Eurorack BOM both needed —
// a supplier client with no live credentials returns a "MOCK-..." part
// priced at $0.00, which would otherwise always win a price tiebreak.
function isPlaceholder(candidate: ValueRanked): boolean {
  return candidate.part.supplierPartNumber.startsWith("MOCK");
}

function byConfidenceThenPrice(a: ValueRanked, b: ValueRanked): number {
  const aPlaceholder = isPlaceholder(a);
  const bPlaceholder = isPlaceholder(b);
  if (aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;

  const rank = { exact: 0, possible: 1, unknown: 2 };
  const rankDiff = rank[a.confidence] - rank[b.confidence];
  if (rankDiff !== 0) return rankDiff;
  return parsePrice(a.part.price) - parsePrice(b.part.price);
}

function scoreByExtractedValue(
  candidates: SupplierPart[],
  target: number | null,
  extract: (description: string) => number | null,
): ValueRanked[] {
  const scored = candidates.map((part) => {
    const extracted = extract(part.description);
    let confidence: ValueRanked["confidence"] = "unknown";
    if (target !== null && extracted !== null) {
      confidence = nearlyEqual(target, extracted) ? "exact" : "possible";
    } else if (extracted !== null) {
      confidence = "possible";
    }
    return { part, confidence };
  });
  return scored.sort(byConfidenceThenPrice);
}

function scoreBySubstring(candidates: SupplierPart[], needle: string): ValueRanked[] {
  const cleanNeedle = needle.toLowerCase().replace(/\s+/g, "");
  const scored: ValueRanked[] = candidates.map((part) => {
    const haystack = (part.manufacturerPartNumber + " " + part.description)
      .toLowerCase()
      .replace(/\s+/g, "");
    if (haystack.includes(cleanNeedle)) return { part, confidence: "exact" as const };
    // "Z80 CPU" is a part name plus a word, so the whole needle never
    // appears. Fall back to its part-number token ("Z80"), but only where it
    // reads as that part: a whole word in the description ("IC 6MHZ Z80
    // NMOS CPU"), or the manufacturer part number after a letters-only
    // vendor prefix ("SN74HCT04" for "74HCT04"). Found live: a bare "Z80"
    // also sits inside power-inductor part numbers ("IHTL4020LZEZ80NL").
    const token = partNumberToken(needle);
    if (token && token !== needle.trim()) {
      const inDescription = new RegExp(`(?<![A-Z0-9])${token}(?![A-Z0-9])`, "i").test(part.description);
      if (inDescription || mpnHasPart(part.manufacturerPartNumber, token)) {
        return { part, confidence: "possible" as const };
      }
    }
    return { part, confidence: "unknown" as const };
  });
  return scored.sort(byConfidenceThenPrice);
}

// Value first, then package, then price — same order as eurorack-bom.
const PACKAGE_ORDER: Record<PackageCheck["status"], number> = { match: 0, unspecified: 0, unknown: 1, mismatch: 2 };
const CONFIDENCE_ORDER: Record<RankedCandidate["confidence"], number> = { exact: 0, possible: 1, unknown: 2 };

export function rankCandidates(line: ParsedBomLine, candidates: SupplierPart[]): RankedCandidate[] {
  return rankByValue(line, candidates)
    .map((c) => ({ ...c, pkg: checkPackage(line.packageRequirement, c.part) }))
    .sort((a, b) => {
      const aPlaceholder = isPlaceholder(a);
      const bPlaceholder = isPlaceholder(b);
      if (aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;
      const byValue = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
      if (byValue !== 0) return byValue;
      const byPackage = PACKAGE_ORDER[a.pkg.status] - PACKAGE_ORDER[b.pkg.status];
      if (byPackage !== 0) return byPackage;
      return parsePrice(a.part.price) - parsePrice(b.part.price);
    });
}

function rankByValue(line: ParsedBomLine, candidates: SupplierPart[]): ValueRanked[] {
  if (line.kind === "resistor") {
    const target = parseResistanceOhms(line.value);
    return scoreByExtractedValue(candidates, target, extractResistanceOhms);
  }

  if (line.kind === "capacitor") {
    const target = parseCapacitanceFarads(line.value);
    const ranked = scoreByExtractedValue(candidates, target, extractCapacitanceFarads);

    // Real RC2014-ecosystem Component cells state the type directly
    // ("Capacitor, ceramic, 100 nF") the same way Eurorack BOMs do — demote
    // a same-value-wrong-type "exact" match to "possible", same fix.
    const typeHints = extractCapacitorTypeHints(line.description);
    if (typeHints.length === 0) return ranked;

    return ranked
      .map((candidate) => {
        if (candidate.confidence !== "exact") return candidate;
        const partHints = extractCapacitorTypeHints(candidate.part.description);
        const matchesType = partHints.length === 0 || typeHints.some((hint) => partHints.includes(hint));
        return matchesType ? candidate : { ...candidate, confidence: "possible" as const };
      })
      .sort(byConfidenceThenPrice);
  }

  if (line.kind === "potentiometer") {
    const target = parseResistanceOhms(line.value);
    return scoreByExtractedValue(candidates, target, extractResistanceOhms);
  }

  if (line.kind === "crystal") {
    const target = parseFrequencyHz(line.value);
    return scoreByExtractedValue(candidates, target, extractFrequencyHz);
  }

  if (line.kind === "ic" || line.kind === "diode" || line.kind === "transistor") {
    return scoreBySubstring(candidates, firstAlternateValue(line.value));
  }

  if (line.kind === "socket") return rankSockets(line, candidates);

  // jack/header/switch: no numeric value and no reliable part-number
  // needle to score against — a header's "value" is a functional
  // description like "Header, male, 1 x 4 pin, straight", not a searchable
  // identifier. There's no honest way to call any result "exact" here. Sort
  // by price only and surface everything as "unknown" so the UI doesn't
  // overstate confidence in a match that wasn't actually verified.
  return candidates.map((part) => ({ part, confidence: "unknown" as const })).sort(byConfidenceThenPrice);
}

function partNumberToken(text: string): string | null {
  const token = text.split(/[\s,]+/).find((t) => /[A-Z]/i.test(t) && /\d/.test(t));
  return token ? token.replace(/[^A-Z0-9-]/gi, "") : null;
}

function mpnHasPart(mpn: string, token: string): boolean {
  const i = mpn.toUpperCase().indexOf(token.toUpperCase());
  return i >= 0 && /^[A-Z]*$/.test(mpn.slice(0, i).toUpperCase());
}

// IC sockets: the pin count is the one thing a socket line states.
// Found live: "40 pin DIP socket" ranked an 8-position socket and
// unrelated wire-to-board housings first, by price alone. A socket with
// the same pin count is "possible"; everything else stays "unknown".
function rankSockets(line: ParsedBomLine, candidates: SupplierPart[]): ValueRanked[] {
  const wanted = pinsIn(line.description);
  return candidates
    .map((part) => {
      const d = part.description.toUpperCase();
      const isSocket = /SOCKET/.test(d) && !/\bDIP\s?SWITCH/.test(d);
      const ok = isSocket && wanted !== null && pinsIn(d) === wanted;
      return { part, confidence: ok ? ("possible" as const) : ("unknown" as const) };
    })
    .sort(byConfidenceThenPrice);
}

function pinsIn(text: string): number | null {
  const match =
    text.match(/(\d{1,2})\s?-?\s?(?:PIN|POS(?:ITION)?S?|WAY)\b/i) ?? text.match(/\b(\d{1,2})\s?-?\s?P\b/i);
  return match ? parseInt(match[1], 10) : null;
}
