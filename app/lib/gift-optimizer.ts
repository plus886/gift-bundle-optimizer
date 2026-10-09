// gift-bundle-optimizer.ts
// 合計が門檻（threshold）以上になるアイテムの組を、できるだけ多く作る。
// - 3点以上OK
// - 同一商品（同額）を複数個扱うのは「別BundleItemとして渡す」ことで対応
//   例: 500円を4つ -> [{amount:500,pos:1},{amount:500,pos:2},{amount:500,pos:3},{amount:500,pos:4}]
//
// 解き方:
// 1) 同額アイテムを「金額の種類ごとの個数」にまとめ、個数ベクトル上の動的計画法で厳密解を求める。
//    門檻が複数あるときは前の段を優先し、前の段の組数を最大に保ったまま
//    次の段の組数が最大になる組み方を選ぶ。
// 2) 種類や個数が多く表が大きくなりすぎるときは、均等に分割して部分ごとに厳密に解き、
//    余りを集めて解き直す（近似）。従来の貪欲法の結果とも比べ、良い方を採用する。
//
// 変更したら `node scripts/verify-gift-optimizer.ts` で総当たりの最適解と照合できる。

export const MAX_ITEMS = 1000;

/** 厳密解法に使う計算量（表のセル数 × 金額の種類数）の既定上限 */
const DEFAULT_MAX_EXACT_WORK = 4_000_000;
/** 1つの表のセル数の上限（メモリ対策） */
const MAX_TABLE_CELLS = 1 << 21;
/** 表に載せられる門檻の上限（Int32Array に収めるため） */
const MAX_TABLE_THRESHOLD = 1 << 30;
/** 分割して解き直す深さの上限 */
const MAX_CHUNK_DEPTH = 4;
/** 近似解の改善: 並べ替えて解き直す回数と、予算を何回分の解き直しに割るか */
const REFINE_PASSES = 4;
const REFINE_STEPS = 12;

export type BundleItem = {
  amount: number;
  position: number; // 一意推奨（同額複数でも区別できる）
};

export type BundleGroup = {
  total: number;
  items: BundleItem[];
};

export type BundleOptimizationResult = {
  groups: BundleGroup[];
  leftover: BundleItem[];
  totalGifts: number;
  threshold: number;
  totalAmount: number;
  coveredAmount: number;
};

export type TieredOptimizationResult = {
  /** thresholds と同じ並び。各段の leftover は「その段までで使われなかったアイテム」 */
  tiers: BundleOptimizationResult[];
  /** どの段にも使われなかったアイテム */
  leftover: BundleItem[];
  /** 全段を厳密に解けたか（false は分割や貪欲法による近似を含む） */
  exact: boolean;
};

export type OptimizeOptions = {
  /** 厳密解法に使う計算量（表のセル数 × 金額の種類数）の上限。超える分は近似で解く */
  maxExactWork?: number;
  /** 貪欲法: 局所改善の最大反復回数（未指定なら items.length * 4 を上限にしつつ cap もかける） */
  maxImproveIters?: number;
  /** 貪欲法: poolのソートを何回に1回やり直すか（寄付で乱れたときの再ソート頻度） */
  resortEvery?: number;
  /** 貪欲法: trueなら完成グループの余剰から「直接」未達を完成させる改善も試す */
  enableDirectDonate?: boolean;
};

type WorkingGroup = BundleGroup;

function sanitizeItems(items: BundleItem[]): BundleItem[] {
  return items
    .map((item, index) => ({
      amount: Math.floor(item.amount),
      position: Number.isFinite(item.position) ? item.position : index + 1,
    }))
    .filter((it) => Number.isFinite(it.amount) && it.amount > 0);
}

/**
 * 複数の門檻（段）をまとめて最適化する。thresholds は優先度の高い順。
 * 前の段の組数を最大にしたうえで、残りから作れる次の段の組数が最大になる組み方を選ぶ
 * （例: [2000, 1000] なら、2000の組数が最大の組み方のうち、1000の組数が最も多いもの）。
 * 3点以上の組み合わせOK / 同一商品複数OK（BundleItemを個数分渡す）
 */
export function optimizeGiftTiers(
  items: BundleItem[],
  thresholds: number[],
  options: OptimizeOptions = {}
): TieredOptimizationResult {
  const sanitized = sanitizeItems(items);
  const { tiers: assignments, exact } = assignTiers(
    sanitized,
    thresholds,
    options
  );

  const amountOf = (indexes: number[]) =>
    indexes.reduce((sum, index) => sum + sanitized[index].amount, 0);
  const used = sanitized.map(() => false);
  let remaining = sanitized.map((_, index) => index);

  const tiers = thresholds.map(
    (threshold, tierIndex): BundleOptimizationResult => {
      const totalAmount = amountOf(remaining);

      // 出力整形（position順で見やすく）
      const groups = sortGroupsByPosition(
        assignments[tierIndex].map((indexes) => ({
          total: amountOf(indexes),
          items: indexes.map((index) => sanitized[index]),
        }))
      );

      for (const indexes of assignments[tierIndex]) {
        for (const index of indexes) used[index] = true;
      }
      remaining = remaining.filter((index) => !used[index]);

      return {
        groups,
        leftover: remaining.map((index) => sanitized[index]),
        totalGifts: groups.length,
        threshold,
        totalAmount,
        coveredAmount: groups.reduce((sum, group) => sum + group.total, 0),
      };
    }
  );

  return {
    tiers,
    leftover: remaining.map((index) => sanitized[index]),
    exact,
  };
}

/** 門檻が1つだけの場合 */
export function optimizeGiftBundles(
  items: BundleItem[],
  threshold: number,
  options: OptimizeOptions = {}
): BundleOptimizationResult {
  return optimizeGiftTiers(items, [threshold], options).tiers[0];
}

/** 1組 = アイテム（sanitize 後の配列の index）の並び */
type TierAssignment = number[][];

function assignTiers(
  items: BundleItem[],
  thresholds: number[],
  options: OptimizeOptions
): { tiers: TierAssignment[]; exact: boolean } {
  // 同額アイテムを1つの「種類」にまとめる（金額の昇順）
  const order = items
    .map((_, index) => index)
    .sort((a, b) => items[a].amount - items[b].amount || a - b);
  const amounts: number[] = [];
  const members: number[][] = [];
  for (const index of order) {
    if (amounts[amounts.length - 1] !== items[index].amount) {
      amounts.push(items[index].amount);
      members.push([]);
    }
    members[members.length - 1].push(index);
  }
  const counts = members.map((indexes) => indexes.length);

  // 合計は整数なので、門檻は切り上げて整数で比較する。無効な門檻の段は何も作らない
  const limits = thresholds.map((threshold) =>
    Number.isFinite(threshold) && threshold > 0
      ? Math.ceil(threshold)
      : undefined
  );
  const meter: WorkMeter = {
    left: options.maxExactWork ?? DEFAULT_MAX_EXACT_WORK,
  };

  let exact = true;
  let prebuilt: CountTable | undefined;
  const typeGroups: number[][][] = [];
  for (let tierIndex = 0; tierIndex < limits.length; tierIndex++) {
    const limit = limits[tierIndex];
    if (limit === undefined) {
      typeGroups.push([]);
      continue;
    }

    const nextLimit = limits
      .slice(tierIndex + 1)
      .find((value) => value !== undefined);
    const solved = solveTier(amounts, counts, limit, nextLimit, meter, prebuilt);
    if (!solved.exact) exact = false;
    prebuilt = solved.next;
    typeGroups.push(solved.groups);
  }

  // 種類 → 実際のアイテム（同額なら入力順の早いものから使う）
  const cursor = members.map(() => 0);
  const tiers = typeGroups.map((groups) =>
    groups.map((group) => group.map((type) => members[type][cursor[type]++]))
  );
  if (exact) return { tiers, exact };

  // 近似が混ざった場合は、従来の貪欲法より悪くならないことを保証する
  const greedy = assignTiersGreedy(items, thresholds, options);
  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    const diff = greedy[tierIndex].length - tiers[tierIndex].length;
    if (diff !== 0) return { tiers: diff > 0 ? greedy : tiers, exact };
  }
  return { tiers, exact };
}

// ---------------------------------------------------------------------------
// 厳密解法（金額の種類ごとの個数ベクトル上の動的計画法）
//
// 種類は金額の昇順に並べ、amounts[type] が金額、counts[type] が残りの個数。
// 1組は種類 index の配列で表す。
// ---------------------------------------------------------------------------

type WorkMeter = { left: number };

type CountTable = {
  threshold: number;
  /** 表が扱う種類（金額の昇順） */
  types: number[];
  /** 個数ベクトルを状態番号にするときの、種類ごとの重み（混合基数） */
  strides: number[];
  /** その個数ベクトルのアイテムだけで作れる組数の最大 */
  cnt: Int32Array;
  /** 上の組数を保ったまま、作りかけの組に残せる合計の最大 */
  part: Int32Array;
};

type TierSolution = {
  groups: number[][];
  /** 次の段の先読みに使った表（次の段でそのまま使い回す） */
  next?: CountTable;
  /** 次の段の先読みまで含めて厳密に解けたか */
  exact: boolean;
};

/** counts から threshold 以上の組を取り出す（counts は残りの個数に更新される） */
function solveTier(
  amounts: number[],
  counts: number[],
  threshold: number,
  nextThreshold: number | undefined,
  meter: WorkMeter,
  prebuilt: CountTable | undefined
): TierSolution {
  // 単品で門檻を満たすアイテムは、1点で1組にするのが最適
  const singles: number[][] = [];
  for (let type = 0; type < amounts.length; type++) {
    if (amounts[type] < threshold) continue;
    for (; counts[type] > 0; counts[type]--) singles.push([type]);
  }

  const solved = solveSmallExact(
    amounts,
    counts,
    threshold,
    nextThreshold,
    meter,
    prebuilt
  );
  if (solved) return { ...solved, groups: singles.concat(solved.groups) };

  const approximated = refineGroups(
    amounts,
    counts,
    solveSmallChunked(amounts, counts, threshold, nextThreshold, meter, 0),
    threshold,
    nextThreshold,
    meter
  );
  return { groups: singles.concat(approximated), exact: false };
}

/** counts > 0 かつ金額が threshold 未満の種類 */
function smallTypes(
  amounts: number[],
  counts: number[],
  threshold: number
): number[] {
  const types: number[] = [];
  for (let type = 0; type < amounts.length; type++) {
    if (counts[type] > 0 && amounts[type] < threshold) types.push(type);
  }
  return types;
}

/** types のうち個数が残っている種類で表を作るときの計算量（大きすぎる場合は Infinity） */
function tableWork(counts: number[], types: number[]): number {
  let cells = 1;
  let kinds = 0;
  for (const type of types) {
    if (counts[type] === 0) continue;
    kinds++;
    cells *= counts[type] + 1;
    if (cells > MAX_TABLE_CELLS) return Infinity;
  }
  return cells * kinds;
}

/**
 * types の全ての個数ベクトルについて「作れる組数の最大」を求める。
 *
 * アイテムを1点ずつ作りかけの組に足していき、合計が threshold に達したら1組完成とする。
 * 各個数ベクトルで (完成した組数, 作りかけの合計) が辞書順で最大のものだけ覚えておけば、
 * 完成した組数がそのまま最適値になる。
 */
function buildCountTable(
  amounts: number[],
  counts: number[],
  types: number[],
  threshold: number
): CountTable {
  const k = types.length;
  const amt = types.map((type) => amounts[type]);
  const bounds = types.map((type) => counts[type]);
  const strides: number[] = [];
  let cells = 1;
  for (const bound of bounds) {
    strides.push(cells);
    cells *= bound + 1;
  }

  const cnt = new Int32Array(cells);
  const part = new Int32Array(cells);
  const digits = new Int32Array(k);

  for (let state = 1; state < cells; state++) {
    // digits を state の個数ベクトルに進める
    let carry = 0;
    while (digits[carry] === bounds[carry]) digits[carry++] = 0;
    digits[carry]++;

    let bestCnt = -1;
    let bestPart = -1;
    for (let j = 0; j < k; j++) {
      if (digits[j] === 0) continue;
      // 種類 j の1点を最後に足した場合
      const prev = state - strides[j];
      let c = cnt[prev];
      let p = part[prev] + amt[j];
      if (p >= threshold) {
        c++;
        p = 0;
      }
      if (c > bestCnt || (c === bestCnt && p > bestPart)) {
        bestCnt = c;
        bestPart = p;
      }
    }
    cnt[state] = bestCnt;
    part[state] = bestPart;
  }

  return { threshold, types, strides, cnt, part };
}

/**
 * 単品では threshold に届かないアイテムだけで、組数が最大になる組み方を求める。
 * 表が大きすぎて作れない場合は null（counts は変更しない）。
 */
function solveSmallExact(
  amounts: number[],
  counts: number[],
  threshold: number,
  nextThreshold: number | undefined,
  meter: WorkMeter,
  prebuilt?: CountTable
): TierSolution | null {
  let table = prebuilt?.threshold === threshold ? prebuilt : undefined;
  const types = table ? table.types : smallTypes(amounts, counts, threshold);
  const k = types.length;
  const amt = types.map((type) => amounts[type]);
  const rem = types.map((type) => counts[type]);

  let total = 0;
  for (let i = 0; i < k; i++) total += rem[i] * amt[i];
  if (total < threshold) return { groups: [], exact: true };

  if (!table) {
    const work = tableWork(counts, types);
    if (threshold > MAX_TABLE_THRESHOLD || work > meter.left) return null;
    meter.left -= work;
    table = buildCountTable(amounts, counts, types, threshold);
  }
  const { strides, cnt, part } = table;

  // 残り (rem - u) から次の段で作れる組数
  //   = 単品で次の門檻を満たす残数 + それ未満の種類だけで作れる組数（表引き）
  const singleNext = rem.map(() => 0);
  const nextStrides = rem.map(() => 0);
  let nextTable: CountTable | undefined;
  let exact = true;
  if (nextThreshold !== undefined) {
    const nextTypes: number[] = [];
    let nextTotal = 0;
    for (let i = 0; i < k; i++) {
      if (amt[i] >= nextThreshold) {
        singleNext[i] = 1;
      } else if (rem[i] > 0) {
        nextTypes.push(types[i]);
        nextTotal += rem[i] * amt[i];
      }
    }
    if (nextTotal >= nextThreshold) {
      const work = tableWork(counts, nextTypes);
      if (nextThreshold <= MAX_TABLE_THRESHOLD && work <= meter.left) {
        meter.left -= work;
        nextTable = buildCountTable(amounts, counts, nextTypes, nextThreshold);
        let n = 0;
        for (let i = 0; i < k; i++) {
          if (singleNext[i] === 0 && rem[i] > 0) {
            nextStrides[i] = nextTable.strides[n++];
          }
        }
      } else {
        exact = false;
      }
    }
  }
  const nextCnt = nextTable?.cnt;

  // rem 以下の個数ベクトル u を全て調べ、組数が最大のまま
  //   1) 次の段で作れる組数が最大
  //   2) 使う金額の合計が最小（＝余計なアイテムを巻き込まない）
  // になるものを選ぶ
  let fullState = 0;
  let nextState = 0;
  let singlesLeft = 0;
  for (let i = 0; i < k; i++) {
    fullState += rem[i] * strides[i];
    nextState += rem[i] * nextStrides[i];
    singlesLeft += rem[i] * singleNext[i];
  }
  const target = cnt[fullState];

  const digits = rem.map(() => 0);
  let state = 0;
  let usedAmount = 0;
  let bestState = 0;
  let bestNext = -1;
  let bestAmount = 0;
  for (;;) {
    if (cnt[state] === target) {
      const next = singlesLeft + (nextCnt ? nextCnt[nextState] : 0);
      if (next > bestNext || (next === bestNext && usedAmount < bestAmount)) {
        bestState = state;
        bestNext = next;
        bestAmount = usedAmount;
      }
    }

    // u を次の個数ベクトルに進める
    let i = 0;
    for (; i < k && digits[i] === rem[i]; i++) {
      const n = digits[i];
      state -= n * strides[i];
      usedAmount -= n * amt[i];
      nextState += n * nextStrides[i];
      singlesLeft += n * singleNext[i];
      digits[i] = 0;
    }
    if (i === k) break;
    digits[i]++;
    state += strides[i];
    usedAmount += amt[i];
    nextState -= nextStrides[i];
    singlesLeft -= singleNext[i];
  }

  // 選んだ個数ベクトルを1点ずつ遡って、アイテムを足した順番（の逆順）を復元する
  let placed = 0;
  state = bestState;
  for (let i = k - 1; i >= 0; i--) {
    digits[i] = Math.floor(state / strides[i]);
    state -= digits[i] * strides[i];
    placed += digits[i];
  }
  const sequence: number[] = [];
  state = bestState;
  for (; placed > 0; placed--) {
    for (let j = 0; j < k; j++) {
      if (digits[j] === 0) continue;
      const prev = state - strides[j];
      let c = cnt[prev];
      let p = part[prev] + amt[j];
      if (p >= threshold) {
        c++;
        p = 0;
      }
      if (c === cnt[state] && p === part[state]) {
        sequence.push(j);
        digits[j]--;
        state = prev;
        break;
      }
    }
  }

  // 足した順に並べ直し、門檻に達するたびに1組として切り出す
  const groups: number[][] = [];
  let current: number[] = [];
  let sum = 0;
  for (let n = sequence.length - 1; n >= 0; n--) {
    current.push(types[sequence[n]]);
    sum += amt[sequence[n]];
    if (sum >= threshold) {
      for (const type of current) counts[type]--;
      groups.push(current);
      current = [];
      sum = 0;
    }
  }

  return { groups, next: nextTable, exact };
}

// ---------------------------------------------------------------------------
// 表が大きすぎるときの近似（分割して厳密に解く）
// ---------------------------------------------------------------------------

type Chunk = { counts: number[]; copies: number };

/**
 * アイテムを均等に分割してそれぞれを厳密に解き、余りを集めてもう一度解く。
 * counts は残りの個数に更新される。
 */
function solveSmallChunked(
  amounts: number[],
  counts: number[],
  threshold: number,
  nextThreshold: number | undefined,
  meter: WorkMeter,
  depth: number
): number[][] {
  if (threshold > MAX_TABLE_THRESHOLD) return [];

  const types = smallTypes(amounts, counts, threshold);
  let itemCount = 0;
  for (const type of types) itemCount += counts[type];

  // 表の合計が予算に収まる最小の分割数を探す（先読みの表の分も見込む）
  const budget = meter.left / 2;
  let chunks: Chunk[] | undefined;
  for (
    let chunkCount = 2;
    chunkCount <= itemCount;
    chunkCount = chunkCount < 8 ? chunkCount + 1 : Math.ceil(chunkCount * 1.25)
  ) {
    const candidate = splitIntoChunks(counts, types, chunkCount);
    let work = 0;
    for (const chunk of candidate) work += 2 * tableWork(chunk.counts, types);
    if (work <= budget) {
      chunks = candidate;
      break;
    }
  }
  if (!chunks) return [];

  const groups: number[][] = [];
  const pool = counts.map(() => 0);
  for (const chunk of chunks) {
    const solved = solveSmallExact(
      amounts,
      chunk.counts,
      threshold,
      nextThreshold,
      meter
    );
    for (let copy = 0; copy < chunk.copies; copy++) {
      if (solved) groups.push(...solved.groups);
      for (const type of types) pool[type] += chunk.counts[type];
    }
  }
  if (groups.length === 0) return [];

  // 各分割の余りを集めて、まだ組が作れないか解き直す
  for (const type of types) counts[type] = pool[type];
  const rest =
    solveSmallExact(amounts, counts, threshold, nextThreshold, meter)?.groups ??
    (depth + 1 < MAX_CHUNK_DEPTH
      ? solveSmallChunked(
          amounts,
          counts,
          threshold,
          nextThreshold,
          meter,
          depth + 1
        )
      : []);
  return groups.concat(rest);
}

/** counts を chunkCount 個にできるだけ均等に分ける（同じ内容の分割は1つにまとめる） */
function splitIntoChunks(
  counts: number[],
  types: number[],
  chunkCount: number
): Chunk[] {
  const parts = Array.from({ length: chunkCount }, () => counts.map(() => 0));
  let offset = 0;
  for (const type of types) {
    const base = Math.floor(counts[type] / chunkCount);
    const extra = counts[type] % chunkCount;
    for (let n = 0; n < chunkCount; n++) parts[n][type] = base;
    // 端数は配り先をずらしながら1点ずつ配り、特定の分割に偏らせない
    for (let n = 0; n < extra; n++) parts[(offset + n) % chunkCount][type]++;
    offset = (offset + extra) % chunkCount;
  }

  const unique = new Map<string, Chunk>();
  for (const part of parts) {
    const key = part.join(",");
    const same = unique.get(key);
    if (same) same.copies++;
    else unique.set(key, { counts: part, copies: 1 });
  }
  return [...unique.values()];
}

/**
 * 近似で作った組を改善する。組の一部と余り（counts）全部を1つの小さな問題として
 * 厳密に解き直すことを、組み合わせを変えながら繰り返す。
 * 解き直した結果は元の組数以上になるので、悪くなることはない。
 */
function refineGroups(
  amounts: number[],
  counts: number[],
  groups: number[][],
  threshold: number,
  nextThreshold: number | undefined,
  meter: WorkMeter
): number[][] {
  const types: number[] = [];
  for (let type = 0; type < amounts.length; type++) {
    if (amounts[type] < threshold) types.push(type);
  }

  // 次の段の分を残すため、使うのは残り予算の半分まで
  let budget = meter.left / 2;
  const stepWork = budget / REFINE_STEPS;
  const random = createRandom(groups.length);

  let current = groups;
  for (let pass = 0; pass < REFINE_PASSES; pass++) {
    // 毎回違う組み合わせを解き直せるように並べ替える
    current = current.slice();
    for (let i = current.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [current[i], current[j]] = [current[j], current[i]];
    }

    const refined: number[][] = [];
    for (let start = 0; start < current.length; ) {
      if (budget < stepWork) {
        refined.push(...current.slice(start));
        break;
      }

      // 表が stepWork に収まる範囲で、解き直す組を集める
      const pooled = counts.slice();
      let end = start;
      for (; end < current.length; end++) {
        for (const type of current[end]) pooled[type]++;
        if (2 * tableWork(pooled, types) > stepWork) {
          for (const type of current[end]) pooled[type]--;
          break;
        }
      }
      if (end === start) {
        refined.push(current[start++]);
        continue;
      }

      const before = meter.left;
      const solved = solveSmallExact(
        amounts,
        pooled,
        threshold,
        nextThreshold,
        meter
      );
      budget -= before - meter.left;

      if (solved) {
        refined.push(...solved.groups);
        for (const type of types) counts[type] = pooled[type];
      } else {
        refined.push(...current.slice(start, end));
      }
      start = end;
    }
    current = refined;
  }
  return current;
}

/** 入力が同じなら結果も同じになるよう、固定の種から作る擬似乱数 */
function createRandom(seed: number): () => number {
  let state = (seed + 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 従来の貪欲法（Largest-first + Best-Fit ＋ 局所改善）
// 厳密に解けない規模のときの比較用。
// ---------------------------------------------------------------------------

/** 全ての段を貪欲法で順に解く */
function assignTiersGreedy(
  items: BundleItem[],
  thresholds: number[],
  options: OptimizeOptions
): TierAssignment[] {
  // position が重複していても区別できるよう、index を position として渡す
  let pool: BundleItem[] = items.map((item, index) => ({
    amount: item.amount,
    position: index,
  }));

  return thresholds.map((threshold) => {
    if (!(threshold > 0)) return [];

    // 1) 初期解：Largest-first + Best-Fit（未達箱のみを対象にする）
    const { completed, pool: unplaced } = buildInitialSolution(pool, threshold);

    // 2) 局所改善：poolから追加グループ生成 / 完成グループから寄付して再挑戦 / 直接寄付で1手完成
    performLocalImprovements(
      completed,
      unplaced,
      threshold,
      pool.length,
      options
    );

    const used = new Set<number>();
    for (const group of completed) {
      for (const item of group.items) used.add(item.position);
    }
    pool = pool.filter((item) => !used.has(item.position));
    return completed.map((group) => group.items.map((item) => item.position));
  });
}

/** 初期解：大きい順に、未達グループへ best-fit で詰め、達したら完成へ移動 */
function buildInitialSolution(
  items: BundleItem[],
  threshold: number
): {
  completed: WorkingGroup[];
  pool: BundleItem[];
} {
  const sorted = [...items].sort((a, b) => b.amount - a.amount);

  const completed: WorkingGroup[] = [];
  const open: WorkingGroup[] = []; // 未達のみ持つ

  for (const item of sorted) {
    let bestCompleteIdx = -1;
    let bestOvershoot = Infinity;
    let bestIncompleteIdx = -1;
    let bestShortfall = Infinity;

    for (let i = 0; i < open.length; i++) {
      const g = open[i];
      const newTotal = g.total + item.amount;

      if (newTotal >= threshold) {
        const overshoot = newTotal - threshold;
        if (overshoot < bestOvershoot) {
          bestOvershoot = overshoot;
          bestCompleteIdx = i;
        }
      } else {
        const shortfall = threshold - newTotal;
        if (shortfall < bestShortfall) {
          bestShortfall = shortfall;
          bestIncompleteIdx = i;
        }
      }
    }

    const targetIdx =
      bestCompleteIdx !== -1 ? bestCompleteIdx : bestIncompleteIdx;

    if (targetIdx === -1) {
      // 新しい未達グループ
      if (item.amount >= threshold) {
        completed.push({ total: item.amount, items: [item] });
      } else {
        open.push({ total: item.amount, items: [item] });
      }
      continue;
    }

    const g = open[targetIdx];
    g.items.push(item);
    g.total += item.amount;

    if (g.total >= threshold) {
      // 未達 → 完成へ移動
      completed.push(g);
      open.splice(targetIdx, 1);
    }
  }

  // 未達グループは全部バラして pool に（再構成しやすいように）
  const pool: BundleItem[] = open.flatMap((g) => g.items);
  return { completed, pool };
}

function performLocalImprovements(
  completed: WorkingGroup[],
  pool: BundleItem[],
  threshold: number,
  itemCount: number,
  options: OptimizeOptions
) {
  const cap = 3000; // 無限に回さないための安全上限
  const maxImproveIters =
    options.maxImproveIters ?? Math.min(cap, Math.max(1, itemCount * 4));
  const resortEvery = options.resortEvery ?? 6;
  const enableDirectDonate = options.enableDirectDonate ?? true;

  // poolを降順で扱う（寄付で乱れるのでフラグ管理）
  let poolDirty = true;
  let iterSinceSort = 0;

  const ensurePoolSorted = () => {
    if (poolDirty || iterSinceSort >= resortEvery) {
      pool.sort((a, b) => b.amount - a.amount);
      poolDirty = false;
      iterSinceSort = 0;
    }
  };

  for (let iter = 0; iter < maxImproveIters; iter++) {
    if (!pool.length) break;

    ensurePoolSorted();
    iterSinceSort++;

    // poolだけで新しい完成グループを作る
    const made = createGroupFromPool(pool, threshold);
    if (made) {
      completed.push(made);
      poolDirty = true; // poolが減ったのでsort再評価
      continue;
    }

    // 完成グループから「抜いても完成」なアイテムを1つ寄付して pool を増やす
    const donated = donateOneItem(completed, pool, threshold);
    if (donated) {
      poolDirty = true;
      continue;
    }

    // 完成グループと pool の swap で「大きいアイテム」を pool に戻す
    const swapped = swapItemBetweenGroupAndPool(completed, pool, threshold);
    if (swapped) {
      poolDirty = true;
      continue;
    }

    // poolの「あと少し」を、完成グループからの直接寄付で一手完成
    if (enableDirectDonate) {
      ensurePoolSorted();
      const direct = directDonateToComplete(completed, pool, threshold);
      if (direct) {
        poolDirty = true;
        continue;
      }
    }

    // これ以上伸びない
    break;
  }
}

/**
 * poolから「大きいものを核にして、小さいもので穴埋め」して threshold 到達を狙う。
 * 成功したら pool から選ばれたアイテムを除去してグループを返す。
 */
function createGroupFromPool(
  pool: BundleItem[],
  threshold: number
): WorkingGroup | null {
  if (!pool.length) return null;

  // pool は降順想定
  const used = new Set<number>(); // positionで識別（position一意推奨）
  const items: BundleItem[] = [];
  let total = 0;

  let left = 0; // 大きい方
  let right = pool.length - 1; // 小さい方

  // まず大きいのを1つずつ入れて、足りなければ小さいので埋める
  while (total < threshold && left <= right) {
    const core = pool[left++];
    if (used.has(core.position)) continue;
    used.add(core.position);
    items.push(core);
    total += core.amount;

    while (total < threshold && right >= left) {
      const filler = pool[right--];
      if (used.has(filler.position)) continue;
      used.add(filler.position);
      items.push(filler);
      total += filler.amount;
    }
  }

  if (total < threshold) return null;

  // poolから使用分を除去
  const remaining = pool.filter((it) => !used.has(it.position));
  pool.splice(0, pool.length, ...remaining);

  return { total, items };
}

/**
 * 完成グループから「抜いても threshold を割らない」アイテムを1つ抜いて pool に戻す。
 * surplus（余剰）が大きいグループから優先。
 */
function donateOneItem(
  completed: WorkingGroup[],
  pool: BundleItem[],
  threshold: number
): boolean {
  const donors = completed
    .map((g, idx) => ({ idx, g, surplus: g.total - threshold }))
    .filter((d) => d.surplus > 0)
    .sort((a, b) => b.surplus - a.surplus);

  for (const d of donors) {
    // 小さいものから試す（抜きやすい）
    const removable = [...d.g.items]
      .sort((a, b) => a.amount - b.amount)
      .find((it) => d.g.total - it.amount >= threshold);

    if (!removable) continue;

    const at = d.g.items.findIndex((it) => it.position === removable.position);
    if (at < 0) continue;

    d.g.items.splice(at, 1);
    d.g.total -= removable.amount;
    pool.push(removable);
    return true;
  }

  return false;
}

/**
 * pool内の「あと少し足りない」構成を作っておき、その不足分を
 * 完成グループの余剰から1アイテムで埋めて「1手で」新規完成を作る改善。
 *
 * 例: poolで 1800（あと200）まで作れるなら、余剰を持つ完成グループから200以上の抜けるアイテムを探す。
 */
function directDonateToComplete(
  completed: WorkingGroup[],
  pool: BundleItem[],
  threshold: number
): boolean {
  if (!pool.length) return false;

  // まず pool から「threshold未満で最大」に近い構成を軽く作る（完全探索はしない）
  const probe = createNearGroupFromPool(pool, threshold);
  if (!probe) return false;

  const { used, items, total, shortfall } = probe;
  if (shortfall <= 0) return false;

  // 寄付できるアイテムを探す：抜いても完成、かつ amount >= shortfall
  const donors = completed
    .map((g) => ({ g, surplus: g.total - threshold }))
    .filter((d) => d.surplus > 0)
    .sort((a, b) => b.surplus - a.surplus);

  for (const d of donors) {
    // なるべく小さい寄付で埋めたい
    const candidate = [...d.g.items]
      .sort((a, b) => a.amount - b.amount)
      .find(
        (it) => it.amount >= shortfall && d.g.total - it.amount >= threshold
      );

    if (!candidate) continue;

    // donorから外す
    const at = d.g.items.findIndex((it) => it.position === candidate.position);
    if (at < 0) continue;

    d.g.items.splice(at, 1);
    d.g.total -= candidate.amount;

    // poolから near 構成の使用分を除去し、candidate を足して新規完成を作る
    const remaining = pool.filter((it) => !used.has(it.position));
    pool.splice(0, pool.length, ...remaining);

    const newItems = [...items, candidate];
    const newTotal = total + candidate.amount;

    // 念のため
    if (newTotal >= threshold) {
      completed.push({ total: newTotal, items: newItems });
      return true;
    }

    // 失敗したらロールバック（基本ここには来ない）
    pool.push(...items);
    d.g.items.push(candidate);
    d.g.total += candidate.amount;
    return false;
  }

  return false;
}

/**
 * poolから「threshold未満でできるだけ大きい」近似構成を作る。
 * 返す used/items は pool からまだ除去しない（directDonate成功時にまとめて除去する）。
 */
function createNearGroupFromPool(
  pool: BundleItem[],
  threshold: number
): {
  used: Set<number>;
  items: BundleItem[];
  total: number;
  shortfall: number;
} | null {
  // pool は降順想定
  const used = new Set<number>();
  const items: BundleItem[] = [];
  let total = 0;

  let left = 0;
  let right = pool.length - 1;

  // 「大→小」で、超えない範囲でなるべく積む
  while (left <= right) {
    const pick = pool[left++];
    if (used.has(pick.position)) continue;

    if (total + pick.amount < threshold) {
      used.add(pick.position);
      items.push(pick);
      total += pick.amount;
    }

    // 足りない分が小さいものでも埋まりそうなら小を詰める（超えない範囲で）
    while (right >= left) {
      const filler = pool[right];
      if (used.has(filler.position)) {
        right--;
        continue;
      }
      if (total + filler.amount < threshold) {
        used.add(filler.position);
        items.push(filler);
        total += filler.amount;
        right--;
      } else {
        break;
      }
    }

    if (total >= threshold - 1) break; // ほぼ届いてるなら打ち切り
  }

  if (!items.length) return null;

  return { used, items, total, shortfall: threshold - total };
}

function sortGroupsByPosition(groups: WorkingGroup[]): WorkingGroup[] {
  return [...groups]
    .map((g) => ({
      total: g.total,
      items: [...g.items].sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => {
      const minA = a.items.length
        ? a.items[0].position
        : Number.MAX_SAFE_INTEGER;
      const minB = b.items.length
        ? b.items[0].position
        : Number.MAX_SAFE_INTEGER;
      return minA - minB;
    });
}

/** 同一商品を quantity で受けたい場合の補助 */
export function expandByQuantity(
  rows: { amount: number; quantity: number }[],
  startPosition = 1
): BundleItem[] {
  const out: BundleItem[] = [];
  let pos = startPosition;
  for (const r of rows) {
    const amt = Math.floor(r.amount);
    const q = Math.floor(r.quantity);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (!Number.isFinite(q) || q <= 0) continue;
    for (let i = 0; i < q; i++) out.push({ amount: amt, position: pos++ });
  }
  return out;
}

function swapItemBetweenGroupAndPool(
  completed: WorkingGroup[],
  pool: BundleItem[],
  threshold: number
): boolean {
  if (!pool.length || !completed.length) return false;

  // pool は小さいものから使いたい（=グループの超過を減らしたい）
  const poolAsc = [...pool].sort((a, b) => a.amount - b.amount);

  // 超過が大きい完成グループから試す
  const donors = completed
    .map((g, idx) => ({ g, idx, surplus: g.total - threshold }))
    .filter((d) => d.surplus > 0)
    .sort((a, b) => b.surplus - a.surplus);

  for (const d of donors) {
    // グループ内は大きい item から試す（大→小に入れ替えると超過が減る）
    const groupItemsDesc = [...d.g.items].sort((a, b) => b.amount - a.amount);

    for (const gItem of groupItemsDesc) {
      // gItem を外しても、poolItem を入れれば threshold を満たす必要がある
      // newTotal = g.total - gItem + poolItem >= threshold
      // かつ poolItem < gItem（入れ替えの意味がある）
      const need = threshold - (d.g.total - gItem.amount);

      // need を満たす最小の poolItem を探す（超過を最小化）
      const candidate = poolAsc.find(
        (p) => p.amount >= need && p.amount < gItem.amount
      );
      if (!candidate) continue;

      // --- swap 実行 ---
      // pool から candidate を削除
      const poolIdx = pool.findIndex((p) => p.position === candidate.position);
      if (poolIdx < 0) continue;
      pool.splice(poolIdx, 1);

      // group から gItem を削除
      const groupIdx = d.g.items.findIndex(
        (it) => it.position === gItem.position
      );
      if (groupIdx < 0) {
        // ロールバック
        pool.push(candidate);
        continue;
      }
      d.g.items.splice(groupIdx, 1);

      // group に candidate を追加
      d.g.items.push(candidate);
      d.g.total = d.g.total - gItem.amount + candidate.amount;

      // pool に gItem を戻す
      pool.push(gItem);

      return true;
    }
  }

  return false;
}
