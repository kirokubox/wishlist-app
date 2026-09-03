import type { CandidatePhotos, Category, PhotoSlot, RefillItem, Satisfaction, ThemeStatus } from "./types";

// ---------- 定数・小道具 ----------

export const DATA_KEY = "yuki-wishlist-data";
export const VIEW_KEY = "yuki-wishlist-active-view";
export const PRE_V4_BACKUP_PREFIX = "yuki-wishlist-data-backup-pre-v4-";
export const categories: Category[] = ["服", "家電", "ガジェット", "日用品", "家具・インテリア", "趣味", "美容・身だしなみ", "その他"];
export const sats: Satisfaction[] = [5, 4, 3, 2, 1];
export const satLabels: Record<Satisfaction, string> = { 5: "かなり満足", 4: "よかった", 3: "普通", 2: "微妙", 1: "後悔" };
export const DEFAULT_INTERVAL_MONTHS = 3;
export const photoSlots: { key: PhotoSlot; label: string }[] = [
  { key: "tag", label: "値札" },
  { key: "overall", label: "全体" },
  { key: "fitting", label: "試着" },
];
export const emptyPhotos = (): CandidatePhotos => ({ tag: null, overall: null, fitting: null });
export const photoIdList = (photos: CandidatePhotos) => photoSlots.map((s) => photos[s.key]).filter(Boolean) as string[];
export const mainPhotoId = (photos: CandidatePhotos) => photos.overall ?? photos.tag ?? photos.fitting;

export const now = () => new Date().toISOString();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const makeId = () => `${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const normalizeThemeStatus = (value: unknown): ThemeStatus => value === "買った" ? "買った" : value === "やめた" ? "やめた" : "未購入";
export const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T) => (list.includes(v as T) ? (v as T) : fallback);
export const fmtPrice = (v: number | null) => (v === null ? "" : `${v.toLocaleString("ja-JP")}円`);
export const fmtDate = (v: string) => (v ? v.slice(0, 10) : "");
export const fmtJapaneseDate = (v: string) => {
  const [year, month, day] = v.slice(0, 10).split("-").map(Number);
  return year && month && day ? `${year}年${month}月${day}日` : "";
};
export const releaseDateLabel = (releaseDate: string) => releaseDate ? `${releaseDate < today() ? "発売済み：" : ""}${fmtJapaneseDate(releaseDate)}${releaseDate < today() ? "" : "発売"}` : "";
export const addMonths = (dateStr: string, months: number) => {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const lastPurchase = (item: RefillItem) => item.purchases[0] ?? "";
export const nextShowDate = (item: RefillItem) => (lastPurchase(item) ? addMonths(lastPurchase(item), item.intervalMonths) : "");
export const isRefillVisible = (item: RefillItem) => {
  const last = lastPurchase(item);
  if (!last) return true;
  // resurfacedAt はローカル日付（YYYY-MM-DD）。UTCのISO文字列と混ぜると深夜帯に日付がずれるため、日付部分だけで比較する
  if (item.resurfacedAt && item.resurfacedAt.slice(0, 10) >= last) return true;
  return today() >= nextShowDate(item);
};
