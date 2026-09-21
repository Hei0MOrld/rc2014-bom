import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates } from "../match-ranker.ts";
import type { SupplierPart } from "../supplier-types.ts";
import type { ParsedBomLine } from "../bom-parser.ts";

function part(overrides: Partial<SupplierPart>): SupplierPart {
  return {
    supplier: "mouser",
    supplierPartNumber: "TEST",
    manufacturer: "Test Mfg",
    manufacturerPartNumber: "TEST-PN",
    description: "",
    price: "$0.10",
    availability: "In Stock",
    productUrl: "#",
    ...overrides,
  };
}

function line(overrides: Partial<ParsedBomLine>): ParsedBomLine {
  return {
    raw: "",
    description: "",
    kind: "header",
    value: "",
    quantity: 1,
    note: "",
    ...overrides,
  };
}

test("crystal: exact frequency match wins over a same-shape wrong frequency", () => {
  const right = part({ description: "CRYSTAL 7.3728MHZ HC49", price: "$0.50" });
  const wrong = part({ description: "CRYSTAL 8.0000MHZ HC49", price: "$0.30" });
  const ranked = rankCandidates(line({ kind: "crystal", value: "7.3728MHz" }), [wrong, right]);
  assert.equal(ranked[0].part.description, right.description);
  assert.equal(ranked[0].confidence, "exact");
  const wrongResult = ranked.find((r) => r.part.description === wrong.description);
  assert.equal(wrongResult?.confidence, "possible");
});

test("jack/header/switch/socket candidates are always 'unknown' confidence", () => {
  const candidates = [
    part({ description: "20-PIN PDIP SOCKET", price: "$0.40" }),
    part({ description: "Some other socket", price: "$0.20" }),
  ];
  const ranked = rankCandidates(line({ kind: "socket" }), candidates);
  assert.ok(ranked.every((r) => r.confidence === "unknown"));
});

test("a real (non-mock) $0 price never wins a tiebreak — treated as unpriced, sorted last", () => {
  const zeroPrice = part({ supplierPartNumber: "REAL-BUT-ZERO", price: "$0.00" });
  const realPrice = part({ supplierPartNumber: "REAL-PRICED", price: "$0.45" });
  const ranked = rankCandidates(line({ kind: "socket" }), [zeroPrice, realPrice]);
  assert.equal(ranked[0].part.supplierPartNumber, "REAL-PRICED");
});

test("a mocked placeholder never outranks a real result", () => {
  const real = part({ price: "$1.20" });
  const placeholder = part({ supplier: "digikey", supplierPartNumber: "MOCK-DK-0000", price: "$0.00" });
  const ranked = rankCandidates(line({ kind: "header" }), [placeholder, real]);
  assert.equal(ranked[0].part.supplierPartNumber, "TEST");
});

test("capacitor: description-stated 'ceramic' type demotes a matching-value electrolytic part to 'possible'", () => {
  const ceramic = part({ description: "CAP CER 100NF 50V X7R 0603", price: "$0.05" });
  const electrolytic = part({ description: "CAP ALUM 100NF 20% 16V RADIAL", price: "$0.08" });
  const ranked = rankCandidates(
    line({ kind: "capacitor", description: "Capacitor, ceramic, 100 nF", value: "100nF" }),
    [electrolytic, ceramic],
  );
  assert.equal(ranked[0].part.description, ceramic.description);
  assert.equal(ranked[0].confidence, "exact");
  const electrolyticResult = ranked.find((r) => r.part.description === electrolytic.description);
  assert.equal(electrolyticResult?.confidence, "possible");
});

test("resistor: '2k2' European notation matches a supplier listing described in plain ohms", () => {
  const candidate = part({ description: "RES 2.2K OHM 1/4W 5% AXIAL", price: "$0.02" });
  const ranked = rankCandidates(line({ kind: "resistor", value: "2k2" }), [candidate]);
  assert.equal(ranked[0].confidence, "exact");
});

test("ic: bare part number substring-matches regardless of surrounding supplier description text", () => {
  const candidate = part({ manufacturerPartNumber: "74HCT688", description: "IC COMPARATOR 8-BIT DIP-20" });
  const ranked = rankCandidates(line({ kind: "ic", value: "74HCT688" }), [candidate]);
  assert.equal(ranked[0].confidence, "exact");
});
