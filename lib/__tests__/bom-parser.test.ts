import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBomText } from "../bom-parser.ts";

// Real bill-of-materials text fetched live from rc2014.co.uk/full-kits/rc2014-mini/
// on 2026-09-21 (flat "quantity x description" bullet list, no reference
// designators — the real primary format for official RC2014 kit pages).
const REAL_RC2014_MINI_BOM = `
1 x RC2014 Mini PCB
1 x 24 pin wide DIL socket
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
1 x 40 pin RA header
1 x 6 pin ra header
1 x 2 x 20 pin socket
1 x 40 Way SIL Socket
1 x 6 way SIL socket
5 x jumper
1 x 2.1mm power jack
1 x USB Barrel Lead
`;

// Reconstructed as a clean tab-separated paste of the real "Parts List"
// table at smallcomputercentral.com/sc139-serial-68b50-module-rc2014/
// (fetched live 2026-09-21). The site's own naive HTML-to-text flattening
// collapses this table to single-space-joined text with no reliable column
// delimiter (a real limitation documented in bom-parser.ts) — this
// reconstruction represents what a browser's normal table-copy clipboard
// behavior produces instead (tab-separated cells). Two real oddities from
// the live page are preserved verbatim rather than "corrected": the
// combined "JP1 plus JP2, and JP3 plus JP4" reference for a single Component
// cell (originally wrapped across two lines by the site's own layout), and
// "R1 to R4" being listed with Qty 2 even though 4 resistors are named
// (also present in the site's own assembly-guide prose) — the site's data,
// not a parsing bug.
const REAL_SC139_BOM = [
  "Reference\tQty\tComponent",
  "PCB\t1\tSC139, v1.0, PCB",
  "C1 to C3\t3\tCapacitor, ceramic, 100 nF",
  "C4 and C5\t2\tCapacitor, ceramic, 22 pF",
  "JP1 plus JP2, and JP3 plus JP4\t2\tHeader, male, 1 x 4 pin, straight",
  "JP5\t1\tHeader, male, 1 x 2 pin, straight",
  "JPA (Address)\t1\tHeader, male, 2 x 8 pin, angled, or Header, male, 2 x 8 pin, straight",
  "Jumper shunts\t12\tJumper shunt",
  "P1\t1\tHeader, male, 1 x 40 pin, angled",
  "P2\t1\tHeader, female, 1 x 6 pin, angled",
  "P3\t1\tHeader, male, 1 x 6 pin, angled",
  "R1 to R4\t2\tResistor, 2k2, 0.25W",
  "R5\t1\tResistor, 1k, 0.25W",
  "R6\t1\tResistor, 1M, 0.25W",
  "R7 and R8\t2\tResistor, 100k, 0.25W",
  "RP1\t1\tResistor pack, 8 x 10k, SIL, 9-pin",
  "X1\t1\tCrystal, 7.3728MHz",
  "U1\t1\t74HCT688",
  "U2\t1\t68B50",
  "U3\t1\t74HCT04",
].join("\n");

test("RC2014 Mini: excludes the bare PCB line, keeps everything else (34 real lines)", () => {
  const parsed = parseBomText(REAL_RC2014_MINI_BOM);
  assert.equal(parsed.length, 34);
  assert.ok(!parsed.some((line) => /RC2014 Mini PCB/.test(line.description)));
});

test("RC2014 Mini: classifies every real kind correctly, including a live spelling variant", () => {
  const parsed = parseBomText(REAL_RC2014_MINI_BOM);
  const kindsByDescription = Object.fromEntries(parsed.map((l) => [l.description, l.kind]));

  assert.equal(kindsByDescription["24 pin wide DIL socket"], "socket");
  assert.equal(kindsByDescription["Z80 CPU"], "ic");
  assert.equal(kindsByDescription["7.3728 Mhz Xtal"], "crystal");
  assert.equal(kindsByDescription["22pf ceramic cap"], "capacitor");
  assert.equal(kindsByDescription["1k resistor"], "resistor");
  // Real live typo on the source page: "1M resitor" (missing an "s").
  assert.equal(kindsByDescription["1M resitor"], "resistor");
  assert.equal(kindsByDescription["3mm green led"], "diode");
  assert.equal(kindsByDescription["RA Tactile Switch"], "switch");
  assert.equal(kindsByDescription["2 pin header"], "header");
  assert.equal(kindsByDescription["jumper"], "header");
  assert.equal(kindsByDescription["2.1mm power jack"], "jack");
  // Misc accessory with no fixed shape — bucketed with jack rather than
  // falling through to the "ic" default.
  assert.equal(kindsByDescription["USB Barrel Lead"], "jack");
});

test("RC2014 Mini: extracts a two-token frequency value ('7.3728 Mhz' -> '7.3728Mhz')", () => {
  const parsed = parseBomText(REAL_RC2014_MINI_BOM);
  const crystal = parsed.find((l) => l.kind === "crystal");
  assert.equal(crystal?.value, "7.3728Mhz");
});

test("SC139 table: parses reference-designator rows, excludes PCB, keeps real quantity quirks", () => {
  const parsed = parseBomText(REAL_SC139_BOM);
  // 19 data rows minus the excluded PCB line = 18.
  assert.equal(parsed.length, 18);

  const r5 = parsed.find((l) => l.reference === "R5");
  assert.equal(r5?.kind, "resistor");
  assert.equal(r5?.value, "1k");

  // Site's own data quirk (also present in its assembly-guide prose),
  // preserved rather than "fixed" — see fixture comment above.
  const r1to4 = parsed.find((l) => l.reference === "R1 to R4");
  assert.equal(r1to4?.quantity, 2);
});

test("SC139 table: a bare chip part number with no keyword at all still classifies as ic", () => {
  const parsed = parseBomText(REAL_SC139_BOM);
  const u1 = parsed.find((l) => l.reference === "U1");
  assert.equal(u1?.kind, "ic");
  assert.equal(u1?.value, "74HCT688");
});

test("SC139 table: crystal reference (X1) extracts the frequency directly", () => {
  const parsed = parseBomText(REAL_SC139_BOM);
  const crystal = parsed.find((l) => l.reference === "X1");
  assert.equal(crystal?.kind, "crystal");
  assert.equal(crystal?.value, "7.3728MHz");
});

test("SC139 table: a resistor-pack's '8 x 10k' count isn't mistaken for an 8-ohm value", () => {
  const parsed = parseBomText(REAL_SC139_BOM);
  const rp1 = parsed.find((l) => l.reference === "RP1");
  assert.equal(rp1?.kind, "resistor");
  assert.equal(rp1?.value, "10k");
});

test("SC139 table: jumper shunts and headers both bucket as 'header'", () => {
  const parsed = parseBomText(REAL_SC139_BOM);
  const jumper = parsed.find((l) => l.reference === "Jumper shunts");
  assert.equal(jumper?.kind, "header");
  const jpa = parsed.find((l) => l.reference?.startsWith("JPA"));
  assert.equal(jpa?.kind, "header");
});
