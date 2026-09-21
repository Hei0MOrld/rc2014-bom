// Parses RC2014/retro-homebrew-computer BOM text.
//
// Two real-world formats confirmed (2026-09-21, live-fetched, not assumed):
//
// 1) Reference-designator table, seen across many Small Computer Central
//    module pages (e.g. smallcomputercentral.com/sc139-serial-68b50-module-rc2014/):
//    "Reference | Qty | Component" rows like "R5 | 1 | Resistor, 1k, 0.25W"
//    or "X1 | 1 | Crystal, 7.3728MHz" — the kind+value live together in one
//    free-text Component cell, comma-separated from any trailing spec notes
//    (e.g. "0.25W", "0402").
//
// 2) Flat "quantity x description" bullet list with NO reference designators
//    at all, seen on the official kit page (rc2014.co.uk/full-kits/rc2014-mini/):
//    "6 x 100nf cap", "1 x 7.3728 Mhz Xtal".
//
// Unlike PedalPCB BOMs, real reference designators here follow standard EE
// convention (R/C/U/Q/D/X/J/P/SW/RP), so a real reference column is a
// stronger classification signal than keyword-guessing the description —
// use it first when present, but a few keywords (socket, crystal, jumper)
// override it since real-world reference columns aren't always clean (a
// live-fetched example had "IC socket 20-pin U1" in the Reference cell of
// what should be a socket line, not an IC line).

import {
  parseResistanceOhms,
  parseCapacitanceFarads,
  parseFrequencyHz,
} from "./value-normalizer.ts";

export type ComponentKind =
  | "resistor"
  | "capacitor"
  | "potentiometer"
  | "ic"
  | "diode"
  | "transistor"
  | "crystal"
  | "jack"
  | "header"
  | "switch"
  | "socket";

export interface ParsedBomLine {
  raw: string;
  reference?: string;
  description: string;
  kind: ComponentKind;
  value: string;
  quantity: number;
  note: string;
}

const DESIGNATOR_KIND: Record<string, ComponentKind> = {
  R: "resistor",
  RN: "resistor",
  RP: "resistor",
  C: "capacitor",
  U: "ic",
  IC: "ic",
  D: "diode",
  LED: "diode",
  Q: "transistor",
  VR: "potentiometer",
  POT: "potentiometer",
  TRIM: "potentiometer",
  X: "crystal",
  Y: "crystal",
  XTAL: "crystal",
  J: "jack",
  P: "header",
  JP: "header",
  CN: "header",
  SW: "switch",
  S: "switch",
  SK: "socket",
  SKT: "socket",
};

function kindFromReference(reference: string): ComponentKind | null {
  const letters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
  return DESIGNATOR_KIND[letters] ?? null;
}

// Checked first, against the full raw line — these are unambiguous enough
// to override even a reference-designator-based guess (see file header note
// about a real "IC socket ... U1" reference-column anomaly).
const OVERRIDE_RULES: [RegExp, ComponentKind][] = [
  [/socket/i, "socket"],
  [/crystal|\bxtal\b|oscillator/i, "crystal"],
  [/jumper/i, "header"],
  // Misc cables/leads/adapters (real example: rc2014.co.uk's official Mini
  // kit BOM lists "1 x USB Barrel Lead") aren't ICs and aren't a fixed
  // shape any keyword below covers — bucket with jack/header/switch/socket's
  // always-"unknown"-confidence, price-sorted treatment rather than letting
  // them fall through to the ic default and get a nonsense substring search.
  [/\bcable\b|\blead\b|\badapter\b/i, "jack"],
];

// General keyword fallback, checked against the description when there's no
// reference designator to go on (the flat bullet-list format) or the
// designator lookup came up empty.
const KEYWORD_RULES: [RegExp, ComponentKind][] = [
  [/potentiometer|\btrimmer\b/i, "potentiometer"],
  [/capacitor|\bcap\b/i, "capacitor"],
  // Real rc2014.co.uk kit BOM has a live typo: "1 x 1M resitor" (missing an
  // "s") alongside correctly-spelled "resistor" elsewhere on the same page —
  // match both rather than silently misclassifying that one line as "ic".
  [/\bresistor\b|\bresitor\b/i, "resistor"],
  [/\bled\b/i, "diode"],
  [/\bdiode\b/i, "diode"],
  [/transistor/i, "transistor"],
  [/header|\bpin\b/i, "header"],
  [/\bjack\b/i, "jack"],
  [/switch/i, "switch"],
];

// The PCB itself is a real BOM line in both formats confirmed for this
// genre (e.g. "PCB | 1 | SC139, v1.0, PCB" and "1 x RC2014 Mini PCB") but
// isn't something Mouser/DigiKey stock — exclude it rather than generating
// a nonsense supplier search for it.
function isBareBoardLine(description: string): boolean {
  return /\bPCB\b/i.test(description);
}

function classifyKind(reference: string | undefined, description: string): ComponentKind {
  for (const [pattern, kind] of OVERRIDE_RULES) {
    if (pattern.test(description) || (reference && pattern.test(reference))) return kind;
  }
  if (reference) {
    const fromRef = kindFromReference(reference);
    if (fromRef) return fromRef;
  }
  for (const [pattern, kind] of KEYWORD_RULES) {
    if (pattern.test(description)) return kind;
  }
  // Bare chip part numbers ("74HCT688", "68B50", "Z80") carry no keyword at
  // all in real data — this is the common case for IC lines, not an edge
  // case, so "ic" is the right silent fallback rather than "other".
  return "ic";
}

const VALUE_PARSER_BY_KIND: Partial<Record<ComponentKind, (s: string) => number | null>> = {
  resistor: parseResistanceOhms,
  capacitor: parseCapacitanceFarads,
  crystal: parseFrequencyHz,
};

// Scans whitespace/comma-separated tokens (and adjacent-token pairs, so a
// value split across two tokens like "100 nF" or "7.3728 Mhz" is still
// found) for the first one that parses as this kind's value. Real Component
// cells mix the value in with the kind name and spec notes on one line
// ("Resistor, 2k2, 0.25W"), so the value has to be found, not assumed to be
// in a fixed position.
function findValueToken(text: string, parse: (s: string) => number | null): string | null {
  const tokens = text.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    // A bare count immediately followed by "x" (real example: "Resistor
    // pack, 8 x 10k, SIL, 9-pin") is a multiplier, not the value — skip both
    // tokens so "8" doesn't get mistaken for an 8-ohm resistor.
    if (/^x$/i.test(tokens[i + 1] ?? "")) {
      i++;
      continue;
    }
    if (parse(tokens[i]) !== null) return tokens[i];
    if (i + 1 < tokens.length) {
      const merged = tokens[i] + tokens[i + 1];
      if (parse(merged) !== null) return merged;
    }
  }
  return null;
}

function extractValue(kind: ComponentKind, description: string): string {
  const parser = VALUE_PARSER_BY_KIND[kind];
  if (parser) {
    const found = findValueToken(description, parser);
    if (found) return found;
  }
  // ic/diode/transistor/jack/header/switch/socket: no numeric value to
  // extract — the whole description (often just a bare part number) is what
  // match-ranker.ts substring-matches or treats as always-unknown.
  return description;
}

// Known real constraint: this expects columns still separated by a tab,
// pipe, or 2+ spaces, which is how most browsers' clipboard actually
// preserves an HTML <table> on copy-paste — but a naive text-extraction of
// the same page (confirmed live against smallcomputercentral.com's Parts
// List table) can flatten a row to single-space-joined text with no
// reliable delimiter at all, which this can't parse. Not solved here — the
// flat "quantity x description" bullet format below is the safer bet when
// a paste doesn't keep columns separated.
function splitColumns(line: string): string[] | null {
  let cols: string[];
  if (line.includes("|")) {
    cols = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
  } else if (line.includes("\t")) {
    cols = line.split("\t").map((c) => c.trim()).filter(Boolean);
  } else {
    cols = line.split(/ {2,}/).map((c) => c.trim()).filter(Boolean);
  }
  return cols.length >= 3 ? cols : null;
}

interface LineShape {
  reference: string | undefined;
  quantity: number;
  description: string;
}

function parseTableRow(raw: string): LineShape | null {
  const cols = splitColumns(raw);
  if (!cols) return null;
  const [reference, qtyRaw, ...descParts] = cols;
  const quantity = parseInt(qtyRaw, 10);
  // Rejects header rows ("Reference | Qty | Component") since "Qty" isn't numeric.
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const description = descParts.join(", ");
  if (!description) return null;
  return { reference, quantity, description };
}

function parseBulletLine(raw: string): LineShape | null {
  const match = raw.match(/^(\d+)\s*[xX]\s+(.+)$/);
  if (!match) return null;
  return { reference: undefined, quantity: parseInt(match[1], 10), description: match[2].trim() };
}

function isSeparatorRow(line: string): boolean {
  return /^[-=|\s]+$/.test(line);
}

export function parseBomText(text: string): ParsedBomLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isSeparatorRow(line));

  const parsed: ParsedBomLine[] = [];

  for (const raw of lines) {
    const tableRow = parseTableRow(raw);
    const shape = tableRow ?? parseBulletLine(raw);
    if (!shape) continue;

    if (isBareBoardLine(shape.description)) continue;

    const kind = classifyKind(shape.reference, shape.description);
    const value = extractValue(kind, shape.description);

    parsed.push({
      raw,
      reference: shape.reference,
      description: shape.description,
      kind,
      value,
      quantity: shape.quantity,
      note: "",
    });
  }

  return parsed;
}
