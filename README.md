# RC2014 BOM

Paste the parts list of an RC2014 kit or a compatible Z80 homebrew module. Get matching parts from **Mouser** and **DigiKey** for every line, and copy a ready-to-paste cart list for each supplier.

**Try it:** https://rc2014-bom.vercel.app (a sample list is preloaded)

## What it reads

Two formats, both taken from real pages:

| Format | Example | Seen on |
|---|---|---|
| Reference / Qty / Component table (tabs or pipes) | `R5 \| 1 \| Resistor, 1k, 0.25W` | Small Computer Central module pages |
| Flat quantity list | `6 x 100nf cap`, `1 x 7.3728 Mhz Xtal` | official RC2014 kit pages |

The part type comes from the reference designator first (R, C, U, Q, D, X, J, P, SW, RP…). Keywords such as socket, crystal and jumper override it, because real tables aren't always clean. The PCB line is skipped, since suppliers don't sell the board.

## What it does

- Normalizes values (resistance, capacitance, crystal frequency) and searches Mouser and DigiKey for each line.
- Ranks the results by how well the value matches, then by package, then by price. The best match is picked by default, and you can change the pick.
- **Matches through-hole parts by default**, because RC2014 boards are through-hole. Without this, a `100nf cap` line picked an 0402 chip capacitor and a `74HCT04` picked a TSSOP. A line that names a package (`SOIC-14`, `SMD`) uses that instead, and a part in the wrong package is marked `[wrong package]` with a warning.
- Finds parts named with an extra word (`Z80 CPU`) by their part number, without matching unrelated parts that merely contain `Z80` inside their own part number.
- Checks the pin count of IC sockets (`40 pin DIP socket` → 40-position sockets only).
- Builds paste lists for Mouser's BOM Tool and for DigiKey. Each list repeats a part number once per unit needed.
- DigiKey prices follow the country you choose. Mouser uses the tool's own account country (Japan).

**Limitations:** switches, jacks and headers are always marked `unknown`, and IC sockets `possible` at best, so check them by hand. If a pasted table loses its tab or pipe separators, some rows won't parse. The DigiKey list format has not been tested against a real DigiKey import yet. Original Zilog Z80 DIP parts are hard to find at Mouser and DigiKey today; the tool will tell you when the only match is in a different package.

## Run locally

Requires Node.js 22.6 or later.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 34 unit tests (parser, packages, ranking, live regressions)
```

It runs without API keys and returns `MOCK` parts. To get real results, put your keys in `.env.local`:

```
MOUSER_API_KEY=
DIGIKEY_CLIENT_ID=
DIGIKEY_CLIENT_SECRET=
```

The keys are only read on the server, in `app/api/match/route.ts`.

Next.js (App Router) · TypeScript · Tailwind CSS · deployed on Vercel.

## Credits

The package check (`lib/package.ts`) was contributed to [Eurorack BOM](https://github.com/Hei0MOrld/eurorack-bom) by [@daaaaaaaaaniel](https://github.com/daaaaaaaaaniel) and ported here.

## License

MIT (see [`LICENSE`](LICENSE)).
