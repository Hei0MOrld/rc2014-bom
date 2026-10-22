// Copied from eurorack-bom, where package.ts was contributed by
// @daaaaaaaaaniel (PR, 2026-10). The Eurorack-table parser test is left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findPackages,
  findMounting,
  packageRequirement,
  checkPackage,
  formatRequirement,
} from "../package.ts";
import { extractPackageParameters } from "../digikey-client.ts";

test("reads package names written in the usual BOM and supplier styles", () => {
  assert.deepEqual(findPackages("DIP-14"), [{ family: "DIP", pins: 14 }]);
  assert.deepEqual(findPackages("dip14"), [{ family: "DIP", pins: 14 }]);
  assert.deepEqual(findPackages("14-DIP (0.300\", 7.62mm)"), [{ family: "DIP", pins: 14 }]);
  assert.deepEqual(findPackages("14-PDIP"), [{ family: "DIP", pins: 14 }]);
  assert.deepEqual(findPackages("IC OPAMP JFET 4 CIRCUIT 14SOIC"), [{ family: "SOIC", pins: 14 }]);
  assert.deepEqual(findPackages("14-TSSOP (0.173\", 4.40mm Width)"), [{ family: "TSSOP", pins: 14 }]);
  assert.deepEqual(findPackages("SO-8"), [{ family: "SOIC", pins: 8 }]);
  assert.deepEqual(findPackages("IC REG LINEAR 5V 100MA TO92-3"), [{ family: "TO-92", pins: 3 }]);
  assert.deepEqual(findPackages("SOT-23-5"), [{ family: "SOT-23", pins: 5 }]);
  assert.deepEqual(findPackages("DIODE GEN PURP 100V 200MA DO35"), [{ family: "DO-35" }]);
  assert.deepEqual(findPackages("DIP–14"), [{ family: "DIP", pins: 14 }], "en dash");
});

test("doesn't read TSSOP as SSOP or SOIC, or a DIP switch as a package", () => {
  assert.deepEqual(findPackages("TSSOP-14"), [{ family: "TSSOP", pins: 14 }]);
  assert.deepEqual(findPackages("SSOP-20"), [{ family: "SSOP", pins: 20 }]);
  assert.deepEqual(findPackages("8 position DIP switch"), []);
  assert.deepEqual(findPackages("Thonkiconn PJ398SM"), []);
  assert.deepEqual(findPackages("Resistor 1/4W 1% 10K R5–R8, R10"), []);
});

test("reads both options from an either/or note", () => {
  const req = packageRequirement(["TL074H", "U1, SOIC-14 or TSSOP-14 only (was TL074)", "IC Op-amp quad"]);
  assert.deepEqual(req, [
    { family: "SOIC", pins: 14 },
    { family: "TSSOP", pins: 14 },
  ]);
  assert.equal(formatRequirement(req), "SOIC-14 or TSSOP-14");
});

test("a bare SMD or through-hole note becomes a mounting-only requirement", () => {
  assert.deepEqual(packageRequirement(["TL074 or UPC824", "SMD", "Op Amp"]), [{ mounting: "smd" }]);
  assert.deepEqual(packageRequirement(["1N4148", "through-hole", "Diode"]), [{ mounting: "through-hole" }]);
  assert.equal(findMounting("Surface Mount"), "smd");
  assert.equal(findMounting("Through Hole"), "through-hole");
});

test("no package words means the requirement is empty", () => {
  assert.deepEqual(packageRequirement(["DG413", "U2", "IC Analog switch quad"]), []);
});

const DIP14 = [{ family: "DIP" as const, pins: 14 }];

test("structured supplier data decides the match", () => {
  const soic = checkPackage(DIP14, {
    packageText: "14-SOIC (0.154\", 3.90mm Width); 14-SOIC",
    mountingText: "Surface Mount",
    description: "IC OPAMP JFET 4 CIRCUIT 14SOIC",
  });
  assert.equal(soic.status, "mismatch");
  assert.equal(soic.found, "SOIC-14");
  assert.equal(soic.source, "supplier data");

  const dip = checkPackage(DIP14, {
    packageText: "14-DIP (0.300\", 7.62mm); 14-PDIP",
    mountingText: "Through Hole",
    description: "IC OPAMP JFET 4 CIRCUIT 14DIP",
  });
  assert.equal(dip.status, "match");
});

test("falls back to the description when there's no structured data", () => {
  const check = checkPackage(DIP14, { description: "Operational Amplifiers - Op Amps Quad JFET PDIP-14" });
  assert.equal(check.status, "match");
  assert.equal(check.source, "description");
});

test("a wrong pin count is a mismatch", () => {
  const check = checkPackage(DIP14, { description: "IC OPAMP 8DIP" });
  assert.equal(check.status, "mismatch");
});

test("mounting alone can rule a part out, but can't confirm a family", () => {
  assert.equal(checkPackage(DIP14, { mountingText: "Surface Mount", description: "" }).status, "mismatch");
  assert.equal(checkPackage(DIP14, { mountingText: "Through Hole", description: "" }).status, "unknown");
});

test("nothing readable on the part means unknown, never a match", () => {
  const check = checkPackage(DIP14, { description: "Operational Amplifiers - Op Amps Quad Low-Noise" });
  assert.equal(check.status, "unknown");
  assert.equal(check.found, undefined);
});

test("an empty requirement is 'unspecified' but still reports what the part is", () => {
  const check = checkPackage([], { description: "IC OPAMP JFET 4 CIRCUIT 14SOIC" });
  assert.equal(check.status, "unspecified");
  assert.equal(check.found, "SOIC-14");
});

test("extracts DigiKey's package and mounting-type parameters", () => {
  const out = extractPackageParameters([
    { ParameterText: "Capacitance", ValueText: "100nF" },
    { ParameterText: "Package / Case", ValueText: "14-DIP (0.300\", 7.62mm)" },
    { ParameterText: "Supplier Device Package", ValueText: "14-PDIP" },
    { ParameterText: "Mounting Type", ValueText: "Through Hole" },
  ]);
  assert.deepEqual(out, {
    packageText: "14-DIP (0.300\", 7.62mm); 14-PDIP",
    mountingText: "Through Hole",
  });
  assert.deepEqual(extractPackageParameters(undefined), { packageText: undefined, mountingText: undefined });
});

test("findMounting reads axial/radial leads and imperial chip sizes from supplier descriptions", () => {
  assert.equal(findMounting("CAP CER 100NF 10V X7R 0402"), "smd");
  assert.equal(findMounting("RES 1K OHM 1% 1/10W 0603"), "smd");
  assert.equal(findMounting("RES 1K OHM 5% 1/4W AXIAL"), "through-hole");
  assert.equal(findMounting("CAP ALUM 10UF 20% 50V RADIAL"), "through-hole");
  assert.equal(findMounting("Multilayer Ceramic Capacitors MLCC - Leaded 50V 100nF 10% X7R"), "through-hole");
  // part of a longer number, not a chip size
  assert.equal(findMounting("CRYSTAL 7.3728MHZ 18PF"), undefined);
  assert.equal(findMounting("IC 6MHZ Z80 NMOS CPU 40-DIP 1206A"), undefined);
});
