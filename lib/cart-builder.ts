import type { SupplierPart } from "./supplier-types.ts";

// Builds a paste-ready list for Mouser's own BOM Tool (mouser.com/en/Bom/,
// "Copy & Paste" import method). Confirmed real usage pattern (Aion FX's own
// pedal-building guide, aionfx.com/resources/using-mouser-bom-tool-for-easy-
// parts-sourcing/): paste a plain list of Mouser part numbers — "items
// appearing more than once will be automatically grouped into quantities
// during the import", so repeating a part number N times is how you specify
// quantity N, no separate quantity column needed.
export interface CartSelection {
  supplier: SupplierPart["supplier"];
  supplierPartNumber: string;
  quantity: number;
}

export function buildMouserPasteList(selections: CartSelection[]): string {
  const lines: string[] = [];
  for (const { supplierPartNumber, quantity } of selections) {
    if (!supplierPartNumber || quantity < 1) continue;
    for (let i = 0; i < quantity; i++) lines.push(supplierPartNumber);
  }
  return lines.join("\n");
}

// DigiKey's MyLists bulk-add accepts a similar plain paste (one part number
// per line, no separate quantity column — same repeat-N-times convention).
// NOT yet verified against a live DigiKey account (no key yet) — confirm
// the exact import UI/format once DIGIKEY_CLIENT_ID/SECRET are set and there's
// a real account to test the "paste list" flow against.
export function buildDigiKeyPasteList(selections: CartSelection[]): string {
  return buildMouserPasteList(selections); // same repeat-N-times format, kept as a separate export so call sites read clearly and the two can diverge later if DigiKey's real import format turns out different
}

// Splits a flat selection list into one paste list per supplier, since a
// cross-vendor comparison naturally produces a mix of cheapest-per-line
// picks across both suppliers rather than one single list.
export function buildPasteListsBySupplier(
  selections: CartSelection[],
): Partial<Record<SupplierPart["supplier"], string>> {
  const bySupplier: Record<string, CartSelection[]> = {};
  for (const sel of selections) {
    (bySupplier[sel.supplier] ??= []).push(sel);
  }
  const result: Partial<Record<SupplierPart["supplier"], string>> = {};
  if (bySupplier.mouser) result.mouser = buildMouserPasteList(bySupplier.mouser);
  if (bySupplier.digikey) result.digikey = buildDigiKeyPasteList(bySupplier.digikey);
  return result;
}
