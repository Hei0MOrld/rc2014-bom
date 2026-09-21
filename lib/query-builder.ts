import type { ParsedBomLine } from "./bom-parser.ts";
import {
  parseResistanceOhms,
  parseCapacitanceFarads,
  parseFrequencyHz,
  formatOhms,
  formatFarads,
  formatHz,
  extractCapacitorTypeHints,
} from "./value-normalizer.ts";

// Some real RC2014-ecosystem BOMs list acceptable alternates in one cell
// (mirrors the same real pattern seen in Eurorack BOMs, e.g. "TL074 or
// UPC824") — take the first option to search with. Exported so
// match-ranker.ts scores against the same part it actually searched for.
export function firstAlternateValue(value: string): string {
  return value.split(/\s+or\s+/i)[0].trim();
}

export function buildSearchKeyword(line: ParsedBomLine): string {
  const value = line.value.trim();

  switch (line.kind) {
    case "resistor": {
      const ohms = parseResistanceOhms(value);
      const display = ohms !== null ? formatOhms(ohms) : value;
      // Same relevance fix Smart BOM/Eurorack BOM both needed: a bare
      // "<value> ohm resistor" query surfaces expensive high-wattage
      // chassis resistors sharing the same value. Retro-computer builds use
      // ordinary 1/4W through-hole resistors just like pedal/Eurorack builds.
      return `${display} ohm resistor 1/4w axial`;
    }
    case "capacitor": {
      const farads = parseCapacitanceFarads(value);
      const display = farads !== null ? formatFarads(farads) : value;
      // RC2014-ecosystem Component cells name the type directly ("Capacitor,
      // ceramic, 100 nF") the same way Eurorack BOMs do in their Description
      // column — reuse the shared extractor rather than re-deriving it.
      const typeHints = extractCapacitorTypeHints(line.description);
      return typeHints.length > 0 ? `${display} ${typeHints[0]} capacitor` : `${display} capacitor`;
    }
    case "potentiometer":
      return `${value} potentiometer`;
    case "crystal": {
      const hz = parseFrequencyHz(value);
      const display = hz !== null ? formatHz(hz) : value;
      // Crystals need an exact frequency match, not a tolerance band — the
      // search keyword still just needs to surface candidates for
      // match-ranker.ts to compare against.
      return `${display} crystal oscillator`;
    }
    case "diode":
      // Real RC2014 Mini BOM line: "3mm green led" — no part number at all,
      // unlike signal diodes which are always named by part number (1N4148).
      return /\bled\b/i.test(value) ? `${value} LED` : firstAlternateValue(value);
    case "ic":
    case "transistor":
      return firstAlternateValue(value); // part numbers (74HCT688, Z80, 68B50) search well as-is
    case "jack":
    case "header":
    case "switch":
    case "socket":
      // These Component cells already fully describe the part ("Header,
      // male, 1 x 4 pin, straight", "20-pin PDIP socket") — pass through
      // rather than trying to compress into a shorter query.
      return line.description;
    default:
      return `${line.description} ${value}`.trim();
  }
}
