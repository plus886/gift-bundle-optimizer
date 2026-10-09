// app/lib/gift-optimizer.ts の検証スクリプト。
// 総当たり（ビットDP）で求めた最適解と突き合わせ、結果の整合性と所要時間も確認する。
//
//   node scripts/verify-gift-optimizer.ts
//
// TypeScript をそのまま実行するので Node 22.18 以降が必要。失敗があれば終了コード 1。

import { optimizeGiftTiers } from "../app/lib/gift-optimizer.ts";
import type {
  BundleItem,
  TieredOptimizationResult,
} from "../app/lib/gift-optimizer.ts";

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

/** 再現性のある擬似乱数（mulberry32） */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20261009);
const randomInt = (min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
const pick = <T>(values: T[]): T => values[randomInt(0, values.length - 1)];

function toItems(amounts: number[]): BundleItem[] {
  return amounts.map((amount, index) => ({ amount, position: index + 1 }));
}

function expand(rows: [amount: number, quantity: number][]): BundleItem[] {
  return toItems(
    rows.flatMap(([amount, quantity]) =>
      Array.from({ length: quantity }, () => amount)
    )
  );
}

const countsOf = (result: TieredOptimizationResult) =>
  result.tiers.map((tier) => tier.totalGifts);

/** 辞書順の比較（前の段ほど優先） */
function compareCounts(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** 総当たり: アイテムの部分集合 mask ごとに、合計が threshold 以上の組を最大いくつ作れるか */
function bruteForceTable(amounts: number[], threshold: number): Int16Array {
  const size = 1 << amounts.length;
  const cnt = new Int16Array(size);
  const part = new Float64Array(size);
  for (let mask = 1; mask < size; mask++) {
    let bestCnt = -1;
    let bestPart = -1;
    for (let i = 0; i < amounts.length; i++) {
      if (!(mask & (1 << i))) continue;
      const prev = mask ^ (1 << i);
      let c = cnt[prev];
      let p = part[prev] + amounts[i];
      if (p >= threshold) {
        c++;
        p = 0;
      }
      if (c > bestCnt || (c === bestCnt && p > bestPart)) {
        bestCnt = c;
        bestPart = p;
      }
    }
    cnt[mask] = bestCnt;
    part[mask] = bestPart;
  }
  return cnt;
}

/** 総当たりの最適値: 1段目の組数が最大 → その中で2段目の組数が最大 */
function bruteForce(amounts: number[], thresholds: number[]): number[] {
  const full = (1 << amounts.length) - 1;
  const first = bruteForceTable(amounts, thresholds[0]);
  if (thresholds.length === 1) return [first[full]];

  const second = bruteForceTable(amounts, thresholds[1]);
  let best = -1;
  for (let mask = 0; mask <= full; mask++) {
    if (first[mask] === first[full]) best = Math.max(best, second[full ^ mask]);
  }
  return [first[full], best];
}

/** 結果の整合性（各組が門檻以上・全アイテムがちょうど1回ずつ・集計値）を調べる */
function findInconsistency(
  items: BundleItem[],
  thresholds: number[],
  result: TieredOptimizationResult
): string | null {
  const seen = new Map<number, number>();
  const see = (item: BundleItem) =>
    seen.set(item.position, (seen.get(item.position) ?? 0) + 1);
  const sum = (list: BundleItem[]) => list.reduce((s, it) => s + it.amount, 0);

  let remainingAmount = sum(items);
  let remainingCount = items.length;
  if (result.tiers.length !== thresholds.length) return "段の数が違う";

  for (let t = 0; t < thresholds.length; t++) {
    const tier = result.tiers[t];
    if (tier.totalAmount !== remainingAmount) return "totalAmount が違う";
    if (tier.totalGifts !== tier.groups.length) return "totalGifts が違う";

    let covered = 0;
    for (const group of tier.groups) {
      if (sum(group.items) !== group.total) return "組の合計が違う";
      if (!(group.total >= thresholds[t])) return "門檻に届かない組がある";
      group.items.forEach(see);
      covered += group.total;
      remainingCount -= group.items.length;
    }
    if (tier.coveredAmount !== covered) return "coveredAmount が違う";

    remainingAmount -= covered;
    if (tier.leftover.length !== remainingCount) return "leftover の数が違う";
    if (sum(tier.leftover) !== remainingAmount) return "leftover の合計が違う";
  }

  result.leftover.forEach(see);
  if (result.leftover.length !== remainingCount) return "未使用の数が違う";
  for (const item of items) {
    if (seen.get(item.position) !== 1) return "アイテムの重複または欠落";
  }
  return null;
}

let failures = 0;
function fail(message: string) {
  failures++;
  if (failures <= 10) console.log(`  NG: ${message}`);
}

// ---------------------------------------------------------------------------
// 1) 厳密解法: 総当たりの最適解と一致するか
// ---------------------------------------------------------------------------

const PRICES = [
  300, 480, 500, 680, 780, 980, 1000, 1280, 1400, 1500, 1800, 1980, 2480,
];
const smallBaskets: { name: string; make: () => number[]; tiers: number[][] }[] =
  [
    {
      name: "実用的な価格帯",
      make: () => Array.from({ length: randomInt(1, 12) }, () => pick(PRICES)),
      tiers: [[2000, 1000], [1000], [2000]],
    },
    {
      name: "同額が多い（3種類）",
      make: () => {
        const prices = [pick(PRICES), pick(PRICES), pick(PRICES)];
        return Array.from({ length: randomInt(1, 12) }, () => pick(prices));
      },
      tiers: [[2000, 1000], [1000]],
    },
    {
      name: "細かい金額（1〜2500）",
      make: () =>
        Array.from({ length: randomInt(1, 12) }, () => randomInt(1, 2500)),
      tiers: [[2000, 1000], [1000]],
    },
    {
      name: "小さい門檻（降順でない並びも含む）",
      make: () => Array.from({ length: randomInt(1, 12) }, () => randomInt(1, 8)),
      tiers: [[7, 3], [3, 7], [5, 5], [10]],
    },
  ];

console.log("1) 厳密解法を総当たりと照合");
for (const basket of smallBaskets) {
  let cases = 0;
  const before = failures;
  for (let trial = 0; trial < 1000; trial++) {
    const amounts = basket.make();
    const items = toItems(amounts);
    for (const thresholds of basket.tiers) {
      cases++;
      const result = optimizeGiftTiers(items, thresholds);
      const problem = findInconsistency(items, thresholds, result);
      const want = bruteForce(amounts, thresholds);
      const label = `[${amounts.join(",")}] 門檻 ${thresholds.join("/")}`;
      if (problem) fail(`${label}: ${problem}`);
      else if (!result.exact) fail(`${label}: 厳密に解けていない`);
      else if (compareCounts(countsOf(result), want) !== 0) {
        fail(`${label}: ${countsOf(result)} になったが最適は ${want}`);
      }
    }
  }
  console.log(
    `   ${basket.name}: ${cases} 件 / 不一致 ${failures - before} 件`
  );
}

// ---------------------------------------------------------------------------
// 2) 近似（分割して解く）: 予算を絞って強制的に使わせ、最適解・貪欲法と比べる
//    総当たりできる小さな入力で近似を通すために予算を極端に小さくしているので、
//    一致率は実際の設定よりかなり低く出る。ここで確認したいのは
//    「不正な結果を返さない・最適解を超えない・貪欲法より悪くならない」こと。
// ---------------------------------------------------------------------------

console.log("2) 極小の予算で近似を強制し、総当たり・貪欲法と比較（門檻 2000/1000）");
for (const maxExactWork of [50, 2_000]) {
  let cases = 0;
  let optimal = 0;
  const before = failures;
  for (let trial = 0; trial < 1500; trial++) {
    const amounts = Array.from({ length: randomInt(6, 13) }, () =>
      pick(PRICES)
    );
    const items = toItems(amounts);
    const thresholds = [2000, 1000];
    const result = optimizeGiftTiers(items, thresholds, { maxExactWork });
    if (result.exact) continue;

    cases++;
    const counts = countsOf(result);
    const greedy = countsOf(
      optimizeGiftTiers(items, thresholds, { maxExactWork: 0 })
    );
    const want = bruteForce(amounts, thresholds);
    const label = `[${amounts.join(",")}] 予算 ${maxExactWork}`;
    const problem = findInconsistency(items, thresholds, result);
    if (problem) fail(`${label}: ${problem}`);
    else if (compareCounts(counts, want) > 0) fail(`${label}: 最適解を超えた`);
    else if (compareCounts(counts, greedy) < 0) fail(`${label}: 貪欲法より悪い`);
    else if (compareCounts(counts, want) === 0) optimal++;
  }
  console.log(
    `   予算 ${maxExactWork}: ${cases} 件 / 最適と一致 ${optimal} 件 (${(
      (100 * optimal) /
      cases
    ).toFixed(1)}%) / 不正 ${failures - before} 件`
  );
}

// ---------------------------------------------------------------------------
// 3) 大きな入力: 整合性・貪欲法より悪くならないこと・所要時間
// ---------------------------------------------------------------------------

const largeInputs: { name: string; items: BundleItem[] }[] = [
  { name: "2種類を大量", items: expand([[1400, 600], [300, 400]]) },
  {
    name: "3種類を大量",
    items: expand([[1400, 334], [980, 333], [300, 333]]),
  },
  {
    name: "13価格から1000点",
    items: toItems(Array.from({ length: 1000 }, () => pick(PRICES))),
  },
  {
    name: "金額が全て異なる1000点",
    items: toItems(Array.from({ length: 1000 }, (_, index) => 101 + index)),
  },
  {
    name: "20種類を1〜3点ずつ",
    items: expand(
      Array.from({ length: 20 }, (_, index): [number, number] => [
        210 + index * 90,
        randomInt(1, 3),
      ])
    ),
  },
  { name: "1円を1000点", items: expand([[1, 1000]]) },
];

console.log("3) 大きな入力（既定の設定）");
for (const { name, items } of largeInputs) {
  for (const thresholds of [[2000, 1000], [1000]]) {
    const start = performance.now();
    const result = optimizeGiftTiers(items, thresholds);
    const elapsed = performance.now() - start;
    const greedy = optimizeGiftTiers(items, thresholds, { maxExactWork: 0 });

    const label = `${name} 門檻 ${thresholds.join("/")}`;
    const problem = findInconsistency(items, thresholds, result);
    if (problem) fail(`${label}: ${problem}`);
    if (compareCounts(countsOf(result), countsOf(greedy)) < 0) {
      fail(`${label}: 貪欲法より悪い`);
    }
    console.log(
      `   ${label}: ${countsOf(result).join(" / ")} 組` +
        `（貪欲法のみ: ${countsOf(greedy).join(" / ")}）` +
        ` ${result.exact ? "厳密" : "近似"} ${elapsed.toFixed(1)}ms`
    );
  }
}

console.log(failures === 0 ? "全て OK" : `失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
