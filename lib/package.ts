// Package (footprint) handling: reading what a BOM line requires, reading
// what a supplier part actually is, and comparing the two.
//
// Why this exists: an IC search like "TL074" returns DIP, SOIC and TSSOP
// versions, all of which contain "TL074" and so all ranked "exact"; the
// cheapest (usually surface-mount) then won silently, even when the BOM
// said DIP-14. Package is now a separate dimension with its own result —
// match / mismatch / unknown / unspecified — so a wrong footprint is
// demoted and flagged instead of being presented as a confident match.

export type PackageFamily =
  | "DIP"
  | "SIP"
  | "SOIC"
  | "SSOP"
  | "TSSOP"
  | "MSOP"
  | "QFN"
  | "SOT-23"
  | "SOT-89"
  | "SOT-223"
  | "SC-70"
  | "TO-92"
  | "TO-126"
  | "TO-220"
  | "SOD-123"
  | "SOD-323"
  | "DO-35"
  | "DO-41";

export type Mounting = "through-hole" | "smd";

// One acceptable package. A spec can name a family (optionally with a pin
// count), or only a mounting style ("SMD", "through-hole") when that's all
// the BOM says.
export interface PackageSpec {
  family?: PackageFamily;
  pins?: number;
  mounting?: Mounting;
}

const THROUGH_HOLE_FAMILIES = new Set<PackageFamily>([
  "DIP",
  "SIP",
  "TO-92",
  "TO-126",
  "TO-220",
  "DO-35",
  "DO-41",
]);

export function mountingOf(family: PackageFamily): Mounting {
  return THROUGH_HOLE_FAMILIES.has(family) ? "through-hole" : "smd";
}

// Pin-counted families written either way round: "DIP-14", "DIP14",
// "14-DIP", "14 DIP", "14DIP" (DigiKey descriptions run them together:
// "IC OPAMP JFET 4 CIRCUIT 14SOIC"). Longer names come first so "TSSOP"
// isn't read as "SSOP" and "PDIP" isn't read as "DIP" with a stray "P".
// "SO" alone only counts with a pin number ("SO-8"), since bare "SO" is a
// common word fragment. "DIP switch" is a component, not a package.
const PIN_FAMILY_ALIASES: Array<[string, PackageFamily]> = [
  ["TSSOP", "TSSOP"],
  ["HTSSOP", "TSSOP"],
  ["SSOP", "SSOP"],
  ["MSOP", "MSOP"],
  ["VSSOP", "MSOP"],
  ["SOIC", "SOIC"],
  ["PDIP", "DIP"],
  ["CDIP", "DIP"],
  ["DIP", "DIP"],
  ["DIL", "DIP"],
  ["SIP", "SIP"],
  ["QFN", "QFN"],
];

const PIN_FAMILY_RE = new RegExp(
  String.raw`(?<![A-Z0-9])(?:(\d{1,2})\s?-?\s?)?(` +
    PIN_FAMILY_ALIASES.map(([alias]) => alias).join("|") +
    String.raw`)(?:\s?-?\s?(\d{1,2}))?(?![A-Z])(?!\s*SWITCH)`,
  "g",
);

const SO_RE = /(?<![A-Z0-9])SO\s?-?\s?(\d{1,2})(?![A-Z0-9])/g;

// Fixed-name packages with an optional trailing pin count:
// "TO-92", "TO92-3", "TO-220-3", "SOT-23-5", "SC-70-6", "DO-35".
const FIXED_FAMILY_RES: Array<[RegExp, PackageFamily]> = [
  [/(?<![A-Z0-9])TO-?92(?:-(\d))?(?![0-9])/g, "TO-92"],
  [/(?<![A-Z0-9])TO-?126(?:-(\d))?(?![0-9])/g, "TO-126"],
  [/(?<![A-Z0-9])TO-?220(?:-(\d))?(?![0-9])/g, "TO-220"],
  [/(?<![A-Z0-9])SOT-?223(?:-(\d))?(?![0-9])/g, "SOT-223"],
  [/(?<![A-Z0-9])SOT-?89(?:-(\d))?(?![0-9])/g, "SOT-89"],
  [/(?<![A-Z0-9])SOT-?23(?:-(\d))?(?![0-9])/g, "SOT-23"],
  [/(?<![A-Z0-9])SC-?70(?:-(\d))?(?![0-9])/g, "SC-70"],
  [/(?<![A-Z0-9])SOD-?123(?![0-9])/g, "SOD-123"],
  [/(?<![A-Z0-9])SOD-?323(?![0-9])/g, "SOD-323"],
  [/(?<![A-Z0-9])DO-?35(?![0-9])/g, "DO-35"],
  [/(?<![A-Z0-9])DO-?41(?![0-9])/g, "DO-41"],
];

function normalize(text: string): string {
  // En/em dashes appear in hand-written BOMs ("DIP–14"); treat them as hyphens.
  return text.toUpperCase().replace(/[‐-―]/g, "-");
}

function pinCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return n >= 3 && n <= 64 ? n : undefined;
}

function addSpec(specs: PackageSpec[], spec: PackageSpec) {
  if (spec.pins === undefined) delete spec.pins;
  const dup = specs.find((s) => s.family === spec.family && s.pins === spec.pins);
  if (!dup) specs.push(spec);
}

// Every package named in a piece of text, in no particular order.
export function findPackages(text: string): PackageSpec[] {
  const t = normalize(text);
  const specs: PackageSpec[] = [];

  for (const m of t.matchAll(PIN_FAMILY_RE)) {
    const family = PIN_FAMILY_ALIASES.find(([alias]) => alias === m[2])![1];
    addSpec(specs, { family, pins: pinCount(m[1]) ?? pinCount(m[3]) });
  }
  for (const m of t.matchAll(SO_RE)) {
    const pins = pinCount(m[1]);
    if (pins) addSpec(specs, { family: "SOIC", pins });
  }
  for (const [re, family] of FIXED_FAMILY_RES) {
    for (const m of t.matchAll(re)) addSpec(specs, { family, pins: pinCount(m[1]) });
  }

  // "TO-92" inside "TO-92-3" is fine, but a bare-family spec that duplicates
  // a pin-counted one adds nothing — drop it.
  return specs.filter(
    (s) => s.pins !== undefined || !specs.some((o) => o !== s && o.family === s.family && o.pins !== undefined),
  );
}

export function findMounting(text: string): Mounting | undefined {
  const t = normalize(text);
  // AXIAL/RADIAL leads and imperial chip sizes ("CAP CER 100NF 10V X7R
  // 0402", "RES 1K 0805") are how suppliers describe passives that name no
  // package family — found live on an RC2014 BOM, where every 100nF line
  // defaulted to an 0402 chip.
  const th = /THROUGH[- ]?HOLE|(?<![A-Z])(?:THT|THD|PTH|AXIAL|RADIAL|LEADED)(?![A-Z])/.test(t);
  const smd =
    /SURFACE[- ]?MOUNT|(?<![A-Z])(?:SMD|SMT)(?![A-Z])|(?<![\dA-Z.])(?:0201|0402|0603|0805|1206|1210|1812)(?![\dA-Z])/.test(t);
  if (th && !smd) return "through-hole";
  if (smd && !th) return "smd";
  return undefined;
}

// What the BOM line asks for. An empty list means the BOM doesn't say.
// Family names win over a bare mounting word; a mounting word alone
// ("SMD" in the Note column) becomes a mounting-only requirement.
export function packageRequirement(fields: string[]): PackageSpec[] {
  const text = fields.join(" ");
  const specs = findPackages(text);
  if (specs.length > 0) return specs;
  const mounting = findMounting(text);
  return mounting ? [{ mounting }] : [];
}

export function formatSpec(spec: PackageSpec): string {
  if (spec.family) return spec.pins ? `${spec.family}-${spec.pins}` : spec.family;
  return spec.mounting === "smd" ? "surface-mount" : "through-hole";
}

export function formatRequirement(req: PackageSpec[]): string {
  return req.map(formatSpec).join(" or ");
}

export type PackageStatus = "match" | "mismatch" | "unknown" | "unspecified";

export interface PackageCheck {
  status: PackageStatus;
  // What the candidate was read as, for display ("SOIC-14", "through-hole"),
  // or undefined when nothing could be read.
  found?: string;
  // Where `found` came from: structured supplier data is reliable; words
  // picked out of a free-text description are a weaker signal.
  source?: "supplier data" | "description";
}

export interface CandidatePackageInfo {
  packageText?: string; // e.g. DigiKey "Package / Case" / "Supplier Device Package"
  mountingText?: string; // e.g. DigiKey "Mounting Type"
  description: string;
}

function readCandidate(info: CandidatePackageInfo): {
  specs: PackageSpec[];
  mounting?: Mounting;
  source?: PackageCheck["source"];
} {
  let specs: PackageSpec[] = [];
  let source: PackageCheck["source"];
  if (info.packageText) {
    specs = findPackages(info.packageText);
    if (specs.length) source = "supplier data";
  }
  if (specs.length === 0) {
    specs = findPackages(info.description);
    if (specs.length) source = "description";
  }

  let mounting = info.mountingText ? findMounting(info.mountingText) : undefined;
  if (mounting && !source) source = "supplier data";
  if (!mounting && specs.length) {
    const kinds = new Set(specs.map((s) => mountingOf(s.family!)));
    if (kinds.size === 1) mounting = [...kinds][0];
  }
  if (!mounting && specs.length === 0) {
    mounting = findMounting(info.description);
    if (mounting) source = "description";
  }
  return { specs, mounting, source };
}

type OptionResult = "match" | "fail" | "unknown";

function checkOption(
  option: PackageSpec,
  cand: { specs: PackageSpec[]; mounting?: Mounting },
): OptionResult {
  if (option.family) {
    if (cand.specs.length > 0) {
      const ok = cand.specs.some(
        (s) =>
          s.family === option.family &&
          (option.pins === undefined || s.pins === undefined || s.pins === option.pins),
      );
      return ok ? "match" : "fail";
    }
    if (cand.mounting) return cand.mounting === mountingOf(option.family) ? "unknown" : "fail";
    return "unknown";
  }
  if (option.mounting) {
    if (!cand.mounting) return "unknown";
    return cand.mounting === option.mounting ? "match" : "fail";
  }
  return "unknown";
}

export function checkPackage(requirement: PackageSpec[], info: CandidatePackageInfo): PackageCheck {
  const cand = readCandidate(info);
  const found =
    cand.specs.length > 0 ? cand.specs.map(formatSpec).join(" / ") : cand.mounting ? formatSpec({ mounting: cand.mounting }) : undefined;
  const base = { found, source: found ? cand.source : undefined };

  if (requirement.length === 0) return { status: "unspecified", ...base };

  const results = requirement.map((opt) => checkOption(opt, cand));
  if (results.includes("match")) return { status: "match", ...base };
  if (results.includes("unknown")) return { status: "unknown", ...base };
  return { status: "mismatch", ...base };
}
