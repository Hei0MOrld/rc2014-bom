import type { ParsedBomLine } from "./bom-parser.ts";
import type { SupplierPart } from "./supplier-types.ts";
import {
  parseResistanceOhms,
  parseCapacitanceFarads,
  parseFrequencyHz,
  extractCapacitorTypeHints,
} from "./value-normalizer.ts";
import { firstAlternateValue } from "./query-builder.ts";

export interface RankedCandidate {
  part: SupplierPart;
  confidence: "exact" | "possible" | "unknown";
}

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
  const match = description.match(/(\d+\.?\d*)\s*(p|n|u|µ|m)F/i);
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
function isPlaceholder(candidate: RankedCandidate): boolean {
  return candidate.part.supplierPartNumber.startsWith("MOCK");
}

function byConfidenceThenPrice(a: RankedCandidate, b: RankedCandidate): number {
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
): RankedCandidate[] {
  const scored = candidates.map((part) => {
    const extracted = extract(part.description);
    let confidence: RankedCandidate["confidence"] = "unknown";
    if (target !== null && extracted !== null) {
      confidence = nearlyEqual(target, extracted) ? "exact" : "possible";
    } else if (extracted !== null) {
      confidence = "possible";
    }
    return { part, confidence };
  });
  return scored.sort(byConfidenceThenPrice);
}

function scoreBySubstring(candidates: SupplierPart[], needle: string): RankedCandidate[] {
  const cleanNeedle = needle.toLowerCase().replace(/\s+/g, "");
  const scored: RankedCandidate[] = candidates.map((part) => {
    const haystack = (part.manufacturerPartNumber + " " + part.description)
      .toLowerCase()
      .replace(/\s+/g, "");
    return { part, confidence: haystack.includes(cleanNeedle) ? "exact" : "unknown" };
  });
  return scored.sort(byConfidenceThenPrice);
}

export function rankCandidates(line: ParsedBomLine, candidates: SupplierPart[]): RankedCandidate[] {
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

  // jack/header/switch/socket: no numeric value and no reliable part-number
  // needle to score against — a header's "value" is a functional
  // description like "Header, male, 1 x 4 pin, straight", not a searchable
  // identifier. There's no honest way to call any result "exact" here. Sort
  // by price only and surface everything as "unknown" so the UI doesn't
  // overstate confidence in a match that wasn't actually verified.
  return candidates.map((part) => ({ part, confidence: "unknown" as const })).sort(byConfidenceThenPrice);
}
