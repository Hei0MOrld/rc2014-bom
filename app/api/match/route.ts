import { NextRequest, NextResponse } from "next/server";
import { parseBomText } from "@/lib/bom-parser";
import { buildSearchKeyword } from "@/lib/query-builder";
import { searchMouserByKeyword } from "@/lib/mouser-client";
import { searchDigiKeyByKeyword, DIGIKEY_SITES, type DigiKeySite } from "@/lib/digikey-client";
import { rankCandidates } from "@/lib/match-ranker";

const DIGIKEY_SITE_CODES = new Set(DIGIKEY_SITES.map((s) => s.code));
function isDigiKeySite(value: unknown): value is DigiKeySite {
  return typeof value === "string" && DIGIKEY_SITE_CODES.has(value as DigiKeySite);
}

// Same caps smart-bom (the sibling PedalPCB/Mouser tool this was forked
// from) uses: bound worst-case damage from one oversized paste against the
// shared 1,000-calls/day Mouser quota, not a real feature limit — no real
// Eurorack module BOM comes close to either number.
const MAX_BOM_TEXT_CHARS = 20_000;
const MAX_PARSED_LINES = 150;

export async function POST(req: NextRequest) {
  const { bomText, digikeySite } = (await req.json()) as { bomText?: string; digikeySite?: string };

  if (!bomText || typeof bomText !== "string") {
    return NextResponse.json({ error: "bomText is required" }, { status: 400 });
  }

  const site: DigiKeySite = isDigiKeySite(digikeySite) ? digikeySite : "JP";

  if (bomText.length > MAX_BOM_TEXT_CHARS) {
    return NextResponse.json(
      { error: `bomText is too large (max ${MAX_BOM_TEXT_CHARS} characters)` },
      { status: 400 },
    );
  }

  const parsedLines = parseBomText(bomText);

  if (parsedLines.length > MAX_PARSED_LINES) {
    return NextResponse.json(
      {
        error: `BOM has ${parsedLines.length} line items, which exceeds the ${MAX_PARSED_LINES}-line limit per request.`,
      },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    parsedLines.map(async (line) => {
      const keyword = buildSearchKeyword(line);

      const [mouserResult, digikeyResult] = await Promise.allSettled([
        searchMouserByKeyword(keyword),
        searchDigiKeyByKeyword(keyword, 25, site),
      ]);

      const candidates = [
        ...(mouserResult.status === "fulfilled" ? mouserResult.value : []),
        ...(digikeyResult.status === "fulfilled" ? digikeyResult.value : []),
      ];

      const errors = [
        mouserResult.status === "rejected" ? `Mouser: ${mouserResult.reason}` : null,
        digikeyResult.status === "rejected" ? `DigiKey: ${digikeyResult.reason}` : null,
      ].filter((e): e is string => e !== null);

      return {
        line,
        keyword,
        candidates: rankCandidates(line, candidates),
        ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
      };
    }),
  );

  return NextResponse.json({ results });
}
