// gift-bundle-optimizer.ts
// Greedy (best-fit) + light local improvements.
// - 3点以上OK
// - 同一商品（同額）を複数個扱うのは「別BundleItemとして渡す」ことで対応
//   例: 500円を4つ -> [{amount:500,pos:1},{amount:500,pos:2},{amount:500,pos:3},{amount:500,pos:4}]

export const MAX_ITEMS = 100;

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

export type OptimizeOptions = {
  /** 局所改善の最大反復回数（未指定なら items.length * 4 を上限にしつつ cap もかける） */
  maxImproveIters?: number;
  /** poolのソートを何回に1回やり直すか（寄付で乱れたときの再ソート頻度） */
  resortEvery?: number;
  /** trueなら完成グループの余剰から「直接」未達を完成させる改善も試す */
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
 * 3点以上の組み合わせOK / 同一商品複数OK（BundleItemを個数分渡す）
 * ブラウザで動かす前提のため「厳密解」ではなく、強めの貪欲＋局所改善。
 */
export function optimizeGiftBundles(
  items: BundleItem[],
  threshold: number,
  options: OptimizeOptions = {}
): BundleOptimizationResult {
  const sanitized = sanitizeItems(items);

  const totalAmount = sanitized.reduce((s, it) => s + it.amount, 0);

  if (!sanitized.length || threshold <= 0) {
    return {
      groups: [],
      leftover: sanitized,
      totalGifts: 0,
      threshold,
      totalAmount,
      coveredAmount: 0,
    };
  }

  // 1) 初期解：Largest-first + Best-Fit（未達箱のみを対象にする）
  const { completed, pool } = buildInitialSolution(sanitized, threshold);

  // 2) 局所改善：poolから追加グループ生成 / 完成グループから寄付して再挑戦 / 直接寄付で1手完成
  performLocalImprovements(
    completed,
    pool,
    threshold,
    sanitized.length,
    options
  );

  // 3) 出力整形（position順で見やすく）
  const normalizedGroups = sortGroupsByPosition(completed);

  const usedPositions = new Set<number>();
  for (const g of normalizedGroups) {
    for (const it of g.items) usedPositions.add(it.position);
  }

  const leftover = sanitized.filter((it) => !usedPositions.has(it.position));
  const coveredAmount = normalizedGroups.reduce((s, g) => s + g.total, 0);

  return {
    groups: normalizedGroups,
    leftover,
    totalGifts: normalizedGroups.length,
    threshold,
    totalAmount,
    coveredAmount,
  };
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
