// Shared shape both mouser-client.ts and digikey-client.ts normalize into,
// so query-builder/match-ranker/cart-builder can stay supplier-agnostic
// instead of hardcoding Mouser's field names everywhere.
export interface SupplierPart {
  supplier: "mouser" | "digikey";
  supplierPartNumber: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  description: string;
  price: string; // display string, e.g. "¥16.60" or "$0.14" — parsed on demand, never stored as a number (currency varies by supplier/locale)
  availability: string;
  productUrl: string;
}
