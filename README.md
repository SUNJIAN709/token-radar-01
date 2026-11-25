# Field Ledger

A token launch radar for [make.fun](https://make.fun/c/token-radar-01). It reads a sealed DefiLlama snapshot, ranks protocols that record no token, and writes a static dashboard with a farm plan for each one.

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/SUNJIAN709/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/SUNJIAN709/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json` and writes `/output/board.json`, `/output/data.js`, a copy of `dashboard/` and `screenshots/`, and `/output/dossier.json`.

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Open `out/dashboard/index.html` from disk. The page does not use the network.

Implied value is `TVL × category mcap/TVL × size × growth × age × chain × breadth × wrapper`, fit from the snapshot's own traded protocols. Wrappers, staking derivatives, bridges and exchange products are not ranked. Every watchlist slug is on the board.

MIT License. See `LICENSE`.
