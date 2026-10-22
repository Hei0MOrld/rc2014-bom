// Wrong matches found by running the deployed app against live Mouser and
// DigiKey results (2026-10). The supplier descriptions below are copied
// from those real responses, so each test pins the exact case that failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates } from "../match-ranker.ts";
import { buildSearchKeyword } from "../query-builder.ts";
import { parseBomText } from "../bom-parser.ts";
import type { SupplierPart } from "../supplier-types.ts";

function part(manufacturerPartNumber: string, description: string, price: string, extra: Partial<SupplierPart> = {}): SupplierPart {
  return {
    supplier: "digikey",
    supplierPartNumber: manufacturerPartNumber,
    manufacturer: "Test Mfg",
    manufacturerPartNumber,
    description,
    price,
    availability: "In Stock",
    productUrl: "#",
    ...extra,
  };
}

function only(bom: string) {
  const lines = parseBomText(bom);
  assert.equal(lines.length, 1);
  return lines[0];
}

test("an RC2014 line with no package stated asks for through-hole", () => {
  assert.deepEqual(only("6 x 100nf cap").packageRequirement, [{ mounting: "through-hole" }]);
  assert.deepEqual(only("1 x 74HCT04").packageRequirement, [{ mounting: "through-hole" }]);
  // a package the line does name wins
  assert.deepEqual(only("1 x 74HCT04 SOIC-14").packageRequirement, [{ family: "SOIC", pins: 14 }]);
  // sockets are searched as through-hole parts already; no requirement added
  assert.deepEqual(only("1 x 40 pin DIP socket").packageRequirement, [{ family: "DIP" }]);
});

test("100nF: an 0402 chip capacitor no longer beats a leaded one", () => {
  const ranked = rankCandidates(only("6 x 100nf cap"), [
    part("CL05B104KP5VPNC", "CAP CER 100NF 10V X7R 0402", "¥16", { mountingText: "Surface Mount, MLCC" }),
    part("CL10E104KC8VPNC", "CAP CER 100NF 100V X8L 0603", "¥52"),
    part("A104K15X7RF5TAA", "Multilayer Ceramic Capacitors MLCC - Leaded .1UF 50V 10%", "¥53.2", { supplier: "mouser" }),
  ]);
  assert.equal(ranked[0].part.manufacturerPartNumber, "A104K15X7RF5TAA");
  assert.equal(ranked[0].pkg.status, "match");
  assert.deepEqual(ranked.slice(1).map((r) => r.pkg.status), ["mismatch", "mismatch"]);
  assert.equal(buildSearchKeyword(only("6 x 100nf cap")), "100nF capacitor through hole");
});

test("74HCT04: the 14-PDIP comes first, not the cheaper TSSOP/SSOP/SOIC", () => {
  const ranked = rankCandidates(only("1 x 74HCT04"), [
    part("SN74HCT04APWLE", "IC INV 6-CIR 1-IN 14-TSSOP", "¥18.7", { packageText: "14-TSSOP", mountingText: "Surface Mount" }),
    part("SN74HCT04DBR", "IC INV 6-CIR 1-IN 14-SSOP", "¥34.3", { packageText: "14-SSOP", mountingText: "Surface Mount" }),
    part("CD74HCT04M96", "IC INV 6-CIR 1-IN 14-SOIC", "¥39"),
    part("SN74HCT04N", "IC INV 6-CIR 1-IN 14-PDIP", "¥167", { packageText: "14-DIP (0.300 in, 7.62mm); 14-PDIP", mountingText: "Through Hole" }),
  ]);
  assert.equal(ranked[0].part.manufacturerPartNumber, "SN74HCT04N");
  assert.ok(ranked.slice(1).every((r) => r.pkg.status === "mismatch"));
});

test("7.3728MHz: an SMD crystal no longer beats a through-hole one", () => {
  const ranked = rankCandidates(only("1 x 7.3728 Mhz Xtal"), [
    part("ABLS-7.3728MHZ-B4-T", "CRYSTAL 7.3728MHZ 18PF SMD", "¥41"),
    part("ATS073-E", "CRYSTAL 7.3728MHZ 20PF TH", "¥43", { mountingText: "Through Hole" }),
  ]);
  assert.equal(ranked[0].part.manufacturerPartNumber, "ATS073-E");
  assert.equal(ranked[1].pkg.status, "mismatch");
});

test("Z80 CPU: the Z80 is found by its part name, and power inductors with Z80 inside their part number are not", () => {
  const ranked = rankCandidates(only("1 x Z80 CPU"), [
    part("IHTL4020LZEZ80NL", "Power Inductors - SMD 80nH 75A Coupled TLVR ferrite", "¥367.1", { supplier: "mouser" }),
    part("Z0840006VSC", "IC 6MHZ Z80 NMOS CPU 44-PLCC", "¥274.3"),
    part("Z84C0010PEG", "IC MPU Z80 10MHZ 40DIP", "¥900", { packageText: "40-DIP (0.600 in, 15.24mm); 40-PDIP", mountingText: "Through Hole" }),
  ]);
  assert.deepEqual(
    ranked.map((r) => [r.part.manufacturerPartNumber, r.confidence]),
    [["Z84C0010PEG", "possible"], ["Z0840006VSC", "possible"], ["IHTL4020LZEZ80NL", "unknown"]],
  );
});

test("40 pin socket: an 8-position socket and wire-to-board housings no longer win on price", () => {
  const ranked = rankCandidates(only("1 x 40 pin DIP socket"), [
    part("5031750801", "1.5 W/B SGL DIPR/ARECASSY8CKTW/B", "¥33.2", { supplier: "mouser" }),
    part("245-08-1-03", "CONN IC DIP SOCKET 8POS TIN", "¥83"),
    part("245-40-1-06", "CONN IC DIP SOCKET 40POS TIN", "¥465"),
  ]);
  assert.equal(ranked[0].part.manufacturerPartNumber, "245-40-1-06");
  assert.deepEqual(ranked.map((r) => r.confidence), ["possible", "unknown", "unknown"]);
});
