"use client";

import { useMemo, useState } from "react";
import type { ParsedBomLine } from "@/lib/bom-parser";
import type { RankedCandidate } from "@/lib/match-ranker";
import { buildPasteListsBySupplier, type CartSelection } from "@/lib/cart-builder";

interface MatchResult {
  line: ParsedBomLine;
  keyword: string;
  candidates: RankedCandidate[];
  error?: string;
}

const SUPPLIER_LABEL: Record<CartSelection["supplier"], string> = {
  mouser: "Mouser",
  digikey: "DigiKey",
};

const SUPPLIER_BOM_TOOL_URL: Record<CartSelection["supplier"], string> = {
  mouser: "https://www.mouser.com/en/Bom/",
  digikey: "https://www.digikey.com/en/mylists",
};

// Real fixture, fetched live from rc2014.co.uk/full-kits/rc2014-mini/ — the
// official kit page's own "Bill of materials" list, PCB line removed (not a
// sourceable Mouser/DigiKey part). Flat "quantity x description" format,
// no reference designators, confirmed as the primary real shape for this
// genre before any parser code was written.
const SAMPLE_BOM = `1 x 24 pin wide DIL socket
2 x 28 pin wide DIL socket
1 x 40 pin wide DIL socket
3 x 14 pin narrow DIL socket
1 x Z80 CPU
1 x 27C512 EPROM BASIC
1 x 62256 RAM
1 x MC68B50
1 x 74HCT04
2 x 74LS32
1 x 7.3728 Mhz Xtal
2 x 22pf ceramic cap
6 x 100nf cap
4 x 1k resistor
1 x 1M resitor
1 x 10k resistor
1 x 22k resistor
1 x 2k2 resistor
1 x 330r resistor
1 x 3k3 resistor
1 x 3mm green led
1 x RA Tactile Switch
1 x 2 pin header
4 x 3 pin header
2 x 20 pin header
1 x 40 pin header
5 x jumper
1 x 2.1mm power jack`;

const SKIP = "__skip__";

export default function Home() {
  const [bomText, setBomText] = useState(SAMPLE_BOM);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<CartSelection["supplier"] | null>(null);

  async function handleMatch() {
    setLoading(true);
    setCopied(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bomText }),
      });
      const data = await res.json();
      setResults(data.results);
      setSelections({});
    } finally {
      setLoading(false);
    }
  }

  const pasteListsBySupplier = useMemo(() => {
    if (!results) return {};
    const chosen = results.map((r, i) => {
      const sel = selections[i] ?? "0";
      if (sel === SKIP) return null;
      const candidate = r.candidates[parseInt(sel, 10)];
      if (!candidate) return null;
      const selection: CartSelection = {
        supplier: candidate.part.supplier,
        supplierPartNumber: candidate.part.supplierPartNumber,
        quantity: r.line.quantity,
      };
      return selection;
    });
    return buildPasteListsBySupplier(chosen.filter((c) => c !== null));
  }, [results, selections]);

  const totalCost = useMemo(() => {
    if (!results) return null;
    let total = 0;
    let anyPriced = false;
    results.forEach((r, i) => {
      const sel = selections[i] ?? "0";
      if (sel === SKIP) return;
      const candidate = r.candidates[parseInt(sel, 10)];
      if (!candidate) return;
      const price = parseFloat(candidate.part.price.replace(/[^\d.]/g, ""));
      if (Number.isFinite(price)) {
        total += price * r.line.quantity;
        anyPriced = true;
      }
    });
    return anyPriced ? total : null;
  }, [results, selections]);

  async function handleCopy(supplier: CartSelection["supplier"]) {
    await navigator.clipboard.writeText(pasteListsBySupplier[supplier] ?? "");
    setCopied(supplier);
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            RC2014 BOM
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste an RC2014 (or compatible retro Z80 homebrew) module&apos;s
            parts list, get matched supplier parts compared across Mouser and
            DigiKey, cheapest wins automatically. Works with the flat{" "}
            <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
              quantity x description
            </code>{" "}
            list official kit pages use, or a{" "}
            <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
              Reference / Qty / Component
            </code>{" "}
            table pasted with tabs or pipes between columns.
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
            Honest limitations: switches, jacks, headers, and IC sockets
            don&apos;t have a searchable part number the way resistors/caps/
            crystals/ICs do, so those matches are always marked{" "}
            <span className="font-mono">[unknown]</span> confidence — check
            them by hand before ordering. If a table paste doesn&apos;t keep
            its columns separated by tabs or pipes, some rows may not parse.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <textarea
            className="h-56 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-sm text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            value={bomText}
            onChange={(e) => setBomText(e.target.value)}
          />
          <button
            onClick={handleMatch}
            disabled={loading}
            className="w-fit rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {loading ? "Matching..." : "Match parts"}
          </button>
        </div>

        {results && (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
                  <th className="py-2 pr-4">Part</th>
                  <th className="py-2 pr-4">Qty</th>
                  <th className="py-2 pr-4">Match</th>
                  <th className="py-2 pr-4">Price</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-200 dark:border-zinc-800">
                    <td className="py-2 pr-4 font-mono">
                      {r.line.reference ? `${r.line.reference}: ` : ""}
                      {r.line.description}
                    </td>
                    <td className="py-2 pr-4">{r.line.quantity}</td>
                    <td className="py-2 pr-4">
                      {r.candidates.length === 0 ? (
                        r.error ? `Error: ${r.error}` : "No match"
                      ) : (
                        <div className="flex flex-col gap-1">
                          <select
                            className="w-full max-w-md rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                            value={selections[i] ?? "0"}
                            onChange={(e) =>
                              setSelections((s) => ({ ...s, [i]: e.target.value }))
                            }
                          >
                            {r.candidates.slice(0, 5).map((c, ci) => (
                              <option key={ci} value={ci}>
                                [{c.confidence}] [{SUPPLIER_LABEL[c.part.supplier]}]{" "}
                                {c.part.price} — {c.part.description}
                              </option>
                            ))}
                            <option value={SKIP}>— skip this line —</option>
                          </select>
                          {r.error && (
                            <span className="text-xs text-amber-600 dark:text-amber-500">
                              ⚠ {r.error} (showing results from the other supplier only)
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {(() => {
                        const chosen = r.candidates[parseInt(selections[i] ?? "0", 10)];
                        if (!chosen) return null;
                        return `${chosen.part.price} (${SUPPLIER_LABEL[chosen.part.supplier]})`;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalCost !== null && (
              <p className="text-sm font-medium text-black dark:text-zinc-50">
                Cheapest-combination total: ¥{totalCost.toFixed(2)}
              </p>
            )}

            {(Object.keys(pasteListsBySupplier) as CartSelection["supplier"][]).map((supplier) => (
              <div
                key={supplier}
                className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
              >
                <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
                  {SUPPLIER_LABEL[supplier]} cart list
                </h2>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Paste this into {SUPPLIER_LABEL[supplier]}&apos;s own{" "}
                  <a
                    href={SUPPLIER_BOM_TOOL_URL[supplier]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    BOM tool
                  </a>{" "}
                  while signed in — repeated part numbers are grouped into
                  quantities automatically.
                </p>
                <textarea
                  readOnly
                  className="h-32 w-full rounded-lg border border-zinc-300 bg-zinc-100 p-3 font-mono text-xs text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  value={pasteListsBySupplier[supplier]}
                />
                <button
                  onClick={() => handleCopy(supplier)}
                  className="w-fit rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  {copied === supplier ? "Copied!" : "Copy list"}
                </button>
              </div>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
