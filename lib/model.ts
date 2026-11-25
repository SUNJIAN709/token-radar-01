// Field Ledger model. One sealed snapshot in, one ranked board out.
//
// A protocol is ranked when DefiLlama records no token (gecko_id and symbol both null)
// and it is not a wrapped, staked, bridged, versioned or exchange product of an asset
// that already trades. The watchlist is always kept, even when one name is still a
// wrapper: coverage is the floor. Implied value uses only the snapshot's own figures.
//
//   implied = round(tvl × multiple × size × growth × age × chain × breadth × wrapper)
//
// multiple  median mcap/TVL of traded protocols in the same category, after dropping
//           ratios outside [0.005, 5], versioned pools and CEXes. A category with fewer
//           than two clean comparables borrows a sibling category's multiple, else the
//           snapshot-wide median. Capped to [0.012, 1.25].
// size      (tvl / $100M) ^ -0.12, clamped, so a dollar of TVL at a giant book is worth
//           less than a dollar at a mid-size protocol, the shape the traded set shows.
// growth    1 + 0.40 × clamp(change_7d, -40, 60) / 100. Unreported change counts as flat.
// age       how long the listing has run with no token. Prime window is 240 to 730 days.
// chain     that chain's median mcap/TVL against the global median, when at least four
//           traded protocols list it first. Otherwise 1.
// breadth   +2% per extra chain, up to five.
// wrapper   0.35 when the watchlist keeps a derivative, else 1.

/** The snapshot's protocol entry: the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'ledger-1';

export const MODEL = {
  ratio_min: 0.005,
  ratio_max: 5,
  multiple_min: 0.012,
  multiple_max: 1.25,
  growth_weight: 0.4,
  growth_floor: -40,
  growth_cap: 60,
  size_power: -0.12,
  size_pivot_usd: 100_000_000,
  size_min: 0.64,
  size_max: 1.4,
  wrapper_factor: 0.35,
  chain_min_n: 4,
  chain_min: 0.88,
  chain_max: 1.15,
};

/** Categories that are a wrapper, bridge, stake or exchange product of an asset that already trades. */
const DERIVATIVE_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Stablecoin Wrapper',
  'CEX',
]);

/**
 * When a category has fewer than two clean traded comparables, borrow this sibling's
 * multiple. Keys are categories, never protocol names.
 */
const SIBLING: Record<string, string> = {
  'Risk Curators': 'Onchain Capital Allocator',
  'Liquidity Manager': 'Yield Aggregator',
  'CDP Manager': 'CDP',
  'Leveraged Farming': 'Yield',
  Farm: 'Yield',
  'Crypto Card Issuer': 'Payments',
  'Governance Incentives': 'Yield',
  'Uncollateralized Lending': 'Lending',
  'Interest Rate Derivatives': 'Derivatives',
  'Prediction Market': 'Dexs',
  Chain: 'Canonical Bridge',
  Insurance: 'RWA',
  'OTC Marketplace': 'Dexs',
  Indexes: 'Yield Aggregator',
  CeDeFi: 'Lending',
  'Collateral Markets': 'Restaking',
  'Staking Pool': 'Liquid Staking',
  Restaking: 'Liquid Staking',
  'Decentralized BTC': 'RWA',
  'Dual-Token Stablecoin': 'CDP',
  'Stablecoin Wrapper': 'CDP',
};

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAP_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const DAY_MS = 86_400_000;

const ETH_L2 = new Set([
  'Base', 'Arbitrum', 'Optimism', 'Ink', 'Linea', 'Scroll', 'Blast', 'Mantle',
  'zkSync Era', 'World Chain', 'Manta', 'Starknet', 'Morph', 'Fraxtal', 'Mode',
  'Zora', 'Unichain', 'Soneium', 'Taiko', 'Metis', 'Bob', 'Scroll',
]);

export interface Fee {
  asset: string;
  setup: string;
  weekly: string;
  exit: string;
}

export interface Factors {
  multiple: number;
  size: number;
  growth: number;
  age: number;
  chain: number;
  breadth: number;
  wrapper: number;
  method: 'median' | 'pair' | 'shrunk' | 'sibling' | 'global';
  basis: string;
  n: number;
  sibling_n: number;
  growth_pct: number;
  chain_n: number;
  chain_method: 'median' | 'flat';
}

export interface MultipleRow {
  category: string;
  multiple: number;
  method: Factors['method'];
  basis: string;
  n: number;
  sibling_n: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  factors: Factors;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  comparable_n: number;
  counts: {
    protocols: number;
    ranked: number;
    watchlist: number;
    early: number;
    tokened: number;
    derivative: number;
  };
  model: typeof MODEL;
  multiples: MultipleRow[];
  rows: BoardRow[];
  live: LiveRow[];
}

function r4(n: number): number {
  if (!Number.isFinite(n)) throw new Error(`model: non-finite factor ${n}`);
  return Number((Math.round(n * 10_000) / 10_000).toFixed(4));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return a[mid]!;
  return (a[mid - 1]! + a[mid]!) / 2;
}

function cmpSlug(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole days from listed_at to as_of. Null when the listing date is missing or not a day. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null || !/^\d{4}-\d{2}-\d{2}$/.test(listedAt)) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** No gecko id and no symbol: the snapshot records no token. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Wrapped, staked, bridged, versioned, or an exchange product. */
export function isDerivative(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORY.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAP_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Farm-plan family. Categories, never protocol names. */
export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('uncollateral') || c.includes('lend')) return 'lend';
  if (c.includes('dex')) return 'dex';
  if (c.includes('prediction')) return 'predict';
  if (c.includes('option')) return 'options';
  if (c.includes('derivative') || c.includes('perpetual')) return 'perps';
  if (c.includes('cdp') || c.includes('collateral')) return 'cdp';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('curator')) return 'curator';
  if (c.includes('allocator') || c.includes('liquidity manager')) return 'allocator';
  if (c.includes('leveraged')) return 'lev';
  if (c.includes('aggregator')) return 'aggregator';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('basis')) return 'basis';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment') || c.includes('card')) return 'pay';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('stak') || c.includes('restak')) return 'stake';
  if (c.includes('chain')) return 'chain';
  if (c.includes('stable')) return 'stable';
  if (c.includes('governance')) return 'gov';
  if (c.includes('otc')) return 'otc';
  if (c.includes('index')) return 'index';
  if (c.includes('btc') || c.includes('bitcoin')) return 'btc';
  if (c.includes('cedefi') || c.includes('cefi')) return 'cedefi';
  return 'generic';
}

export function feeFor(chain: string): Fee {
  if (chain === 'Ethereum') {
    return { asset: 'ETH', setup: '$8 to $20 of ETH gas', weekly: 'about $5 of ETH gas', exit: '$8 to $20 of ETH gas' };
  }
  if (ETH_L2.has(chain)) {
    return { asset: 'ETH', setup: `under $0.50 of gas on ${chain}`, weekly: 'about $0.15 of gas', exit: `under $0.60 of gas on ${chain}` };
  }
  if (chain === 'Solana') return { asset: 'SOL', setup: 'under $0.20 of SOL fees', weekly: 'under $0.05 of SOL fees', exit: 'under $0.20 of SOL fees' };
  if (chain === 'Bitcoin') return { asset: 'BTC', setup: '$3 to $12 of miner fee', weekly: 'about $3 of miner fee', exit: '$3 to $12 of miner fee' };
  if (chain === 'Binance') return { asset: 'BNB', setup: 'under $0.40 of BNB gas', weekly: 'about $0.10 of BNB gas', exit: 'under $0.40 of BNB gas' };
  if (chain === 'Tron') return { asset: 'TRX', setup: 'about $1 of TRX for energy', weekly: 'about $0.30 of TRX', exit: 'about $1 of TRX' };
  if (chain === 'Polygon') return { asset: 'POL', setup: 'under $0.30 of POL gas', weekly: 'about $0.05 of POL gas', exit: 'under $0.30 of POL gas' };
  if (chain === 'Avalanche') return { asset: 'AVAX', setup: 'under $0.50 of AVAX gas', weekly: 'about $0.15 of AVAX gas', exit: 'under $0.50 of AVAX gas' };
  if (chain === 'Sui') return { asset: 'SUI', setup: 'under $0.20 of SUI fees', weekly: 'under $0.05 of SUI fees', exit: 'under $0.20 of SUI fees' };
  if (chain === 'Aptos') return { asset: 'APT', setup: 'under $0.20 of APT fees', weekly: 'under $0.05 of APT fees', exit: 'under $0.20 of APT fees' };
  if (chain === 'Hyperliquid L1') return { asset: 'HYPE', setup: 'under $0.50 of fees on Hyperliquid', weekly: 'about $0.10 of fees', exit: 'under $0.50 of fees' };
  if (chain === 'Stellar') return { asset: 'XLM', setup: 'under $0.10 of XLM fees', weekly: 'under $0.02 of XLM fees', exit: 'under $0.10 of XLM fees' };
  if (chain === 'Algorand') return { asset: 'ALGO', setup: 'under $0.05 of ALGO fees', weekly: 'under $0.02 of ALGO fees', exit: 'under $0.05 of ALGO fees' };
  if (chain === 'Ripple') return { asset: 'XRP', setup: 'under $0.20 of XRP fees', weekly: 'under $0.05 of XRP fees', exit: 'under $0.20 of XRP fees' };
  if (chain === 'Cardano') return { asset: 'ADA', setup: 'under $0.50 of ADA fees', weekly: 'about $0.20 of ADA fees', exit: 'under $0.50 of ADA fees' };
  if (chain === 'TON') return { asset: 'TON', setup: 'under $0.30 of TON fees', weekly: 'about $0.10 of TON fees', exit: 'under $0.30 of TON fees' };
  return {
    asset: 'the chain gas token',
    setup: `about $0.50 to $2 of gas on ${chain}`,
    weekly: `about $0.25 of gas on ${chain}`,
    exit: `about $0.50 to $2 of gas on ${chain}`,
  };
}

function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 200;
  if (tvl >= 100_000_000) return 150;
  if (tvl >= 25_000_000) return 100;
  return 75;
}

function holdFor(age: number | null): number {
  if (age === null) return 28;
  if (age < 90) return 45;
  if (age < 365) return 30;
  return 21;
}

function ageFactor(days: number | null): number {
  if (days === null) return 0.9;
  if (days < 45) return 0.72;
  if (days < 120) return 0.86;
  if (days < 240) return 1;
  if (days < 730) return 1.14;
  if (days < 1460) return 1.02;
  return 0.84;
}

function sizeFactor(tvl: number): number {
  const raw = Math.pow(tvl / MODEL.size_pivot_usd, MODEL.size_power);
  return r4(clamp(raw, MODEL.size_min, MODEL.size_max));
}

function breadthFactor(chains: number): number {
  return r4(1 + 0.02 * Math.min(Math.max(chains - 1, 0), 5));
}

interface DirectMultiple {
  multiple: number;
  n: number;
  method: 'median' | 'pair' | 'shrunk';
}

function cleanRatio(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || !(p.tvl_usd > 0)) return null;
  if (p.category === 'CEX') return null;
  if (VERSIONED.test(p.name)) return null;
  const ratio = p.mcap_usd / p.tvl_usd;
  if (ratio < MODEL.ratio_min || ratio > MODEL.ratio_max) return null;
  return ratio;
}

function capMultiple(n: number): number {
  return r4(clamp(n, MODEL.multiple_min, MODEL.multiple_max));
}

function directMultiple(xs: number[]): DirectMultiple | null {
  if (xs.length >= 3) return { multiple: capMultiple(median(xs)), n: xs.length, method: 'median' };
  if (xs.length === 2) {
    const lo = Math.min(xs[0]!, xs[1]!);
    const hi = Math.max(xs[0]!, xs[1]!);
    if (lo > 0 && hi / lo <= 4) return { multiple: capMultiple(median(xs)), n: 2, method: 'pair' };
    return { multiple: capMultiple(0.5 * median(xs) + 0.5 * 0), n: 2, method: 'shrunk' };
  }
  return null;
}

interface Book {
  global: number;
  comparableN: number;
  byCategory: Map<string, number[]>;
  byChain: Map<string, number[]>;
}

function buildBook(protocols: SnapshotProtocol[]): Book {
  const byCategory = new Map<string, number[]>();
  const byChain = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    const ratio = cleanRatio(p);
    if (ratio === null) continue;
    all.push(ratio);
    const cat = p.category ?? '';
    const list = byCategory.get(cat);
    if (list) list.push(ratio);
    else byCategory.set(cat, [ratio]);
    const chain = p.chains[0] ?? '';
    const cl = byChain.get(chain);
    if (cl) cl.push(ratio);
    else byChain.set(chain, [ratio]);
  }
  if (all.length === 0) throw new Error('model: the snapshot has no traded comparable');
  return { global: median(all), comparableN: all.length, byCategory, byChain };
}

function lookupMultiple(book: Book, category: string | null): Pick<Factors, 'multiple' | 'method' | 'basis' | 'n' | 'sibling_n'> {
  const cat = category ?? '';
  const own = directMultiple(book.byCategory.get(cat) ?? []);
  // The shrunk branch below fills the global median; directMultiple used 0 as a placeholder.
  if (own && own.method === 'shrunk') {
    const xs = book.byCategory.get(cat) ?? [];
    const multiple = capMultiple(0.5 * median(xs) + 0.5 * book.global);
    return { multiple, method: 'shrunk', basis: cat || 'Uncategorized', n: 2, sibling_n: 0 };
  }
  if (own) return { multiple: own.multiple, method: own.method, basis: cat || 'Uncategorized', n: own.n, sibling_n: 0 };
  const sibName = category ? SIBLING[category] : undefined;
  if (sibName) {
    const sib = directMultiple(book.byCategory.get(sibName) ?? []);
    if (sib && sib.method !== 'shrunk') {
      return { multiple: sib.multiple, method: 'sibling', basis: sibName, n: 0, sibling_n: sib.n };
    }
  }
  return { multiple: capMultiple(book.global), method: 'global', basis: 'snapshot', n: 0, sibling_n: 0 };
}

function chainFactor(book: Book, chain: string): Pick<Factors, 'chain' | 'chain_n' | 'chain_method'> {
  const xs = book.byChain.get(chain) ?? [];
  if (xs.length < MODEL.chain_min_n || book.global <= 0) {
    return { chain: 1, chain_n: xs.length, chain_method: 'flat' };
  }
  const raw = median(xs) / book.global;
  return { chain: r4(clamp(raw, MODEL.chain_min, MODEL.chain_max)), chain_n: xs.length, chain_method: 'median' };
}

interface Act {
  core: string;
  coreTime: string;
  second: string;
  secondCost: string;
  secondTime: string;
  weekly: string;
  weeklyCost: string;
  exit: string;
  exitCost: string;
  exitTime: string;
}

function actions(family: string, name: string, chain: string, capital: number, tick: number, fee: Fee): Act {
  const borrow = Math.max(20, Math.round(capital * 0.25));
  const half = Math.max(20, Math.round(capital / 2));
  const premium = Math.max(15, Math.round(capital / 5));
  switch (family) {
    case 'lend':
      return {
        core: `On ${chain}, open ${name}, choose the USDC market, and supply $${capital}. Leave the receipt token in this wallet.`,
        coreTime: '15 minutes',
        second: `Borrow $${borrow} against that deposit at 25% LTV or less, in ${fee.asset} or ETH, then repay the loan within 7 days.`,
        secondCost: `about two days of interest on a $${borrow} loan, plus ${fee.setup} for the borrow and the repay`,
        secondTime: '10 minutes to borrow, 5 minutes to repay',
        weekly: `Once a week, supply or withdraw $${tick} of USDC so the position stays active. Skip the week if gas would cost more than the amount you move.`,
        weeklyCost: `$${tick} moved, plus ${fee.weekly}`,
        exit: `Repay any borrow first, then withdraw the USDC. Do not deposit the receipt into a second protocol while this position is open: a loop makes the exit and any later claim harder to show.`,
        exitCost: fee.exit,
        exitTime: '15 minutes',
      };
    case 'dex':
      return {
        core: `On ${chain}, add $${capital} of liquidity on ${name}. Use a stable-to-stable pool if one is listed; otherwise use the deepest pool and split the deposit evenly.`,
        coreTime: '20 minutes',
        second: `Swap $${tick} through that same pool so the wallet is a trader as well as a liquidity provider. If the pool is concentrated, set the range about 10% either side of the price and write the bounds down.`,
        secondCost: `$${tick} swapped, plus ${fee.setup}; a volatile pool can also lose a few percent to impermanent loss in a week`,
        secondTime: '10 minutes',
        weekly: `Once a week, swap $${tick} or collect fees if the position is in range. If a concentrated range has been left behind, reset it once and then leave it.`,
        weeklyCost: `${fee.weekly}, plus the spread on a $${tick} swap`,
        exit: `Remove the liquidity back to the two assets and swap any leftover volatile coin to USDC the same day, so you are not left holding the inventory.`,
        exitCost: `${fee.exit} plus the pool's withdrawal fee if it shows one before you sign`,
        exitTime: '15 minutes',
      };
    case 'predict':
      return {
        core: `Fund ${name} with $${capital} of USDC on ${chain}. Buy one outcome in a market that resolves within 30 days, at a price between 20 and 80 cents, and keep the shares in this wallet.`,
        coreTime: '15 minutes',
        second: `Do not put the whole $${capital} on one market. Within 14 days, sell the first position or let a short market resolve, then open a second position of about $${tick} in a different market.`,
        secondCost: `the spread on both trades, usually a few dollars, plus ${fee.weekly}`,
        secondTime: '10 minutes for the second order',
        weekly: `Check the two markets once a week and sell a position that has moved to under 10 cents or over 90 cents, rather than holding a nearly settled share.`,
        weeklyCost: fee.weekly,
        exit: `Sell the shares back to USDC before you leave. A resolved market pays the winning side only, so do not move the wallet until the resolution has settled.`,
        exitCost: `the spread plus ${fee.exit}`,
        exitTime: '10 minutes, or until the market resolves if you hold to the end',
      };
    case 'perps':
      return {
        core: `Deposit $${capital} of USDC as margin on ${name} on ${chain}. Open one position with notional at most $${capital * 2} (2× the margin) and a stop that loses at most a quarter of the margin.`,
        coreTime: '15 minutes',
        second: `Close that position within 14 days and open one the other way, same notional cap, so the account shows two round trips rather than a single leftover bet.`,
        secondCost: `funding on a $${capital * 2} position, often a few dollars over two weeks, plus ${fee.setup} twice`,
        secondTime: '10 minutes to flip',
        weekly: `Once a week, confirm the position is inside the stop and that funding has not cost more than $${tick}. Cut the size in half if it has.`,
        weeklyCost: fee.weekly,
        exit: `Close the position, then withdraw the USDC margin. Do not raise leverage to make up a loss.`,
        exitCost: `the trading fee the ticket shows, plus ${fee.exit}`,
        exitTime: '10 minutes',
      };
    case 'options':
      return {
        core: `On ${name} on ${chain}, post $${capital} of collateral and buy one option with a premium of about $${premium}, expiry under 30 days.`,
        coreTime: '15 minutes',
        second: `Sell that option back or let it expire, then open a second one with a premium under $${premium} so the account has two tickets.`,
        secondCost: `the premium of about $${premium}, which you can lose, plus ${fee.setup}`,
        secondTime: '10 minutes for the second ticket',
        weekly: `Once a week, mark the option to the quoted price and close it if the premium has fallen by more than half.`,
        weeklyCost: fee.weekly,
        exit: `Close or expire the option, then withdraw the collateral. Do not roll into a larger premium to chase the first loss.`,
        exitCost: fee.exit,
        exitTime: '10 minutes',
      };
    case 'cdp':
      return {
        core: `On ${chain}, deposit $${capital} of the collateral ${name} lists first (often ${fee.asset} on this chain) and mint the stablecoin at 30% LTV or less. Leave the collateral and the minted stable in this wallet.`,
        coreTime: '20 minutes',
        second: `Hold the minted stable for 7 days, then repay it and mint once more at the same LTV, so the vault shows two mint cycles.`,
        secondCost: `the stability fee for 7 days on about $${borrow} minted, plus ${fee.setup} for the repay and the second mint`,
        secondTime: '10 minutes for the second cycle',
        weekly: `Once a week, check the LTV. Add $${tick} of collateral or repay if the LTV is above 40%.`,
        weeklyCost: `${fee.weekly} plus $${tick} of collateral if you top up`,
        exit: `Repay the full stablecoin balance first, then withdraw the collateral. Repaying after a depeg, if one is printed on the app, comes before adding more collateral.`,
        exitCost: `the repay amount plus ${fee.exit}`,
        exitTime: '15 minutes',
      };
    case 'rwa':
      return {
        core: `Open ${name} on ${chain} and start KYC or the allowlist if the app asks for one. After approval, mint or deposit $${capital} of the yield asset and keep the receipt in this wallet.`,
        coreTime: '20 minutes to submit, then 1 to 3 business days if a check is required',
        second: `If the app has no KYC, deposit the same day. If it does, finish the check before sending funds, and do not pay a third party to pass it.`,
        secondCost: `$${capital} once you are approved, plus ${fee.setup}; the check itself should be free`,
        secondTime: '15 minutes after approval',
        weekly: `Once a week, read the vault's reported yield and your receipt balance. Withdraw if the app shows a gated redemption you no longer meet.`,
        weeklyCost: fee.weekly,
        exit: `Redeem through the app's own redeem button. RWA redemptions can settle in 1 to 5 business days, so start the exit before you need the cash.`,
        exitCost: `${fee.exit} plus any redemption fee the quote shows before you sign`,
        exitTime: '15 minutes to submit, then up to 5 business days to settle',
      };
    case 'curator':
      return {
        core: `On ${name}, read the vault page for the asset, the cap, and who can change the allocation. Then deposit $${capital} of that asset on ${chain} and keep the vault shares in this wallet.`,
        coreTime: '20 minutes, including the reading',
        second: `Do not loop the shares into another protocol. A week later, open the allocation view and confirm it still matches what you read before depositing.`,
        secondCost: fee.weekly,
        secondTime: '5 minutes a week later',
        weekly: `Once a week, check the share price is moving and that the vault has not hit a withdrawal queue. If a queue is longer than 7 days, stop adding.`,
        weeklyCost: fee.weekly,
        exit: `Withdraw the shares back to the deposit asset from the same vault page. Curator withdrawals can be queued; submit the exit and wait for the queue rather than selling the share elsewhere.`,
        exitCost: fee.exit,
        exitTime: '10 minutes to submit, plus the queue the vault prints',
      };
    case 'allocator':
      return {
        core: `Open the strategy ${name} lists on ${chain}, read the lock and the fee, and deposit $${capital} of the asset the strategy names. Keep the strategy shares in this wallet.`,
        coreTime: '20 minutes',
        second: `Leave the shares idle for 7 days, then claim any harvested yield the strategy page offers back into the same wallet. Do not restake that yield somewhere else during the hold.`,
        secondCost: fee.setup,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, compare the share price with the week before. Exit if the strategy has changed the underlying market without a notice on its own page.`,
        weeklyCost: fee.weekly,
        exit: `Withdraw from the strategy page. If there is a lock, the exit waits out the lock; do not bridge the shares to get around it.`,
        exitCost: `${fee.exit} plus a withdrawal fee if the page shows one`,
        exitTime: '15 minutes, or the lock if one is printed',
      };
    case 'yield':
      return {
        core: `Deposit $${capital} of the asset ${name} accepts on ${chain} into the primary vault and keep the receipt in this wallet.`,
        coreTime: '15 minutes',
        second: `Claim or compound once after 7 days, using the button on ${name}'s own vault page, and leave the new receipt in the same wallet.`,
        secondCost: fee.setup,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, harvest if the pending reward is worth more than the gas. If it is not, wait.`,
        weeklyCost: fee.weekly,
        exit: `Withdraw the receipt back to the deposit asset from the same vault. Do not sell the receipt on a thin pool unless the vault itself is paused.`,
        exitCost: fee.exit,
        exitTime: '10 minutes',
      };
    case 'aggregator':
      return {
        core: `On ${chain}, deposit $${capital} into the autocompounding vault ${name} shows as its primary market. Keep the vault token in this wallet and do not stake it in a second farm.`,
        coreTime: '15 minutes',
        second: `After 7 days, confirm the share price rose by about the posted rate. If the vault paid a separate reward token, claim it once and hold it here.`,
        secondCost: fee.setup,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, read the posted fee and the share price. Leave if the performance fee has changed since you deposited.`,
        weeklyCost: fee.weekly,
        exit: `Withdraw on the vault page back to the original asset. An aggregator token can lag the underlying; withdraw from the vault rather than selling the receipt.`,
        exitCost: fee.exit,
        exitTime: '10 minutes',
      };
    case 'lev':
      return {
        core: `Open the leveraged vault on ${name} on ${chain} at 1.5× or less, never the maximum, and deposit $${capital}. Write down the liquidation price the page shows before you sign.`,
        coreTime: '20 minutes',
        second: `Set a reduce-only unwind, or a reminder, for 7 days. If the page has no stop, unwind manually on day 7 and reopen at the same leverage so the account shows two bounded cycles.`,
        secondCost: `borrow interest for 7 days on the leveraged slice, plus ${fee.setup}`,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, check the distance to liquidation. Add $${tick} of collateral or cut the leverage if that distance is under 15%.`,
        weeklyCost: `${fee.weekly} plus $${tick} if you add collateral`,
        exit: `Repay the leverage and withdraw. Do not increase leverage to recover a drawdown.`,
        exitCost: fee.exit,
        exitTime: '15 minutes',
      };
    case 'basis':
      return {
        core: `On ${name} on ${chain}, read the posted funding or basis rate. Deposit $${capital} only if that rate is positive; otherwise wait and check again in a day.`,
        coreTime: '15 minutes',
        second: `Leave the deposit for 7 days, then open the rate history and confirm you were paid. Claim the week's funding into the same wallet if it is a separate balance.`,
        secondCost: fee.setup,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, re-read the rate. Withdraw if it has been negative for the whole week.`,
        weeklyCost: fee.weekly,
        exit: `Withdraw the deposit asset from the same vault. Basis vaults can have a short redemption delay; start the exit a day before you need the funds.`,
        exitCost: fee.exit,
        exitTime: '10 minutes, plus any delay the vault prints',
      };
    case 'insurance':
      return {
        core: `Buy cover from ${name} on ${chain} for a protocol you already use, for $${capital} of cover and a term of at least 30 days. Keep the policy in this wallet.`,
        coreTime: '15 minutes',
        second: `Read the claim rules before you pay. If a claim needs a second transaction or a vote, write down the deadline the policy shows.`,
        secondCost: `the premium the quote shows, often a few percent of $${capital} for 30 days, plus ${fee.setup}`,
        secondTime: '10 minutes to read the claim rules',
        weekly: `Once a week, confirm the cover is still active and the protocol you covered has not been removed from the list.`,
        weeklyCost: fee.weekly,
        exit: `Let the term end, or cancel if the app allows a refund, and withdraw any unused premium. Do not buy a second policy to replace one you have not read.`,
        exitCost: fee.exit,
        exitTime: '10 minutes',
      };
    case 'pay':
      return {
        core: `Fund ${name} with $${capital} on ${chain}. Send a $${tick} payment to a second wallet you control, and keep both wallets.`,
        coreTime: '10 minutes',
        second: `On a later day, send a second payment of $${tick} the other way, so the account shows two transfers rather than a single self-send.`,
        secondCost: `${fee.setup} on each send; the $${tick} returns to your other wallet`,
        secondTime: '5 minutes on the second day',
        weekly: `Once a week, send $${tick} or invoice the second wallet, whichever the app treats as activity.`,
        weeklyCost: fee.weekly,
        exit: `Withdraw the remaining balance to the wallet you started with, using the app's own withdraw.`,
        exitCost: fee.exit,
        exitTime: '10 minutes',
      };
    case 'stake':
      return {
        core: `Stake $${capital} of the asset ${name} accepts on ${chain} and keep the liquid receipt in this wallet. Do not restake that receipt anywhere else during the hold.`,
        coreTime: '15 minutes',
        second: `After 7 days, claim any staking reward the app shows into the same wallet, then leave the principal staked.`,
        secondCost: fee.setup,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, check the exchange rate of the receipt. Unstake if the rate has stopped updating for 7 days.`,
        weeklyCost: fee.weekly,
        exit: `Unstake through ${name}'s own page and wait out the unbonding period it prints. Do not sell the receipt on a pool to skip a short unbonding unless the page says unstaking is paused.`,
        exitCost: `${fee.exit}; unbonding can take several days with no extra fee`,
        exitTime: '10 minutes to submit, then the unbonding period',
      };
    case 'chain':
      return {
        core: `Move $${capital} of USDC onto ${chain} through the bridge that ${name}'s own app links, then use it once inside the app: one swap or one deposit the app marks as its own.`,
        coreTime: '25 minutes, including the bridge',
        second: `Repeat one in-app action 7 days later so the address is active on two different days, not only on the day you bridged.`,
        secondCost: `${fee.setup} for the second action; the bridge fee is whatever the bridge quote shows before you sign`,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, make one small swap or deposit of $${tick} on ${chain}. Bridging in and straight back out does not count as using the chain.`,
        weeklyCost: fee.weekly,
        exit: `Bridge the USDC back through the same bridge the app linked, after the hold, and keep both bridge receipts.`,
        exitCost: `the return bridge quote plus ${fee.exit}`,
        exitTime: '20 minutes',
      };
    case 'stable':
      return {
        core: `Mint $${capital} of the stable or wrapped stable through ${name} on ${chain} and hold it in this wallet. Redeeming the same day does not show a hold.`,
        coreTime: '15 minutes',
        second: `Transfer $${tick} of the minted token to a second wallet you control and back, once, so the token has moved and not only been minted.`,
        secondCost: `${fee.setup} for the round trip; any mint fee is the one the app shows before you sign`,
        secondTime: '10 minutes',
        weekly: `Once a week, check the mint and redeem price. Redeem if the redeem price is below 0.99 of the asset you put in.`,
        weeklyCost: fee.weekly,
        exit: `Redeem the full balance back to the underlying asset on ${name}'s own page.`,
        exitCost: `${fee.exit} plus a redeem fee if the quote shows one`,
        exitTime: '10 minutes',
      };
    case 'gov':
      return {
        core: `Open ${name} on ${chain}. If a deposit or a lock is required, deposit $${capital}. Then cast the vote or the allocation the app is currently asking for, from this wallet.`,
        coreTime: '20 minutes',
        second: `If a second proposal is open during the hold, vote on that one too. If none is open, leave the deposit and check again in 7 days.`,
        secondCost: fee.setup,
        secondTime: '10 minutes',
        weekly: `Once a week, open the proposal list and vote on anything still live. Skipping a live vote wastes the deposit.`,
        weeklyCost: fee.weekly,
        exit: `Unlock or withdraw the deposit after the hold, from the same page you voted on.`,
        exitCost: fee.exit,
        exitTime: '10 minutes, or the lock if one is printed',
      };
    case 'otc':
      return {
        core: `On ${name} on ${chain}, place one limit of about $${capital} in USDC at a price you would actually accept, and leave it for 24 hours.`,
        coreTime: '15 minutes',
        second: `If it fills, leave the inventory for 7 days. If it does not fill, cancel and replace it once at a tighter price rather than leaving a stale quote.`,
        secondCost: `${fee.setup}; the $${capital} sits in the quote until fill or cancel`,
        secondTime: '10 minutes the next day',
        weekly: `Once a week, replace or renew the quote so it does not expire, and do not cross your own market.`,
        weeklyCost: fee.weekly,
        exit: `Cancel the open quote and withdraw USDC and any filled inventory to this wallet.`,
        exitCost: fee.exit,
        exitTime: '10 minutes',
      };
    case 'index':
      return {
        core: `Buy $${capital} of the index token ${name} issues on ${chain} and hold it in this wallet. Read the constituent list first and skip the buy if you cannot see one.`,
        coreTime: '15 minutes',
        second: `Seven days later, re-open the constituent list and confirm it matches what you bought. Claim any rebalance receipt the app shows.`,
        secondCost: fee.setup,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, check the index for a constituent you would not hold on its own. Sell the index if one appears.`,
        weeklyCost: fee.weekly,
        exit: `Sell the index token back on ${name}'s own page, not on a pool with a few dollars of depth.`,
        exitCost: `the spread plus ${fee.exit}`,
        exitTime: '10 minutes',
      };
    case 'btc':
      return {
        core: `On ${chain}, lock $${capital} worth of BTC, or the BTC the ${name} app itself lists, and keep the receipt in this wallet.`,
        coreTime: '25 minutes',
        second: `After 7 days, confirm the receipt still redeems 1-for-1 on the app's own preview. Do not bridge the receipt to a chain the app does not list.`,
        secondCost: fee.weekly,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, compare the receipt price with BTC. Exit if the gap is wider than 1% and is not explained on the app.`,
        weeklyCost: fee.weekly,
        exit: `Redeem the receipt for BTC on ${name}'s page and wait for the confirmation the page prints.`,
        exitCost: `${fee.exit} plus a miner or gas fee on the redeem`,
        exitTime: '20 minutes, plus the redeem confirmation',
      };
    case 'cedefi':
      return {
        core: `Complete the account link ${name} asks for, then deposit $${capital} of USDC on the on-chain side on ${chain}. Keep the receipt on-chain in this wallet.`,
        coreTime: '20 minutes, or up to 2 days if the app runs a check',
        second: `Do not send funds until the link is confirmed. A day after the deposit, open the position page and confirm the balance matches what you sent.`,
        secondCost: `${fee.setup}; a check, if the app runs one, should not charge a fee`,
        secondTime: '10 minutes the next day',
        weekly: `Once a week, reconcile the on-chain receipt with the balance the app shows. Withdraw if they differ.`,
        weeklyCost: fee.weekly,
        exit: `Withdraw on-chain from ${name}'s own page back to USDC in this wallet.`,
        exitCost: fee.exit,
        exitTime: '15 minutes',
      };
    case 'bridge':
      return {
        core: `Bridge $${capital} of USDC through ${name} to ${chain} and back only after the hold. Keep both receipts.`,
        coreTime: '20 minutes for the outbound bridge',
        second: `Use the bridged USDC once on ${chain} (a swap or a deposit) so the trip is not only a bridge in and a bridge out.`,
        secondCost: `the bridge quote the page shows before you sign, plus ${fee.setup}`,
        secondTime: '10 minutes on the destination',
        weekly: `Once a week, confirm the bridge receipt still matches the balance on ${chain}.`,
        weeklyCost: fee.weekly,
        exit: `Bridge back through ${name}, the same route, after the hold.`,
        exitCost: `the return quote plus ${fee.exit}`,
        exitTime: '20 minutes',
      };
    default:
      return {
        core: `Open ${name} on ${chain} and deposit $${capital} of USDC into the market or vault the home screen offers first. Keep the receipt in this wallet.`,
        coreTime: '20 minutes',
        second: `Seven days later, use one more function the app offers besides the deposit (a claim, a swap or a vote) so the wallet has two kinds of action.`,
        secondCost: fee.setup,
        secondTime: '10 minutes on day 7',
        weekly: `Once a week, make one $${tick} action on the same app. Skip it if the only available action is a new deposit you do not want.`,
        weeklyCost: `${fee.weekly} plus $${tick} if you add funds`,
        exit: `Withdraw from the same page you deposited on, back to USDC in this wallet.`,
        exitCost: fee.exit,
        exitTime: '15 minutes',
      };
  }
}

function line(action: string, cost: string, time: string): string {
  const text = `${action} Cost: ${cost}. Time: ${time}.`.replace(/\s+/g, ' ').trim();
  if (text.length < 20 || text.length > 600) {
    throw new Error(`farm step is ${text.length} characters: ${text.slice(0, 160)}`);
  }
  return text;
}

/** Seven or eight concrete steps: action, what it costs, how long it takes. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its home chain';
  const fee = feeFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdFor(age);
  const tick = Math.max(10, Math.round(capital / 10));
  const family = familyOf(p.category);
  const category = p.category ?? 'Uncategorized';
  const act = actions(family, p.name, chain, capital, tick, fee);
  const steps = [
    line(
      `Create a fresh wallet used only for ${p.name}, a ${category} protocol on ${chain}. Fund it with ${fee.asset} for gas and $${capital} of the asset you will deposit. The $${capital} is a qualifying size, not a position sized to the implied value. Keep the seed offline.`,
      `${fee.setup} to fund gas, before the deposit`,
      '10 minutes',
    ),
    line(act.core, `$${capital} of capital plus ${fee.setup}`, act.coreTime),
    line(act.second, act.secondCost, act.secondTime),
    line(act.weekly, act.weeklyCost, '10 minutes a week'),
    line(
      `Keep the position open for at least ${hold} days. A protocol listed ${age === null ? 'for an unknown time' : `${age} days`} ${age !== null && age < 90 ? 'is still new, so the longer window is there to cover more than one week of activity' : 'gets this hold so the position shows up in more than a single day'}. Do not bridge the receipt to another address and do not close it the day you open it.`,
      `the $${capital} stays deployed; price and smart-contract risk stay yours`,
      `${hold} days`,
    ),
    line(
      `Once a week, open only the rewards or points view that ${p.name} links from its own app on ${chain}, and write down the balance. Do not pay a site that offers to claim it for you.`,
      `nothing to read the page; ${fee.weekly} if a claim transaction is required`,
      '5 minutes a week',
    ),
    line(act.exit, act.exitCost, act.exitTime),
    line(
      `Record the wallet address, every ${chain} transaction hash, the dollar amount and the open date in a private note. You will need that list to unwind, or to show the activity if a claim asks for it.`,
      'nothing',
      '5 minutes once, then one line per later transaction',
    ),
  ];
  return steps;
}

function scoreOne(p: SnapshotProtocol, snapshot: Snapshot, book: Book, watch: Set<string>): Omit<BoardRow, 'rank'> {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const mult = lookupMultiple(book, p.category);
  const chainName = p.chains[0] ?? '';
  const chain = chainFactor(book, chainName);
  const rawGrowth = p.change_7d === null ? 0 : p.change_7d;
  const growthPct = clamp(rawGrowth, MODEL.growth_floor, MODEL.growth_cap);
  const factors: Factors = {
    multiple: mult.multiple,
    size: sizeFactor(p.tvl_usd),
    growth: r4(1 + (growthPct / 100) * MODEL.growth_weight),
    age: r4(ageFactor(age)),
    chain: chain.chain,
    breadth: breadthFactor(p.chains.length),
    wrapper: isDerivative(p) ? MODEL.wrapper_factor : 1,
    method: mult.method,
    basis: mult.basis,
    n: mult.n,
    sibling_n: mult.sibling_n,
    growth_pct: r4(growthPct),
    chain_n: chain.chain_n,
    chain_method: chain.chain_method,
  };
  const implied = Math.round(
    p.tvl_usd * factors.multiple * factors.size * factors.growth * factors.age * factors.chain * factors.breadth * factors.wrapper,
  );
  const impliedValue = Math.min(100_000_000_000_000, Math.max(1, implied));
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    family: familyOf(p.category),
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: age,
    on_watchlist: watch.has(p.slug),
    implied_value_usd: impliedValue,
    factors,
    farm_steps: farmSteps(p, age),
  };
}

/** The protocols the board ranks, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const book = buildBook(snapshot.protocols);
  const chosen: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    if (watch.has(p.slug) || !isDerivative(p)) chosen.push(p);
  }
  const scored = chosen.map((p) => scoreOne(p, snapshot, book, watch));
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
  return scored.map((row, i) => ({ rank: i + 1, ...row }));
}

function liveSample(snapshot: Snapshot): LiveRow[] {
  const rows = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
  const seen = new Set<string>();
  const out: LiveRow[] = [];
  for (const p of rows) {
    const key = (p.symbol || p.gecko_id || p.slug).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    });
    if (out.length === 16) break;
  }
  return out;
}

function multiplesTable(snapshot: Snapshot): { rows: MultipleRow[]; global: number; comparableN: number } {
  const book = buildBook(snapshot.protocols);
  const cats = new Set<string>();
  for (const p of snapshot.protocols) {
    if (p.category) cats.add(p.category);
  }
  const rows: MultipleRow[] = [...cats].sort(cmpSlug).map((category) => {
    const m = lookupMultiple(book, category);
    return { category, multiple: m.multiple, method: m.method, basis: m.basis, n: m.n, sibling_n: m.sibling_n };
  });
  return { rows, global: capMultiple(book.global), comparableN: book.comparableN };
}

/** Everything the dashboard renders, and the board the gate reads. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const watch = new Set(snapshot.watchlist);
  let tokened = 0;
  let derivative = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) tokened += 1;
    else if (isDerivative(p) && !watch.has(p.slug)) derivative += 1;
  }
  const mult = multiplesTable(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: mult.global,
    comparable_n: mult.comparableN,
    counts: {
      protocols: snapshot.protocols.length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      early,
      tokened,
      derivative,
    },
    model: MODEL,
    multiples: mult.rows,
    rows: board,
    live: liveSample(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it has the fields the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    const listed = typeof p.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ? p.listed_at : null;
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: listed,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'duplicate slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (early < 60) return `only ${early} rows outside the watchlist`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is missing`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank}`;
  }
  if (byRank.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value';
  }
  for (const r of byRank) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} implied value ${r.implied_value_usd}`;
    }
    if (r.name.trim() === '') return `${r.slug} has an empty name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script. No fetch. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
