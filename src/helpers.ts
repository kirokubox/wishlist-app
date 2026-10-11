import type { CandidatePhotos, Category, PhotoSlot, RefillItem, Satisfaction, ThemeStatus } from "./types";

// ---------- 定数・小道具 ----------

export const DATA_KEY = "yuki-wishlist-data";
export const VIEW_KEY = "yuki-wishlist-active-view";
// 初回だけ見せる説明を閉じたかどうか（画面の表示状態だけ。記録データとは別）
export const HINTS_DISMISSED_KEY = "yuki-wishlist-hints-dismissed";
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
// 画面に出す日付。`2026-10-12` の形は画面に出さない（書き出しファイルは従来どおり fmtDate を使う）
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const dateParts = (v: string) => {
  // 時刻つきの値（登録日時など）は世界標準時で保存されているので、端末の日付へ直してから使う。
  // そのまま先頭10文字を切ると、日本時間の0〜9時は前の日として表示されてしまう
  const stamp = v.includes("T") ? new Date(v) : null;
  const [year, month, day] = stamp && !Number.isNaN(stamp.getTime())
    ? [stamp.getFullYear(), stamp.getMonth() + 1, stamp.getDate()]
    : v.slice(0, 10).split("-").map(Number);
  return year && month && day ? { year, month, day, weekday: WEEKDAYS[new Date(year, month - 1, day).getDay()] } : null;
};
// 10月12日（月）。今年以外は年を付ける
export const dateLabel = (v: string) => {
  const p = dateParts(v);
  if (!p) return "";
  const base = `${p.month}月${p.day}日（${p.weekday}）`;
  return p.year === new Date().getFullYear() ? base : `${p.year}年${base}`;
};
// 狭い場所用の 10/12(月)。今年以外は年を付ける
export const dateShort = (v: string) => {
  const p = dateParts(v);
  if (!p) return "";
  const base = `${p.month}/${p.day}(${p.weekday})`;
  return p.year === new Date().getFullYear() ? base : `${p.year}/${base}`;
};
export const releaseDateLabel = (releaseDate: string) => releaseDate ? (releaseDate < today() ? `発売済み ${dateLabel(releaseDate)}` : `${dateLabel(releaseDate)}発売`) : "";
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
