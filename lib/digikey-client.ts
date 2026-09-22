// Thin client for DigiKey's Product Information API v4 (Keyword Search).
//
// Requires DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET (server-side only —
// never exposed to the client). Register an app at
// https://developer.digikey.com/ (an "app-only" OAuth2 client-credentials
// app is enough — no per-user login flow needed, this is app-level auth).
//
// Request/response shape below is now verified against a live app
// (org "SmartBOM-Hei0MOrld", app "Smart BOM", registered 2026-09-21) — OAuth
// token fetch and keyword search both confirmed working with real data.

import type { SupplierPart } from "./supplier-types.ts";

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Module-level cache: a serverless instance stays warm across several
// requests, so this avoids re-authenticating on every single BOM line within
// the same warm instance. Cold starts (new instance) just re-fetch — that's
// fine, client-credentials token fetches are cheap and not rate-limited the
// way product searches are.
let cachedToken: CachedToken | null = null;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch("https://api.digikey.com/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`DigiKey OAuth error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

export interface DigiKeyProductVariation {
  DigiKeyProductNumber: string;
  MinimumOrderQuantity?: number;
  QuantityAvailableforPackageType?: number;
  StandardPricing?: Array<{ BreakQuantity: number; UnitPrice: number }>;
}

interface DigiKeySearchResponse {
  Products?: Array<{
    ManufacturerProductNumber: string;
    Manufacturer?: { Name: string };
    Description?: { ProductDescription: string };
    UnitPrice?: number;
    QuantityAvailable?: number;
    ProductUrl?: string;
    ProductVariations?: DigiKeyProductVariation[];
  }>;
}

// Covers every currency X-DIGIKEY-Locale-Currency's docs list as acceptable.
// CNY uses "CN¥" rather than a bare "¥" specifically to stay visually
// distinct from JPY in a UI that may show both across different searches.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  CAD: "CA$",
  JPY: "¥",
  GBP: "£",
  EUR: "€",
  HKD: "HK$",
  SGD: "S$",
  TWD: "NT$",
  KRW: "₩",
  AUD: "A$",
  NZD: "NZ$",
  INR: "₹",
  DKK: "kr",
  NOK: "kr",
  SEK: "kr",
  ILS: "₪",
  CNY: "CN¥",
  PLN: "zł",
  CHF: "CHF",
  CZK: "Kč",
  HUF: "Ft",
  RON: "lei",
  ZAR: "R",
  MYR: "RM",
  THB: "฿",
  PHP: "₱",
};

// A DigiKey product typically has several purchasable "variations" (package
// types) at wildly different minimum order quantities — verified live: a
// 100k resistor search returned a "Tape & Reel" variation (MOQ 5,000, unit
// price ¥1.49 at that volume) AND a "Cut Tape" variation (MOQ 1, unit price
// ¥17). Blindly taking ProductVariations[0] picked the 5,000-piece reel,
// which is useless for a hobbyist buying one resistor for one pedal — always
// prefer the variation with the lowest minimum order quantity instead.
export function pickHobbyistVariation(
  variations: DigiKeyProductVariation[] | undefined,
): DigiKeyProductVariation | undefined {
  if (!variations || variations.length === 0) return undefined;
  return [...variations].sort(
    (a, b) => (a.MinimumOrderQuantity ?? Infinity) - (b.MinimumOrderQuantity ?? Infinity),
  )[0];
}

// Verified live against the real API (not just the docs) for every entry
// below: X-DIGIKEY-Locale-Site alone does NOT make DigiKey apply that site's
// natural currency — omitting X-DIGIKEY-Locale-Currency was found to
// silently return USD regardless of the requested site (e.g. Site: "JP"
// came back with Currency: "USD"), the opposite of what the docs' wording
// ("Default value: primary currency for the entered Locale-site") implies.
// Both headers have to be sent explicitly and paired correctly per site.
// Mexico (MX) is the one exception found: MXN isn't in DigiKey's own
// accepted-currency list, so MX pairs with USD instead — also verified live
// (sending Site: "MX" with no currency header returns Currency: "USD").
export const DIGIKEY_SITES = [
  { code: "JP", currency: "JPY", label: "Japan (JPY)" },
  { code: "US", currency: "USD", label: "United States (USD)" },
  { code: "UK", currency: "GBP", label: "United Kingdom (GBP)" },
  { code: "DE", currency: "EUR", label: "Germany (EUR)" },
  { code: "CA", currency: "CAD", label: "Canada (CAD)" },
  { code: "AU", currency: "AUD", label: "Australia (AUD)" },
  { code: "FR", currency: "EUR", label: "France (EUR)" },
  { code: "KR", currency: "KRW", label: "South Korea (KRW)" },
  { code: "CN", currency: "CNY", label: "China (CNY)" },
  { code: "TW", currency: "TWD", label: "Taiwan (TWD)" },
  { code: "SG", currency: "SGD", label: "Singapore (SGD)" },
  { code: "HK", currency: "HKD", label: "Hong Kong (HKD)" },
  { code: "IN", currency: "INR", label: "India (INR)" },
  { code: "IL", currency: "ILS", label: "Israel (ILS)" },
  { code: "MX", currency: "USD", label: "Mexico (USD)" },
] as const;

export type DigiKeySite = (typeof DIGIKEY_SITES)[number]["code"];

function currencyForSite(site: DigiKeySite): string {
  return DIGIKEY_SITES.find((s) => s.code === site)?.currency ?? "USD";
}

export async function searchDigiKeyByKeyword(
  keyword: string,
  records = 25,
  site: DigiKeySite = "JP",
): Promise<SupplierPart[]> {
  const clientId = process.env.DIGIKEY_CLIENT_ID;
  const clientSecret = process.env.DIGIKEY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // No credentials configured yet — mock result, same pattern
    // mouser-client.ts used before the Mouser key arrived, so the
    // multi-vendor comparison pipeline is testable end-to-end already.
    return [
      {
        supplier: "digikey",
        supplierPartNumber: "MOCK-DK-0000",
        manufacturer: "Mock Mfg",
        manufacturerPartNumber: "MOCK",
        description: `[MOCK — set DIGIKEY_CLIENT_ID/SECRET] ${keyword}`,
        price: "$0.00",
        availability: "Mocked",
        productUrl: "#",
      },
    ];
  }

  const token = await getAccessToken(clientId, clientSecret);

  const res = await fetch("https://api.digikey.com/products/v4/search/keyword", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-DIGIKEY-Client-Id": clientId,
      "X-DIGIKEY-Locale-Site": site,
      // Sent explicitly and paired via currencyForSite() — see the
      // DIGIKEY_SITES comment above for why this can't be left to a
      // same-currency-as-site default that turned out not to exist.
      "X-DIGIKEY-Locale-Currency": currencyForSite(site),
    },
    body: JSON.stringify({ Keywords: keyword, Limit: records, Offset: 0 }),
  });

  if (!res.ok) {
    throw new Error(`DigiKey API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as DigiKeySearchResponse;
  // Real bug fixed here: the price string used to hardcode a "¥" symbol
  // regardless of which site/currency was actually requested.
  const currencySymbol = CURRENCY_SYMBOL[currencyForSite(site)] ?? "";

  return (data.Products ?? []).map((p) => {
    const variation = pickHobbyistVariation(p.ProductVariations);
    // Price at the lowest break quantity (i.e. buying just 1) of the chosen
    // variation — the top-level UnitPrice field isn't documented as tied to
    // any specific variation, so it shouldn't be trusted over a variation's
    // own StandardPricing now that we're deliberately picking a non-default
    // variation (lowest MOQ, not whatever DigiKey returns first).
    const unitPrice = variation?.StandardPricing?.[0]?.UnitPrice ?? p.UnitPrice;

    return {
      supplier: "digikey" as const,
      supplierPartNumber: variation?.DigiKeyProductNumber ?? p.ManufacturerProductNumber,
      manufacturer: p.Manufacturer?.Name ?? "",
      manufacturerPartNumber: p.ManufacturerProductNumber,
      description: p.Description?.ProductDescription ?? "",
      price: unitPrice !== undefined ? `${currencySymbol}${unitPrice}` : "N/A",
      availability:
        variation?.QuantityAvailableforPackageType !== undefined
          ? `${variation.QuantityAvailableforPackageType} in stock`
          : p.QuantityAvailable !== undefined
            ? `${p.QuantityAvailable} in stock`
            : "Unknown",
      productUrl: p.ProductUrl ?? "#",
    };
  });
}
