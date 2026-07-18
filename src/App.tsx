import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronDown, ChevronRight, Download, Pencil, Plus, RotateCcw, Search, Settings, ShoppingBag, Trash2, X } from "lucide-react";
import { compressImage, deletePhoto, getPhoto, photoErrorMessage, putPhoto } from "./photoStore";
import "./styles.css";

// ---------- 型 ----------

type Category = "服" | "家電" | "ガジェット" | "日用品" | "家具・インテリア" | "趣味" | "美容・身だしなみ" | "その他";
type ThemeStatus = "未購入" | "買った" | "やめた";
type Satisfaction = 1 | 2 | 3 | 4 | 5;
type ActiveView = "search" | "refill" | "bought" | "settings";

// 候補写真は「値札・全体・試着」のラベル付き3スロット（各1枚・どれか1枚以上必須）
type PhotoSlot = "tag" | "overall" | "fitting";
type CandidatePhotos = Record<PhotoSlot, string | null>;

type WishlistCandidate = {
  id: string;
  shop: string;
  price: number | null;
  memo: string;
  photos: CandidatePhotos;
  createdAt: string;
  updatedAt: string;
};

type WishlistTheme = {
  id: string;
  title: string;
  category: Category;
  status: ThemeStatus;
  releaseDate: string;
  reason: string;
  memo: string;
  purchasedDate: string;
  purchasedPrice: number | null;
  purchaseNote: string;
  purchasedCandidateId: string;
  satisfaction: Satisfaction | null;
  candidates: WishlistCandidate[];
  createdAt: string;
  updatedAt: string;
};

// 補充リストはテーマとは別物。買っても「完了」に移さず、一定期間たったら再表示する。
type RefillItem = {
  id: string;
  name: string;
  intervalMonths: number;
  purchases: string[]; // YYYY-MM-DD、新しい順
  resurfacedAt: string | null; // 「今すぐ表示」で手動再表示したローカル日付（YYYY-MM-DD）。購入日と同じ形式で比較する
  createdAt: string;
  updatedAt: string;
};

type WishlistData = { themes: WishlistTheme[]; refillItems: RefillItem[] };

// ---------- 定数・小道具 ----------

const DATA_KEY = "yuki-wishlist-data";
const VIEW_KEY = "yuki-wishlist-active-view";
const PRE_V4_BACKUP_PREFIX = "yuki-wishlist-data-backup-pre-v4-";
const categories: Category[] = ["服", "家電", "ガジェット", "日用品", "家具・インテリア", "趣味", "美容・身だしなみ", "その他"];
const sats: Satisfaction[] = [5, 4, 3, 2, 1];
const satLabels: Record<Satisfaction, string> = { 5: "かなり満足", 4: "よかった", 3: "普通", 2: "微妙", 1: "後悔" };
const DEFAULT_INTERVAL_MONTHS = 3;
const photoSlots: { key: PhotoSlot; label: string }[] = [
  { key: "tag", label: "値札" },
  { key: "overall", label: "全体" },
  { key: "fitting", label: "試着" },
];
const emptyPhotos = (): CandidatePhotos => ({ tag: null, overall: null, fitting: null });
const photoIdList = (photos: CandidatePhotos) => photoSlots.map((s) => photos[s.key]).filter(Boolean) as string[];
const mainPhotoId = (photos: CandidatePhotos) => photos.overall ?? photos.tag ?? photos.fitting;

const now = () => new Date().toISOString();
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const makeId = () => `${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const normalizeThemeStatus = (value: unknown): ThemeStatus => value === "買った" ? "買った" : value === "やめた" ? "やめた" : "未購入";
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T) => (list.includes(v as T) ? (v as T) : fallback);
const fmtPrice = (v: number | null) => (v === null ? "" : `${v.toLocaleString("ja-JP")}円`);
const fmtDate = (v: string) => (v ? v.slice(0, 10) : "");
const fmtJapaneseDate = (v: string) => {
  const [year, month, day] = v.slice(0, 10).split("-").map(Number);
  return year && month && day ? `${year}年${month}月${day}日` : "";
};
const releaseDateLabel = (releaseDate: string) => releaseDate ? `${releaseDate < today() ? "発売済み：" : ""}${fmtJapaneseDate(releaseDate)}${releaseDate < today() ? "" : "発売"}` : "";
const addMonths = (dateStr: string, months: number) => {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const lastPurchase = (item: RefillItem) => item.purchases[0] ?? "";
const nextShowDate = (item: RefillItem) => (lastPurchase(item) ? addMonths(lastPurchase(item), item.intervalMonths) : "");
const isRefillVisible = (item: RefillItem) => {
  const last = lastPurchase(item);
  if (!last) return true;
  // resurfacedAt はローカル日付（YYYY-MM-DD）。UTCのISO文字列と混ぜると深夜帯に日付がずれるため、日付部分だけで比較する
  if (item.resurfacedAt && item.resurfacedAt.slice(0, 10) >= last) return true;
  return today() >= nextShowDate(item);
};

// ---------- 読み込み・旧版変換 ----------

// v4で photoId（1枚）→ photos（3スロット）へ変更。旧データの写真は「全体」スロットへ移す。
const normalizeCandidatePhotos = (item: Record<string, unknown>): CandidatePhotos => {
  const raw = item.photos;
  if (raw && typeof raw === "object") {
    const p = raw as Record<string, unknown>;
    return { tag: str(p.tag) || null, overall: str(p.overall) || null, fitting: str(p.fitting) || null };
  }
  return { tag: null, overall: str(item.photoId) || null, fitting: null };
};

const normalizeCandidate = (value: unknown): WishlistCandidate | null => {
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

const normalizeTheme = (value: unknown): WishlistTheme | null => {
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

const normalizeRefill = (value: unknown): RefillItem | null => {
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
const convertV1 = (rawThemes: unknown[]): WishlistData => {
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
const parseStoredData = (parsed: unknown): WishlistData | null => {
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

const loadData = (): WishlistData => {
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

// ---------- 追加型インポート ----------

type ImportPreview = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  newThemes: WishlistTheme[];
  candidateAdds: { themeId: string; candidates: WishlistCandidate[] }[];
  newRefills: RefillItem[];
  duplicateThemeCount: number;
  duplicateCandidateCount: number;
  duplicateRefillCount: number;
};

const sameTheme = (a: WishlistTheme, b: WishlistTheme) => a.id === b.id || (a.title === b.title && a.createdAt === b.createdAt);
const sameCandidate = (a: WishlistCandidate, b: WishlistCandidate) => a.id === b.id || (a.shop === b.shop && a.price === b.price && a.createdAt === b.createdAt);
const sameRefill = (a: RefillItem, b: RefillItem) => a.id === b.id || (a.name === b.name && a.createdAt === b.createdAt);

const buildImportPreview = (text: string, existing: WishlistData): ImportPreview => {
  const fail = (message: string): ImportPreview => ({ valid: false, errors: [message], warnings: [], newThemes: [], candidateAdds: [], newRefills: [], duplicateThemeCount: 0, duplicateCandidateCount: 0, duplicateRefillCount: 0 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("JSONとして読み込めませんでした");
  }
  const incoming = parseStoredData(parsed);
  if (!incoming) return fail("買いものリストのバックアップ形式ではありません（themes が見つかりません）");
  const warnings: string[] = [];
  let duplicateThemeCount = 0, duplicateCandidateCount = 0, duplicateRefillCount = 0;
  const newThemes: WishlistTheme[] = [];
  const candidateAdds: { themeId: string; candidates: WishlistCandidate[] }[] = [];
  incoming.themes.forEach((theme) => {
    const existingTheme = existing.themes.find((current) => sameTheme(current, theme));
    if (!existingTheme) {
      newThemes.push(theme);
      return;
    }
    duplicateThemeCount += 1;
    const candidates = theme.candidates.filter((candidate) => {
      const dup = existingTheme.candidates.some((current) => sameCandidate(current, candidate));
      if (dup) duplicateCandidateCount += 1;
      return !dup;
    });
    if (candidates.length) candidateAdds.push({ themeId: existingTheme.id, candidates });
  });
  const newRefills = incoming.refillItems.filter((item) => {
    const dup = existing.refillItems.some((current) => sameRefill(current, item));
    if (dup) duplicateRefillCount += 1;
    return !dup;
  });
  const importedWithPhoto = [...newThemes.flatMap((t) => t.candidates), ...candidateAdds.flatMap((g) => g.candidates)].filter((c) => photoIdList(c.photos).length > 0).length;
  if (importedWithPhoto > 0) warnings.push(`写真はバックアップに含まれないため、取り込む候補 ${importedWithPhoto} 件の写真はこの端末では表示されません`);
  return { valid: true, errors: [], warnings, newThemes, candidateAdds, newRefills, duplicateThemeCount, duplicateCandidateCount, duplicateRefillCount };
};

// ---------- Markdownエクスポート ----------

const md = (v: unknown) => String(v ?? "").replaceAll("\r", " ").replaceAll("\n", " ").trim();

const createMarkdown = ({ themes, refillItems }: WishlistData) => {
  const unpurchased = themes.filter((t) => t.status === "未購入");
  const scheduled = unpurchased.filter((t) => t.releaseDate).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  const withCandidates = unpurchased.filter((t) => !t.releaseDate && t.candidates.length > 0);
  const themeOnly = unpurchased.filter((t) => !t.releaseDate && t.candidates.length === 0);
  const bought = themes.filter((t) => t.status === "買った");
  const stopped = themes.filter((t) => t.status === "やめた");
  const visibleRefills = refillItems.filter(isRefillVisible);
  const waitingRefills = refillItems.filter((item) => !isRefillVisible(item));
  const photoLabel = (c: WishlistCandidate) => {
    const labels = photoSlots.filter((s) => c.photos[s.key]).map((s) => s.label);
    return labels.length ? labels.join("・") : "なし";
  };
  const candidateBlock = (c: WishlistCandidate) => `- 店名：${md(c.shop)} ／ 金額：${fmtPrice(c.price)} ／ 写真：${photoLabel(c)} ／ 登録日：${fmtDate(c.createdAt)}${c.memo ? ` ／ メモ：${md(c.memo)}` : ""}`;
  const themeBlock = (t: WishlistTheme) => `### ${md(t.title)}\n\n- カテゴリ：${t.category}${t.releaseDate ? `\n- 発売日：${t.releaseDate}` : ""}\n- 欲しい理由：${md(t.reason)}\n- メモ：${md(t.memo)}\n- 登録日：${fmtDate(t.createdAt)}${t.candidates.length ? `\n\n候補：\n\n${t.candidates.map(candidateBlock).join("\n")}` : ""}`;
  const boughtBlock = (t: WishlistTheme) => {
    const candidate = t.candidates.find((c) => c.id === t.purchasedCandidateId);
    return `### ${md(t.title)}\n\n- カテゴリ：${t.category}${t.releaseDate ? `\n- 発売日：${t.releaseDate}` : ""}\n- 買った候補：${candidate ? md(candidate.shop) : "テーマそのもの"}\n- 購入日：${fmtDate(t.purchasedDate)}\n- 購入価格：${fmtPrice(t.purchasedPrice)}\n- 満足度：${t.satisfaction ? `${t.satisfaction}：${satLabels[t.satisfaction]}` : "未記入"}\n- 一言：${md(t.purchaseNote)}`;
  };
  const refillLine = (item: RefillItem) => `- ${md(item.name)}（前回：${fmtDate(lastPurchase(item)) || "未購入"} ／ 間隔：${item.intervalMonths}ヶ月${isRefillVisible(item) ? "" : ` ／ 次回表示：${nextShowDate(item)}`}）`;
  return `# 買いものリスト エクスポート

## 出力情報

- 出力日時：${now()}
- 未購入テーマ：${unpurchased.length}
- 買ったテーマ：${bought.length}
- やめたテーマ：${stopped.length}
- 補充リスト：${refillItems.length}

## ほしいもの（発売予定）

${scheduled.map(themeBlock).join("\n\n") || "該当なし"}

## ほしいもの（候補あり）

${withCandidates.map(themeBlock).join("\n\n") || "該当なし"}

## ほしいもの（テーマだけ）

${themeOnly.map(themeBlock).join("\n\n") || "該当なし"}

## 買ったテーマ

${bought.map(boughtBlock).join("\n\n") || "該当なし"}

## やめたテーマ

${stopped.map(themeBlock).join("\n\n") || "該当なし"}

## 補充リスト（表示中）

${visibleRefills.map(refillLine).join("\n") || "該当なし"}

## 補充リスト（待機中）

${waitingRefills.map(refillLine).join("\n") || "該当なし"}
`;
};

// ---------- 写真表示 ----------

const photoUrlCache = new Map<string, string>();

// 「写真なし」（IDなし）と「読込失敗」（IDはあるがBlobを取り出せない）を区別して表示する。
// 読込失敗はタップで再試行できる。区別することで、保存不具合が起きたときに気づきやすくする。
function PhotoThumb({ photoId, className, onClick }: { photoId: string | null; className: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string | null>(photoId ? photoUrlCache.get(photoId) ?? null : null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    if (!photoId) {
      setUrl(null);
      return;
    }
    const cached = photoUrlCache.get(photoId);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    let cancelled = false;
    getPhoto(photoId)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setFailed(true);
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        photoUrlCache.set(photoId, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [photoId, attempt]);
  if (!photoId) return <div className={`photo-placeholder ${className}`}>写真なし</div>;
  if (failed) return <div className={`photo-placeholder photo-failed ${className}`} onClick={() => setAttempt((a) => a + 1)} role="button">読込失敗<br />再試行</div>;
  if (!url) return <div className={`photo-placeholder ${className}`}>…</div>;
  return <img src={url} alt="" className={className} onClick={onClick} loading="lazy" />;
}

// ---------- モーダル ----------

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>{title}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label="閉じる"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- 本体 ----------

const emptyThemeDraft = { title: "", category: "その他" as Category, releaseDate: "", reason: "", memo: "" };
const emptyCandidateDraft = { shop: "", price: "", memo: "" };
type SlotDraft = { blob: Blob | null; previewUrl: string | null; removed: boolean };
const emptySlotDrafts = (): Record<PhotoSlot, SlotDraft> => ({
  tag: { blob: null, previewUrl: null, removed: false },
  overall: { blob: null, previewUrl: null, removed: false },
  fitting: { blob: null, previewUrl: null, removed: false },
});
const emptyPurchaseDraft = () => ({ candidateId: "", date: today(), price: "", satisfaction: "", note: "" });

function App() {
  const [{ themes, refillItems }, setData] = useState<WishlistData>(loadData);
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "refill" || v === "bought" || v === "settings" || v === "search" ? v : "search";
  });
  const [quickTheme, setQuickTheme] = useState("");
  const [quickRefill, setQuickRefill] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ "発売予定": true, "候補あり": true, "テーマだけ": true });
  const [searchKeyword, setSearchKeyword] = useState("");
  const [boughtFilters, setBoughtFilters] = useState({ keyword: "", satisfaction: "すべて" });
  const [editingThemeId, setEditingThemeId] = useState("");
  const [themeDraft, setThemeDraft] = useState(emptyThemeDraft);
  const [candidateFormThemeId, setCandidateFormThemeId] = useState("");
  const [editingCandidateId, setEditingCandidateId] = useState("");
  const [candidateDraft, setCandidateDraft] = useState(emptyCandidateDraft);
  const [slotDrafts, setSlotDrafts] = useState<Record<PhotoSlot, SlotDraft>>(emptySlotDrafts());
  const [slotBusyCount, setSlotBusyCount] = useState(0); // 圧縮処理中のスロット数。処理中は保存を押せないようにする
  const [candidateSaving, setCandidateSaving] = useState(false);
  const [purchaseThemeId, setPurchaseThemeId] = useState("");
  const [purchaseDraft, setPurchaseDraft] = useState(emptyPurchaseDraft());
  const [editingRefillId, setEditingRefillId] = useState("");
  const [refillDraft, setRefillDraft] = useState({ name: "", intervalMonths: String(DEFAULT_INTERVAL_MONTHS) });
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [overlayPhoto, setOverlayPhoto] = useState<{ photoId: string; label: string } | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    localStorage.setItem(DATA_KEY, JSON.stringify({ version: 4, themes, refillItems }));
  }, [themes, refillItems]);
  useEffect(() => localStorage.setItem(VIEW_KEY, activeView), [activeView]);

  const updateThemes = (fn: (all: WishlistTheme[]) => WishlistTheme[]) => setData((d) => ({ ...d, themes: fn(d.themes) }));
  const updateRefills = (fn: (all: RefillItem[]) => RefillItem[]) => setData((d) => ({ ...d, refillItems: fn(d.refillItems) }));
  const updateTheme = (id: string, fn: (theme: WishlistTheme) => WishlistTheme) => updateThemes((all) => all.map((t) => (t.id === id ? { ...fn(t), updatedAt: now() } : t)));
  const updateRefill = (id: string, fn: (item: RefillItem) => RefillItem) => updateRefills((all) => all.map((r) => (r.id === id ? { ...fn(r), updatedAt: now() } : r)));

  // ----- クイック追加（名前だけで登録できることを最優先） -----

  const submitQuickTheme = (e: FormEvent) => {
    e.preventDefault();
    const title = quickTheme.trim();
    if (!title) return;
    updateThemes((all) => [{ id: makeId(), title, category: "その他", status: "未購入", releaseDate: "", reason: "", memo: "", purchasedDate: "", purchasedPrice: null, purchaseNote: "", purchasedCandidateId: "", satisfaction: null, candidates: [], createdAt: now(), updatedAt: now() }, ...all]);
    setQuickTheme("");
  };

  const submitQuickRefill = (e: FormEvent) => {
    e.preventDefault();
    const name = quickRefill.trim();
    if (!name) return;
    updateRefills((all) => [{ id: makeId(), name, intervalMonths: DEFAULT_INTERVAL_MONTHS, purchases: [], resurfacedAt: null, createdAt: now(), updatedAt: now() }, ...all]);
    setQuickRefill("");
  };

  // ----- テーマ編集・削除 -----

  const startEditTheme = (theme: WishlistTheme) => {
    setEditingThemeId(theme.id);
    setThemeDraft({ title: theme.title, category: theme.category, releaseDate: theme.releaseDate, reason: theme.reason, memo: theme.memo });
    closeCandidateForm();
    setPurchaseThemeId("");
  };

  const submitThemeEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!themeDraft.title.trim()) return;
    updateTheme(editingThemeId, (t) => ({ ...t, ...themeDraft, title: themeDraft.title.trim() }));
    setEditingThemeId("");
  };

  const stopTheme = (theme: WishlistTheme) => {
    if (!confirm(`「${theme.title}」をやめた記録へ移しますか？`)) return;
    updateTheme(theme.id, (t) => ({ ...t, status: "やめた" }));
    setEditingThemeId("");
  };

  const restoreTheme = (theme: WishlistTheme) => {
    updateTheme(theme.id, (t) => ({ ...t, status: "未購入" }));
    setEditingThemeId("");
  };

  const deleteTheme = (theme: WishlistTheme) => {
    if (!confirm(`「${theme.title}」を削除しますか？候補と写真も一緒に削除されます。`)) return;
    theme.candidates.forEach((c) => {
      photoIdList(c.photos).forEach((photoId) => deletePhoto(photoId).catch(() => {}));
    });
    updateThemes((all) => all.filter((t) => t.id !== theme.id));
    setEditingThemeId("");
    setPurchaseThemeId("");
  };

  // ----- 候補（写真どれか1枚＋店名が必須。金額・メモは任意） -----

  // モーダルを閉じた・開き直した後に、前のフォームで選んだ写真の圧縮完了が遅れて届いても混入しないよう、
  // フォームの世代番号で古い処理結果を捨てる。
  const slotSessionRef = useRef(0);

  const resetSlotDrafts = () => {
    slotSessionRef.current += 1;
    setSlotDrafts((prev) => {
      photoSlots.forEach(({ key }) => {
        if (prev[key].previewUrl) URL.revokeObjectURL(prev[key].previewUrl!);
      });
      return emptySlotDrafts();
    });
  };

  const openCandidateForm = (themeId: string, candidate?: WishlistCandidate) => {
    setCandidateFormThemeId(themeId);
    setEditingCandidateId(candidate?.id ?? "");
    resetSlotDrafts();
    setCandidateDraft(candidate ? { shop: candidate.shop, price: candidate.price === null ? "" : String(candidate.price), memo: candidate.memo } : emptyCandidateDraft);
    setEditingThemeId("");
    setPurchaseThemeId("");
  };

  const closeCandidateForm = () => {
    resetSlotDrafts();
    setCandidateFormThemeId("");
    setEditingCandidateId("");
    setCandidateDraft(emptyCandidateDraft);
  };

  // 選択した瞬間に読み込み・圧縮してメモリ内Blobにする。
  // Androidの選択ファイル（content URI）は時間が経つと読めなくなることがあり、
  // 保存ボタンを押した時点で読むと静かに失敗するため、選択時に読み切ってしまう。
  const selectSlotFile = async (slot: PhotoSlot, file: File | undefined) => {
    if (!file) return;
    const session = slotSessionRef.current;
    setSlotBusyCount((n) => n + 1);
    try {
      const blob = await compressImage(file);
      if (session !== slotSessionRef.current) return; // フォームが閉じられた・開き直された後の遅延結果は捨てる
      setSlotDrafts((prev) => {
        if (prev[slot].previewUrl) URL.revokeObjectURL(prev[slot].previewUrl!);
        return { ...prev, [slot]: { blob, previewUrl: URL.createObjectURL(blob), removed: false } };
      });
    } catch (error) {
      if (session === slotSessionRef.current) alert(`${photoSlots.find((s) => s.key === slot)?.label}の写真を読み込めませんでした。選び直してください。\n${photoErrorMessage(error)}`);
    } finally {
      setSlotBusyCount((n) => n - 1);
    }
  };

  const removeSlot = (slot: PhotoSlot) => {
    setSlotDrafts((prev) => {
      if (prev[slot].previewUrl) URL.revokeObjectURL(prev[slot].previewUrl!);
      return { ...prev, [slot]: { blob: null, previewUrl: null, removed: true } };
    });
  };

  const submitCandidate = async (theme: WishlistTheme, e: FormEvent) => {
    e.preventDefault();
    const shop = candidateDraft.shop.trim();
    if (!shop) return;
    const editing = editingCandidateId ? theme.candidates.find((c) => c.id === editingCandidateId) : undefined;
    // 「既存スロットのID＋新しく選んだ写真」の合計でどれか1枚以上を求める。
    // Blobが壊れていてもIDがあれば有効扱い（壊れた候補も編集・差し替えで修復できるように）。
    const willHavePhoto = photoSlots.some(({ key }) => {
      const draft = slotDrafts[key];
      if (draft.blob) return true;
      if (draft.removed) return false;
      return Boolean(editing?.photos[key]);
    });
    if (!willHavePhoto) {
      alert("写真をどれか1枚選んでください（値札・全体・試着のどの枠でもOKです）");
      return;
    }
    setCandidateSaving(true);
    try {
      const newPhotos = emptyPhotos();
      const obsoletePhotoIds: string[] = [];
      for (const { key } of photoSlots) {
        const draft = slotDrafts[key];
        const existingId = editing?.photos[key] ?? null;
        if (draft.blob) {
          const photoId = makeId();
          await putPhoto(photoId, draft.blob);
          newPhotos[key] = photoId;
          if (existingId) obsoletePhotoIds.push(existingId);
        } else if (draft.removed) {
          if (existingId) obsoletePhotoIds.push(existingId);
        } else {
          newPhotos[key] = existingId;
        }
      }
      const price = candidateDraft.price.trim() === "" ? null : Number(candidateDraft.price);
      const fields = { shop, price: Number.isFinite(price as number) ? price : null, memo: candidateDraft.memo, photos: newPhotos };
      updateTheme(theme.id, (t) => ({
        ...t,
        candidates: editing
          ? t.candidates.map((c) => (c.id === editing.id ? { ...c, ...fields, updatedAt: now() } : c))
          : [...t.candidates, { id: makeId(), ...fields, createdAt: now(), updatedAt: now() }],
      }));
      obsoletePhotoIds.forEach((photoId) => deletePhoto(photoId).catch(() => {}));
      closeCandidateForm();
    } catch (error) {
      alert(`写真の保存に失敗しました。もう一度お試しください。\n${photoErrorMessage(error)}`);
    } finally {
      setCandidateSaving(false);
    }
  };

  const deleteCandidate = (theme: WishlistTheme, candidate: WishlistCandidate) => {
    if (!confirm("この候補を削除しますか？写真も削除されます。")) return;
    photoIdList(candidate.photos).forEach((photoId) => deletePhoto(photoId).catch(() => {}));
    updateTheme(theme.id, (t) => ({ ...t, candidates: t.candidates.filter((c) => c.id !== candidate.id) }));
  };

  // ----- 購入（1ダイアログ・全項目任意。あとから編集も同じフォーム） -----

  const startPurchase = (theme: WishlistTheme) => {
    setPurchaseThemeId(theme.id);
    setPurchaseDraft(theme.status === "買った"
      ? { candidateId: theme.purchasedCandidateId, date: theme.purchasedDate || today(), price: theme.purchasedPrice === null ? "" : String(theme.purchasedPrice), satisfaction: theme.satisfaction ? String(theme.satisfaction) : "", note: theme.purchaseNote }
      : { ...emptyPurchaseDraft(), candidateId: theme.candidates[0]?.id ?? "" });
    setEditingThemeId("");
    closeCandidateForm();
  };

  const submitPurchase = (theme: WishlistTheme, e: FormEvent) => {
    e.preventDefault();
    const price = purchaseDraft.price.trim() === "" ? null : Number(purchaseDraft.price);
    updateTheme(theme.id, (t) => ({
      ...t,
      status: "買った",
      purchasedCandidateId: purchaseDraft.candidateId,
      purchasedDate: purchaseDraft.date,
      purchasedPrice: Number.isFinite(price as number) ? price : null,
      satisfaction: purchaseDraft.satisfaction ? (Number(purchaseDraft.satisfaction) as Satisfaction) : null,
      purchaseNote: purchaseDraft.note,
    }));
    setPurchaseThemeId("");
    if (theme.status !== "買った") setActiveView("bought");
  };

  const cancelPurchaseRecord = (theme: WishlistTheme) => {
    if (!confirm("購入記録を取り消して「ほしいもの」に戻しますか？")) return;
    updateTheme(theme.id, (t) => ({ ...t, status: "未購入", purchasedDate: "", purchasedPrice: null, purchaseNote: "", purchasedCandidateId: "", satisfaction: null }));
    setPurchaseThemeId("");
  };

  // ----- 補充リスト -----

  const buyRefill = (item: RefillItem) => {
    updateRefill(item.id, (r) => ({ ...r, purchases: [today(), ...r.purchases], resurfacedAt: null }));
  };

  const resurfaceRefill = (item: RefillItem) => updateRefill(item.id, (r) => ({ ...r, resurfacedAt: today() }));

  const undoRefillPurchase = (item: RefillItem) => {
    if (!confirm(`「${item.name}」の前回の購入記録（${fmtDate(lastPurchase(item))}）を取り消しますか？`)) return;
    updateRefill(item.id, (r) => ({ ...r, purchases: r.purchases.slice(1) }));
  };

  const startEditRefill = (item: RefillItem) => {
    setEditingRefillId(item.id);
    setRefillDraft({ name: item.name, intervalMonths: String(item.intervalMonths) });
  };

  const submitRefillEdit = (e: FormEvent) => {
    e.preventDefault();
    const name = refillDraft.name.trim();
    if (!name) return;
    const interval = Math.min(24, Math.max(1, Math.round(Number(refillDraft.intervalMonths)) || DEFAULT_INTERVAL_MONTHS));
    updateRefill(editingRefillId, (r) => ({ ...r, name, intervalMonths: interval }));
    setEditingRefillId("");
  };

  const deleteRefill = (item: RefillItem) => {
    if (!confirm(`「${item.name}」を補充リストから削除しますか？購入履歴も消えます。`)) return;
    updateRefills((all) => all.filter((r) => r.id !== item.id));
    setEditingRefillId("");
  };

  // ----- 入出力 -----

  const downloadText = (filename: string, text: string, type: string) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportJson = () => downloadText(`wishlist-backup-${today()}.json`, JSON.stringify({ version: 4, themes, refillItems, exportedAt: now() }, null, 2), "application/json");
  const exportMarkdown = () => downloadText(`wishlist-export-${today()}.md`, createMarkdown({ themes, refillItems }), "text/markdown");
  const readImportFile = async (file?: File) => {
    setImportMessage("");
    setImportPreview(null);
    if (file) setImportPreview(buildImportPreview(await file.text(), { themes, refillItems }));
  };
  const applyImport = () => {
    if (!importPreview?.valid) return;
    const preview = importPreview;
    setData((current) => ({
      themes: [...preview.newThemes, ...current.themes].map((theme) => {
        const add = preview.candidateAdds.find((g) => g.themeId === theme.id);
        return add ? { ...theme, candidates: [...theme.candidates, ...add.candidates], updatedAt: now() } : theme;
      }),
      refillItems: [...preview.newRefills, ...current.refillItems],
    }));
    setImportMessage(`追加したテーマ ${preview.newThemes.length} 件、追加した候補 ${preview.candidateAdds.reduce((n, g) => n + g.candidates.length, 0) + preview.newThemes.reduce((n, t) => n + t.candidates.length, 0)} 件、追加した補充 ${preview.newRefills.length} 件（重複スキップ：テーマ ${preview.duplicateThemeCount}・候補 ${preview.duplicateCandidateCount}・補充 ${preview.duplicateRefillCount}）`);
    setImportPreview(null);
  };

  // ----- 表示用データ -----

  const matchesKeyword = (theme: WishlistTheme, keyword: string) => {
    if (!keyword.trim()) return true;
    const text = [theme.title, theme.reason, theme.memo, ...theme.candidates.flatMap((c) => [c.shop, c.memo])].join(" ").toLowerCase();
    return text.includes(keyword.toLowerCase());
  };
  const searchThemes = themes.filter((t) => t.status !== "買った" && matchesKeyword(t, searchKeyword));
  const activeSearchThemes = searchThemes.filter((t) => t.status === "未購入");
  const scheduledThemes = activeSearchThemes.filter((t) => t.releaseDate).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  const candidateThemes = activeSearchThemes.filter((t) => !t.releaseDate && t.candidates.length > 0);
  const themeOnlyThemes = activeSearchThemes.filter((t) => !t.releaseDate && t.candidates.length === 0);
  const stoppedThemes = searchThemes.filter((t) => t.status === "やめた");
  const boughtThemes = themes
    .filter((t) => t.status === "買った" && matchesKeyword(t, boughtFilters.keyword) && (boughtFilters.satisfaction === "すべて" || String(t.satisfaction ?? "") === boughtFilters.satisfaction))
    .sort((a, b) => (b.purchasedDate || b.updatedAt).localeCompare(a.purchasedDate || a.updatedAt));
  const visibleRefills = refillItems.filter(isRefillVisible);
  const waitingRefills = refillItems.filter((item) => !isRefillVisible(item)).sort((a, b) => nextShowDate(a).localeCompare(nextShowDate(b)));

  const editingTheme = editingThemeId ? themes.find((t) => t.id === editingThemeId) : undefined;
  const candidateFormTheme = candidateFormThemeId ? themes.find((t) => t.id === candidateFormThemeId) : undefined;
  const purchaseTheme = purchaseThemeId ? themes.find((t) => t.id === purchaseThemeId) : undefined;
  const editingRefill = editingRefillId ? refillItems.find((r) => r.id === editingRefillId) : undefined;

  // ----- モーダル内フォーム -----

  const renderThemeEditForm = (theme: WishlistTheme) => (
    <form className="modal-form" onSubmit={submitThemeEdit}>
      <label>テーマ名<input value={themeDraft.title} onChange={(e) => setThemeDraft({ ...themeDraft, title: e.target.value })} required /></label>
      <div className="grid-2">
        <label>カテゴリ<select value={themeDraft.category} onChange={(e) => setThemeDraft({ ...themeDraft, category: e.target.value as Category })}>{categories.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>発売日（任意）<input type="date" value={themeDraft.releaseDate} onChange={(e) => setThemeDraft({ ...themeDraft, releaseDate: e.target.value })} /></label>
      </div>
      <label>欲しい理由<textarea value={themeDraft.reason} onChange={(e) => setThemeDraft({ ...themeDraft, reason: e.target.value })} placeholder="なぜ欲しいのか。あとで冷静に見返す用" /></label>
      <label>メモ<textarea value={themeDraft.memo} onChange={(e) => setThemeDraft({ ...themeDraft, memo: e.target.value })} /></label>
      <div className="actions">
        <button className="primary" type="submit">保存する</button>
        <button type="button" onClick={() => setEditingThemeId("")}>キャンセル</button>
      </div>
      <div className="actions">
        {theme.status === "未購入"
          ? <button type="button" className="danger-link" onClick={() => stopTheme(theme)}>やめたにする</button>
          : theme.status === "やめた" && <button type="button" onClick={() => restoreTheme(theme)}><RotateCcw size={15} />ほしいものに戻す</button>}
        <button type="button" className="danger-link" onClick={() => deleteTheme(theme)}><Trash2 size={15} />削除</button>
      </div>
    </form>
  );

  const renderCandidateForm = (theme: WishlistTheme) => {
    const editing = editingCandidateId ? theme.candidates.find((c) => c.id === editingCandidateId) : undefined;
    return (
      <form className="modal-form" onSubmit={(e) => submitCandidate(theme, e)}>
        <div>
          <span className="field-title">写真（どれか1枚は必須）</span>
          <div className="slot-row">
            {photoSlots.map(({ key, label }) => {
              const draft = slotDrafts[key];
              const existingId = editing && !draft.removed ? editing.photos[key] : null;
              const hasPhoto = Boolean(draft.previewUrl || existingId);
              return (
                <div className="slot" key={key}>
                  <span className="slot-label">{label}</span>
                  <label className="slot-box">
                    <input type="file" accept="image/*" onChange={(e) => { selectSlotFile(key, e.target.files?.[0]); e.currentTarget.value = ""; }} />
                    {draft.previewUrl
                      ? <img src={draft.previewUrl} alt="" className="slot-img" />
                      : existingId
                        ? <PhotoThumb photoId={existingId} className="slot-img" />
                        : <span className="slot-hint"><Camera size={16} />追加</span>}
                  </label>
                  {hasPhoto && <button type="button" className="slot-remove" onClick={() => removeSlot(key)} aria-label={`${label}の写真を外す`}><X size={12} /></button>}
                </div>
              );
            })}
          </div>
        </div>
        <label>店名・サイト名（必須）<input value={candidateDraft.shop} onChange={(e) => setCandidateDraft({ ...candidateDraft, shop: e.target.value })} required placeholder="例：ユニクロ 〇〇店" /></label>
        <div className="grid-2">
          <label>金額（任意）<input type="number" inputMode="numeric" value={candidateDraft.price} onChange={(e) => setCandidateDraft({ ...candidateDraft, price: e.target.value })} /></label>
          <label>メモ（任意）<input value={candidateDraft.memo} onChange={(e) => setCandidateDraft({ ...candidateDraft, memo: e.target.value })} /></label>
        </div>
        <div className="actions">
          <button className="primary" type="submit" disabled={candidateSaving || slotBusyCount > 0}>{candidateSaving ? "保存中…" : slotBusyCount > 0 ? "写真を処理中…" : editing ? "候補を保存" : "候補を追加"}</button>
          <button type="button" onClick={closeCandidateForm}>キャンセル</button>
        </div>
      </form>
    );
  };

  const renderPurchaseForm = (theme: WishlistTheme) => (
    <form className="modal-form" onSubmit={(e) => submitPurchase(theme, e)}>
      {theme.candidates.length > 0 && (
        <label>買った候補<select value={purchaseDraft.candidateId} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, candidateId: e.target.value })}>
          <option value="">テーマそのもの（候補以外）</option>
          {theme.candidates.map((c) => <option key={c.id} value={c.id}>{c.shop}{c.price !== null ? `（${fmtPrice(c.price)}）` : ""}</option>)}
        </select></label>
      )}
      <div className="grid-2">
        <label>購入日<input type="date" value={purchaseDraft.date} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, date: e.target.value })} /></label>
        <label>価格（任意）<input type="number" inputMode="numeric" value={purchaseDraft.price} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, price: e.target.value })} /></label>
      </div>
      <label>満足度（任意・あとからでも）<select value={purchaseDraft.satisfaction} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, satisfaction: e.target.value })}>
        <option value="">未記入</option>
        {sats.map((v) => <option key={v} value={v}>{v}：{satLabels[v]}</option>)}
      </select></label>
      <label>一言（任意）<input value={purchaseDraft.note} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, note: e.target.value })} placeholder="よかった点・後悔など" /></label>
      <div className="actions">
        <button className="primary" type="submit"><CheckCircle2 size={16} />{theme.status === "買った" ? "記録を保存" : "買ったにする"}</button>
        <button type="button" onClick={() => setPurchaseThemeId("")}>キャンセル</button>
        {theme.status === "買った" && <button type="button" className="danger-link" onClick={() => cancelPurchaseRecord(theme)}>購入を取り消す</button>}
      </div>
    </form>
  );

  const renderRefillEditForm = (item: RefillItem) => (
    <form className="modal-form" onSubmit={submitRefillEdit}>
      <label>品名<input value={refillDraft.name} onChange={(e) => setRefillDraft({ ...refillDraft, name: e.target.value })} required /></label>
      <label>再表示までの月数<input type="number" inputMode="numeric" min={1} max={24} value={refillDraft.intervalMonths} onChange={(e) => setRefillDraft({ ...refillDraft, intervalMonths: e.target.value })} /></label>
      <div className="actions">
        <button className="primary" type="submit">保存する</button>
        <button type="button" onClick={() => setEditingRefillId("")}>キャンセル</button>
        <button type="button" className="danger-link" onClick={() => deleteRefill(item)}><Trash2 size={15} />削除</button>
      </div>
    </form>
  );

  // ----- カード表示 -----

  const renderCandidateRow = (theme: WishlistTheme, candidate: WishlistCandidate) => {
    const slotsWithPhoto = photoSlots.filter((s) => candidate.photos[s.key]);
    return (
      <div className="candidate" key={candidate.id}>
        <div className="candidate-main">
          <div className="thumb-strip">
            {slotsWithPhoto.length === 0 && <div className="photo-placeholder thumb">写真なし</div>}
            {slotsWithPhoto.map((s) => (
              <div className="thumb-wrap" key={s.key}>
                <PhotoThumb photoId={candidate.photos[s.key]} className="thumb" onClick={() => setOverlayPhoto({ photoId: candidate.photos[s.key]!, label: s.label })} />
                <span className="thumb-label">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="candidate-body">
            <b>{candidate.shop}</b>
            <p>{[fmtPrice(candidate.price), `登録：${fmtDate(candidate.createdAt)}`].filter(Boolean).join(" ／ ")}</p>
            {candidate.memo && <p className="muted">{candidate.memo}</p>}
          </div>
        </div>
        <div className="candidate-actions">
          <button onClick={() => openCandidateForm(theme.id, candidate)} aria-label="候補を編集"><Pencil size={15} /></button>
          <button onClick={() => deleteCandidate(theme, candidate)} aria-label="候補を削除"><Trash2 size={15} /></button>
        </div>
      </div>
    );
  };

  const renderThemeCard = (theme: WishlistTheme) => (
    <article className="theme-card" key={theme.id}>
      <div className="card-head">
        <div>
          <h3>{theme.title}</h3>
          <p>{[theme.category, releaseDateLabel(theme.releaseDate), `登録：${fmtDate(theme.createdAt)}`].filter(Boolean).join(" ／ ")}</p>
        </div>
      </div>
      {theme.reason && <p className="reason">{theme.reason}</p>}
      {theme.memo && <p className="muted">{theme.memo}</p>}
      {theme.candidates.length > 0 && <div className="candidate-list">{theme.candidates.map((c) => renderCandidateRow(theme, c))}</div>}
      {theme.status === "やめた" ? (
        <div className="actions">
          <button onClick={() => restoreTheme(theme)}><RotateCcw size={16} />ほしいものに戻す</button>
          <button onClick={() => startEditTheme(theme)}><Pencil size={16} />編集</button>
        </div>
      ) : (
        <div className="actions">
          <button onClick={() => openCandidateForm(theme.id)}><Camera size={16} />候補を追加</button>
          <button onClick={() => startPurchase(theme)}><CheckCircle2 size={16} />買った</button>
          <button onClick={() => startEditTheme(theme)}><Pencil size={16} />編集</button>
        </div>
      )}
    </article>
  );

  const renderSearchView = () => (
    <>
      <form className="quick-add" onSubmit={submitQuickTheme}>
        <input value={quickTheme} onChange={(e) => setQuickTheme(e.target.value)} placeholder="欲しいものを名前だけで追加" aria-label="テーマ名" />
        <button className="primary" type="submit" disabled={!quickTheme.trim()}><Plus size={18} /></button>
      </form>
      <div className="search-only">
        <label className="search-box"><Search size={16} /><input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="検索" /></label>
      </div>
      {activeSearchThemes.length === 0 && <p className="empty">ほしいものはまだありません。</p>}
      {([
        ["発売予定", scheduledThemes],
        ["候補あり", candidateThemes],
        ["テーマだけ", themeOnlyThemes],
        ["やめた", stoppedThemes],
      ] as const).filter(([, items]) => items.length > 0).map(([groupName, items]) => {
        const open = openGroups[groupName] ?? false;
        return (
          <section className="group" key={groupName}>
            <button className="group-toggle" onClick={() => setOpenGroups({ ...openGroups, [groupName]: !open })}>
              {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<span>{groupName}</span><b>{items.length}</b>
            </button>
            {open && <div className="card-list">{items.map(renderThemeCard)}</div>}
          </section>
        );
      })}
    </>
  );

  const renderRefillRow = (item: RefillItem) => (
    <div className="refill-row" key={item.id}>
      <div className="refill-body">
        <b>{item.name}</b>
        <p>{lastPurchase(item) ? `前回：${fmtDate(lastPurchase(item))}` : "まだ買っていない"} ／ {item.intervalMonths}ヶ月ごと</p>
      </div>
      <div className="refill-actions">
        <button className="primary" onClick={() => buyRefill(item)}><CheckCircle2 size={16} />買った</button>
        <button onClick={() => startEditRefill(item)} aria-label="編集"><Pencil size={15} /></button>
      </div>
    </div>
  );

  const renderRefillView = () => (
    <>
      <form className="quick-add" onSubmit={submitQuickRefill}>
        <input value={quickRefill} onChange={(e) => setQuickRefill(e.target.value)} placeholder="日用品などを名前だけで追加" aria-label="品名" />
        <button className="primary" type="submit" disabled={!quickRefill.trim()}><Plus size={18} /></button>
      </form>
      <p className="view-note">「買った」を押すと一度消えて、{DEFAULT_INTERVAL_MONTHS}ヶ月後（品目ごとに変更可）にまた表示されます。</p>
      <div className="card-list">
        {visibleRefills.map(renderRefillRow)}
        {visibleRefills.length === 0 && <p className="empty">いま表示中の補充はありません。</p>}
      </div>
      <section className="group">
        <button className="group-toggle" onClick={() => setWaitingOpen(!waitingOpen)}>
          {waitingOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<span>待機中（購入済み）</span><b>{waitingRefills.length}</b>
        </button>
        {waitingOpen && (
          <div className="card-list">
            {waitingRefills.map((item) => (
              <div className="refill-row waiting" key={item.id}>
                <div className="refill-body">
                  <b>{item.name}</b>
                  <p>前回：{fmtDate(lastPurchase(item))} ／ 次回表示：{nextShowDate(item)}</p>
                </div>
                <div className="refill-actions">
                  <button onClick={() => resurfaceRefill(item)}><RotateCcw size={15} />今すぐ表示</button>
                  <button className="danger-link" onClick={() => undoRefillPurchase(item)}>記録を取り消す</button>
                </div>
              </div>
            ))}
            {waitingRefills.length === 0 && <p className="empty">待機中の品目はありません。</p>}
          </div>
        )}
      </section>
    </>
  );

  const renderBoughtCard = (theme: WishlistTheme) => {
    const candidate = theme.candidates.find((c) => c.id === theme.purchasedCandidateId) ?? theme.candidates.find((c) => photoIdList(c.photos).length > 0);
    const photoId = candidate ? mainPhotoId(candidate.photos) : null;
    return (
      <article className="theme-card bought-card" key={theme.id}>
        <div className="bought-row">
          <PhotoThumb photoId={photoId} className="thumb" onClick={() => photoId && setOverlayPhoto({ photoId, label: theme.title })} />
          <div className="bought-body">
            <h3>{theme.title}</h3>
            <p>{[fmtDate(theme.purchasedDate), fmtPrice(theme.purchasedPrice), candidate?.shop].filter(Boolean).join(" ／ ")}</p>
            <p className={theme.satisfaction ? "sat" : "muted"}>{theme.satisfaction ? `満足度 ${theme.satisfaction}：${satLabels[theme.satisfaction]}` : "満足度：未記入（あとから足せます）"}</p>
            {theme.purchaseNote && <p className="muted">{theme.purchaseNote}</p>}
          </div>
        </div>
        <div className="actions">
          <button onClick={() => startPurchase(theme)}><Pencil size={15} />{theme.satisfaction ? "記録を編集" : "満足度を追記"}</button>
          <button onClick={() => deleteTheme(theme)} aria-label="削除"><Trash2 size={15} /></button>
        </div>
      </article>
    );
  };

  const renderBoughtView = () => (
    <>
      <div className="filters">
        <label className="search-box"><Search size={16} /><input value={boughtFilters.keyword} onChange={(e) => setBoughtFilters({ ...boughtFilters, keyword: e.target.value })} placeholder="検索" /></label>
        <select value={boughtFilters.satisfaction} onChange={(e) => setBoughtFilters({ ...boughtFilters, satisfaction: e.target.value })}>
          <option>すべて</option>
          {sats.map((v) => <option key={v} value={v}>{v}：{satLabels[v]}</option>)}
        </select>
      </div>
      <div className="card-list">
        {boughtThemes.map(renderBoughtCard)}
        {boughtThemes.length === 0 && <p className="empty">買ったテーマはまだありません。</p>}
      </div>
    </>
  );

  const renderSettingsView = () => (
    <div className="settings-view">
      <section className="panel">
        <div className="panel-title"><Download size={18} />データ出力</div>
        <div className="actions">
          <button className="primary" onClick={exportJson}>JSONエクスポート</button>
          <button onClick={exportMarkdown}>Markdownエクスポート</button>
        </div>
        <p className="note">JSONは保存・復元用、Markdownは読み返し・AI分析用です。<b>写真はどちらにも含まれません</b>（この端末の中だけに保存されます）。</p>
      </section>
      <section className="panel">
        <div className="panel-title"><Plus size={18} />追加型JSONインポート</div>
        <input type="file" accept="application/json,.json" onChange={(e) => readImportFile(e.target.files?.[0])} />
        {importPreview && (
          <div className="preview">
            <b>インポート前プレビュー</b>
            {importPreview.valid ? (
              <>
                <div className="stats">
                  <span>新規テーマ: {importPreview.newThemes.length}</span>
                  <span>新規候補: {importPreview.candidateAdds.reduce((n, g) => n + g.candidates.length, 0) + importPreview.newThemes.reduce((n, t) => n + t.candidates.length, 0)}</span>
                  <span>新規補充: {importPreview.newRefills.length}</span>
                  <span>重複スキップ: テーマ{importPreview.duplicateThemeCount}・候補{importPreview.duplicateCandidateCount}・補充{importPreview.duplicateRefillCount}</span>
                </div>
                {importPreview.warnings.map((x) => <p className="warning" key={x}>{x}</p>)}
                <button className="primary" onClick={applyImport}>新規データだけ追加する</button>
              </>
            ) : importPreview.errors.map((x) => <p className="error" key={x}>{x}</p>)}
          </div>
        )}
        {importMessage && <p className="success">{importMessage}</p>}
        <p className="note">既存データは消さず、新しいテーマ・候補・補充だけ追加します。v1〜v4のバックアップを読み込めます。</p>
      </section>
      <section className="panel">
        <div className="panel-title"><Settings size={18} />保存場所と注意</div>
        <p>データ保存キー：<code>{DATA_KEY}</code>（写真は <code>yuki-wishlist-photos</code>）</p>
        <ul>
          <li>データと写真はこのブラウザの中に保存されます。PCとスマホで自動同期はされません。</li>
          <li>ブラウザのサイトデータを削除すると、データも写真も消えます。JSONエクスポートで定期的にバックアップしてください。</li>
          <li>写真はバックアップに含まれない「参考用」です。消えて困る写真は端末の写真アプリにも残してください。</li>
          <li>JSONやMarkdownには個人的な内容が含まれるため、GitHubや公開フォルダに置かないでください。</li>
        </ul>
      </section>
    </div>
  );

  const nav = [
    { id: "search" as ActiveView, label: "ほしいもの", icon: ShoppingBag },
    { id: "refill" as ActiveView, label: "補充", icon: RotateCcw },
    { id: "bought" as ActiveView, label: "買った", icon: CheckCircle2 },
    { id: "settings" as ActiveView, label: "設定", icon: Settings },
  ];

  return (
    <div className="app-shell">
      <header>
        <h1>買いものリスト</h1>
        <p>欲しい気持ちを一度置いて、納得して買うためのリスト。</p>
      </header>
      <main>
        {activeView === "search" && renderSearchView()}
        {activeView === "refill" && renderRefillView()}
        {activeView === "bought" && renderBoughtView()}
        {activeView === "settings" && renderSettingsView()}
      </main>
      {editingTheme && <Modal title="テーマを編集" onClose={() => setEditingThemeId("")}>{renderThemeEditForm(editingTheme)}</Modal>}
      {candidateFormTheme && <Modal title={editingCandidateId ? "候補を編集" : `候補を追加：${candidateFormTheme.title}`} onClose={closeCandidateForm}>{renderCandidateForm(candidateFormTheme)}</Modal>}
      {purchaseTheme && <Modal title={purchaseTheme.status === "買った" ? "購入記録を編集" : `買った：${purchaseTheme.title}`} onClose={() => setPurchaseThemeId("")}>{renderPurchaseForm(purchaseTheme)}</Modal>}
      {editingRefill && <Modal title="補充を編集" onClose={() => setEditingRefillId("")}>{renderRefillEditForm(editingRefill)}</Modal>}
      {overlayPhoto && (
        <div className="photo-overlay" onClick={() => setOverlayPhoto(null)}>
          <PhotoThumb photoId={overlayPhoto.photoId} className="photo-full" />
          <span className="overlay-label">{overlayPhoto.label}</span>
          <button className="overlay-close" aria-label="閉じる"><X size={22} /></button>
        </div>
      )}
      <nav className="bottom-nav">
        {nav.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeView === id ? "active" : ""} onClick={() => { setActiveView(id); setEditingThemeId(""); closeCandidateForm(); setPurchaseThemeId(""); setEditingRefillId(""); }}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
