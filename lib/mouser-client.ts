// Thin client for Mouser's Search API (Keyword Search).
//
// Requires MOUSER_API_KEY (server-side only — never exposed to the client).
// Register at https://www.mouser.com/api-hub/ — approval takes ~1-2 business days.
//
// NOTE: request/response shape below is written from Mouser's published v1
// keyword-search contract as of this writing. VERIFY against the live docs
// (https://api.mouser.com) once the API key arrives — Mouser has changed
// field casing between API versions before, and this hasn't been hit against
// a real key yet.

import type { SupplierPart } from "./supplier-types.ts";

interface MouserSearchResponse {
  SearchResults?: {
    Parts?: Array<{
      MouserPartNumber: string;
      Manufacturer: string;
      ManufacturerPartNumber: string;
      Description: string;
      PriceBreaks?: Array<{ Price: string }>;
      Availability: string;
      ProductDetailUrl: string;
    }>;
  };
  Errors?: Array<{ Message: string }>;
}

export async function searchMouserByKeyword(
  keyword: string,
  records = 25,
): Promise<SupplierPart[]> {
  const apiKey = process.env.MOUSER_API_KEY;

  if (!apiKey) {
    // No key configured yet — return a mock result so the pipeline is
    // testable end-to-end before Mouser approval comes through.
    return [
      {
        supplier: "mouser",
        supplierPartNumber: "MOCK-0000",
        manufacturer: "Mock Mfg",
        manufacturerPartNumber: "MOCK",
        description: `[MOCK — set MOUSER_API_KEY] ${keyword}`,
        price: "$0.00",
        availability: "Mocked",
        productUrl: "#",
      },
    ];
  }

  const res = await fetch(
    `https://api.mouser.com/api/v1/search/keyword?apiKey=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        SearchByKeywordRequest: { keyword, records, startingRecord: 0 },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Mouser API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as MouserSearchResponse;

  if (data.Errors?.length) {
    throw new Error(`Mouser API error: ${data.Errors[0].Message}`);
  }

  return (data.SearchResults?.Parts ?? []).map((p) => ({
    supplier: "mouser" as const,
    supplierPartNumber: p.MouserPartNumber,
    manufacturer: p.Manufacturer,
    manufacturerPartNumber: p.ManufacturerPartNumber,
    description: p.Description,
    price: p.PriceBreaks?.[0]?.Price ?? "N/A",
    availability: p.Availability,
    productUrl: p.ProductDetailUrl,
  }));
}
