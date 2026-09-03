import { DATA_KEY, DEFAULT_INTERVAL_MONTHS, PRE_V4_BACKUP_PREFIX, categories, emptyPhotos, makeId, normalizeThemeStatus, now, numOrNull, oneOf, sats, str, today } from "./helpers";
import type { CandidatePhotos, RefillItem, Satisfaction, WishlistCandidate, WishlistData, WishlistTheme } from "./types";

// ---------- 読み込み・旧版変換 ----------

// v4で photoId（1枚）→ photos（3スロット）へ変更。旧データの写真は「全体」スロットへ移す。
export const normalizeCandidatePhotos = (item: Record<string, unknown>): CandidatePhotos => {
  const raw = item.photos;
  if (raw && typeof raw === "object") {
    const p = raw as Record<string, unknown>;
    return { tag: str(p.tag) || null, overall: str(p.overall) || null, fitting: str(p.fitting) || null };
  }
  return { tag: null, overall: str(item.photoId) || null, fitting: null };
};

export const normalizeCandidate = (value: unknown): WishlistCandidate | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return {
    id: str(item.id) || makeId(),
    shop: str(item.shop),
    price: numOrNull(item.price),
    memo: str(item.memo),
    photos: normalizeCandidatePhotos(item),
    createdAt: str(item.createdAt) || now(),
    updatedAt: str(item.updatedAt) || now(),
  };
};

export const normalizeTheme = (value: unknown): WishlistTheme | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!str(item.id) || !str(item.title)) return null;
  const rawSat = typeof item.satisfaction === "number" && sats.includes(item.satisfaction as Satisfaction) ? (item.satisfaction as Satisfaction) : null;
  return {
    id: str(item.id),
    title: str(item.title),
    category: oneOf(item.category, categories, "その他"),
    status: normalizeThemeStatus(item.status),
    releaseDate: str(item.releaseDate),
    reason: str(item.reason),
    memo: str(item.memo),
    purchasedDate: str(item.purchasedDate),
    purchasedPrice: numOrNull(item.purchasedPrice),
    purchaseNote: str(item.purchaseNote),
    purchasedCandidateId: str(item.purchasedCandidateId),
    satisfaction: rawSat,
    candidates: (Array.isArray(item.candidates) ? item.candidates : []).map(normalizeCandidate).filter(Boolean) as WishlistCandidate[],
    createdAt: str(item.createdAt) || now(),
    updatedAt: str(item.updatedAt) || now(),
  };
};

export const normalizeRefill = (value: unknown): RefillItem | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!str(item.id) || !str(item.name)) return null;
  const interval = typeof item.intervalMonths === "number" && Number.isFinite(item.intervalMonths) ? Math.min(24, Math.max(1, Math.round(item.intervalMonths))) : DEFAULT_INTERVAL_MONTHS;
  return {
    id: str(item.id),
    name: str(item.name),
    intervalMonths: interval,
    purchases: (Array.isArray(item.purchases) ? item.purchases : []).map(str).filter(Boolean),
    resurfacedAt: str(item.resurfacedAt) || null,
    createdAt: str(item.createdAt) || now(),
    updatedAt: str(item.updatedAt) || now(),
  };
};

// 初期版（v1）のテーマ構造からの変換。
// 「補充する」テーマ→補充リスト、それ以外→軽量化した新テーマ。削除した項目は引き継がない。
export const convertV1 = (rawThemes: unknown[]): WishlistData => {
  const themes: WishlistTheme[] = [];
  const refillItems: RefillItem[] = [];
  rawThemes.forEach((value) => {
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (!str(item.id) || !str(item.title)) return;
    if (item.shoppingType === "補充する") {
      refillItems.push({
        id: str(item.id),
        name: str(item.title),
        intervalMonths: DEFAULT_INTERVAL_MONTHS,
        purchases: str(item.purchasedDate) ? [str(item.purchasedDate).slice(0, 10)] : [],
        resurfacedAt: null,
        createdAt: str(item.createdAt) || now(),
        updatedAt: str(item.updatedAt) || now(),
      });
      return;
    }
    const status = normalizeThemeStatus(item.status);
    const purchaseNote = [str(item.goodAfterPurchase), str(item.regretMemo)].filter(Boolean).join(" / ");
    const rawSat = typeof item.satisfaction === "number" && sats.includes(item.satisfaction as Satisfaction) ? (item.satisfaction as Satisfaction) : null;
    const candidates = (Array.isArray(item.candidates) ? item.candidates : []).map((c) => {
      if (!c || typeof c !== "object") return null;
      const cand = c as Record<string, unknown>;
      const shop = [str(cand.name), str(cand.shop)].filter(Boolean).join("・");
      return {
        id: str(cand.id) || makeId(),
        shop,
        price: numOrNull(cand.price),
        memo: str(cand.memo),
        photos: emptyPhotos(),
        createdAt: str(cand.createdAt) || now(),
        updatedAt: str(cand.updatedAt) || now(),
      } satisfies WishlistCandidate;
    }).filter(Boolean) as WishlistCandidate[];
    themes.push({
      id: str(item.id),
      title: str(item.title),
      category: oneOf(item.category, categories, "その他"),
      status,
      releaseDate: str(item.releaseDate),
      reason: str(item.reason),
      memo: str(item.memo),
      purchasedDate: str(item.purchasedDate),
      purchasedPrice: numOrNull(item.purchasedPrice),
      purchaseNote,
      purchasedCandidateId: str(item.purchasedCandidateId),
      satisfaction: rawSat,
      candidates,
      createdAt: str(item.createdAt) || now(),
      updatedAt: str(item.updatedAt) || now(),
    });
  });
  return { themes, refillItems };
};

// localStorage・バックアップJSONの両方をここで受ける（v1配列 / v1バックアップ / v2〜v4）
export const parseStoredData = (parsed: unknown): WishlistData | null => {
  if (Array.isArray(parsed)) return convertV1(parsed);
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.themes)) return null;
  if (root.version === 2 || root.version === 3 || root.version === 4 || Array.isArray(root.refillItems)) {
    return {
      themes: (root.themes as unknown[]).map(normalizeTheme).filter(Boolean) as WishlistTheme[],
      refillItems: (Array.isArray(root.refillItems) ? root.refillItems : []).map(normalizeRefill).filter(Boolean) as RefillItem[],
    };
  }
  return convertV1(root.themes as unknown[]);
};

export const loadData = (): WishlistData => {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return { themes: [], refillItems: [] };
    const parsed = JSON.parse(raw);
    const isVersion4 = !Array.isArray(parsed) && parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).version === 4;
    if (!isVersion4) {
      // 旧形式を変換して上書きする前に、生の文字列を一度だけ退避しておく（v3移行時と同じ保全）
      const backupKey = `${PRE_V4_BACKUP_PREFIX}${today().replaceAll("-", "")}`;
      if (!localStorage.getItem(backupKey)) {
        try {
          localStorage.setItem(backupKey, raw);
        } catch {
          // 容量不足などで退避できなくても、既存データの読み込みは続ける。
        }
      }
    }
    return parseStoredData(parsed) ?? { themes: [], refillItems: [] };
  } catch {
    return { themes: [], refillItems: [] };
  }
};
