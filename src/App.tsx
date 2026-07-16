import { FormEvent, useEffect, useState } from "react";
import { Camera, CheckCircle2, ChevronDown, ChevronRight, Download, Pencil, Plus, RotateCcw, Search, Settings, ShoppingBag, Trash2, X } from "lucide-react";
import { compressImage, deletePhoto, getPhoto, putPhoto } from "./photoStore";
import "./styles.css";

// ---------- 型 ----------

type Category = "服" | "家電" | "ガジェット" | "日用品" | "家具・インテリア" | "趣味" | "美容・身だしなみ" | "その他";
type ThemeStatus = "気になる" | "探し中" | "比較中" | "買う予定" | "保留" | "買った" | "やめた";
type Satisfaction = 1 | 2 | 3 | 4 | 5;
type ActiveView = "search" | "refill" | "bought" | "settings";

type WishlistCandidate = {
  id: string;
  shop: string;
  price: number | null;
  memo: string;
  photoId: string | null;
  createdAt: string;
  updatedAt: string;
};

type WishlistTheme = {
  id: string;
  title: string;
  category: Category;
  status: ThemeStatus;
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
const categories: Category[] = ["服", "家電", "ガジェット", "日用品", "家具・インテリア", "趣味", "美容・身だしなみ", "その他"];
const statuses: ThemeStatus[] = ["気になる", "探し中", "比較中", "買う予定", "保留", "買った", "やめた"];
const searchGroups: ThemeStatus[] = ["買う予定", "比較中", "探し中", "気になる", "保留", "やめた"];
const sats: Satisfaction[] = [5, 4, 3, 2, 1];
const satLabels: Record<Satisfaction, string> = { 5: "かなり満足", 4: "よかった", 3: "普通", 2: "微妙", 1: "後悔" };
const DEFAULT_INTERVAL_MONTHS = 3;

const now = () => new Date().toISOString();
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const makeId = () => `${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T) => (list.includes(v as T) ? (v as T) : fallback);
const fmtPrice = (v: number | null) => (v === null ? "" : `${v.toLocaleString("ja-JP")}円`);
const fmtDate = (v: string) => (v ? v.slice(0, 10) : "");
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

// ---------- 読み込み・v1変換 ----------

const normalizeCandidate = (value: unknown): WishlistCandidate | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return {
    id: str(item.id) || makeId(),
    shop: str(item.shop),
    price: numOrNull(item.price),
    memo: str(item.memo),
    photoId: str(item.photoId) || null,
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
    status: oneOf(item.status, statuses, "探し中"),
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
    const oldStatus = str(item.status);
    const status = oneOf(oldStatus === "そろそろ買う" || oldStatus === "次回買う" ? "探し中" : oldStatus, statuses, "探し中");
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
        photoId: null,
        createdAt: str(cand.createdAt) || now(),
        updatedAt: str(cand.updatedAt) || now(),
      } satisfies WishlistCandidate;
    }).filter(Boolean) as WishlistCandidate[];
    themes.push({
      id: str(item.id),
      title: str(item.title),
      category: oneOf(item.category, categories, "その他"),
      status,
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

// localStorage・バックアップJSONの両方をここで受ける（v1配列 / v1バックアップ / v2）
const parseStoredData = (parsed: unknown): WishlistData | null => {
  if (Array.isArray(parsed)) return convertV1(parsed);
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.themes)) return null;
  if (root.version === 2 || Array.isArray(root.refillItems)) {
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
    return parseStoredData(JSON.parse(raw)) ?? { themes: [], refillItems: [] };
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
  const importedWithPhoto = [...newThemes.flatMap((t) => t.candidates), ...candidateAdds.flatMap((g) => g.candidates)].filter((c) => c.photoId).length;
  if (importedWithPhoto > 0) warnings.push(`写真はバックアップに含まれないため、取り込む候補 ${importedWithPhoto} 件の写真はこの端末では表示されません`);
  return { valid: true, errors: [], warnings, newThemes, candidateAdds, newRefills, duplicateThemeCount, duplicateCandidateCount, duplicateRefillCount };
};

// ---------- Markdownエクスポート ----------

const md = (v: unknown) => String(v ?? "").replaceAll("\r", " ").replaceAll("\n", " ").trim();

const createMarkdown = ({ themes, refillItems }: WishlistData) => {
  const searching = themes.filter((t) => t.status !== "買った" && t.status !== "やめた");
  const bought = themes.filter((t) => t.status === "買った");
  const stopped = themes.filter((t) => t.status === "やめた");
  const visibleRefills = refillItems.filter(isRefillVisible);
  const waitingRefills = refillItems.filter((item) => !isRefillVisible(item));
  const candidateBlock = (c: WishlistCandidate) => `- 店名：${md(c.shop)} ／ 金額：${fmtPrice(c.price)} ／ 写真：${c.photoId ? "あり" : "なし"} ／ 登録日：${fmtDate(c.createdAt)}${c.memo ? ` ／ メモ：${md(c.memo)}` : ""}`;
  const themeBlock = (t: WishlistTheme) => `### ${md(t.title)}\n\n- 状態：${t.status}\n- カテゴリ：${t.category}\n- 欲しい理由：${md(t.reason)}\n- メモ：${md(t.memo)}\n- 登録日：${fmtDate(t.createdAt)}${t.candidates.length ? `\n\n候補：\n\n${t.candidates.map(candidateBlock).join("\n")}` : ""}`;
  const boughtBlock = (t: WishlistTheme) => {
    const candidate = t.candidates.find((c) => c.id === t.purchasedCandidateId);
    return `### ${md(t.title)}\n\n- カテゴリ：${t.category}\n- 買った候補：${candidate ? md(candidate.shop) : "テーマそのもの"}\n- 購入日：${fmtDate(t.purchasedDate)}\n- 購入価格：${fmtPrice(t.purchasedPrice)}\n- 満足度：${t.satisfaction ? `${t.satisfaction}：${satLabels[t.satisfaction]}` : "未記入"}\n- 一言：${md(t.purchaseNote)}`;
  };
  const refillLine = (item: RefillItem) => `- ${md(item.name)}（前回：${fmtDate(lastPurchase(item)) || "未購入"} ／ 間隔：${item.intervalMonths}ヶ月${isRefillVisible(item) ? "" : ` ／ 次回表示：${nextShowDate(item)}`}）`;
  return `# 買いものリスト エクスポート

## 出力情報

- 出力日時：${now()}
- 探し中テーマ：${searching.length}
- 買ったテーマ：${bought.length}
- やめたテーマ：${stopped.length}
- 補充リスト：${refillItems.length}

## 探し中のテーマ

${searching.map(themeBlock).join("\n\n") || "該当なし"}

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

function PhotoThumb({ photoId, className, onClick }: { photoId: string | null; className: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string | null>(photoId ? photoUrlCache.get(photoId) ?? null : null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false);
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
          setMissing(true);
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        photoUrlCache.set(photoId, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [photoId]);
  if (!photoId || missing) return <div className={`photo-placeholder ${className}`}>写真なし</div>;
  if (!url) return <div className={`photo-placeholder ${className}`}>…</div>;
  return <img src={url} alt="" className={className} onClick={onClick} loading="lazy" />;
}

// ---------- 本体 ----------

const emptyThemeDraft = { title: "", status: "探し中" as ThemeStatus, category: "その他" as Category, reason: "", memo: "" };
const emptyCandidateDraft = { shop: "", price: "", memo: "", file: null as File | null, previewUrl: null as string | null };
const emptyPurchaseDraft = () => ({ candidateId: "", date: today(), price: "", satisfaction: "", note: "" });

function App() {
  const [{ themes, refillItems }, setData] = useState<WishlistData>(loadData);
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "refill" || v === "bought" || v === "settings" || v === "search" ? v : "search";
  });
  const [quickTheme, setQuickTheme] = useState("");
  const [quickRefill, setQuickRefill] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ "買う予定": true, "比較中": true, "探し中": true });
  const [searchFilters, setSearchFilters] = useState({ keyword: "", status: "すべて" });
  const [boughtFilters, setBoughtFilters] = useState({ keyword: "", satisfaction: "すべて" });
  const [editingThemeId, setEditingThemeId] = useState("");
  const [themeDraft, setThemeDraft] = useState(emptyThemeDraft);
  const [candidateFormThemeId, setCandidateFormThemeId] = useState("");
  const [editingCandidateId, setEditingCandidateId] = useState("");
  const [candidateDraft, setCandidateDraft] = useState(emptyCandidateDraft);
  const [candidateSaving, setCandidateSaving] = useState(false);
  const [purchaseThemeId, setPurchaseThemeId] = useState("");
  const [purchaseDraft, setPurchaseDraft] = useState(emptyPurchaseDraft());
  const [editingRefillId, setEditingRefillId] = useState("");
  const [refillDraft, setRefillDraft] = useState({ name: "", intervalMonths: String(DEFAULT_INTERVAL_MONTHS) });
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [overlayPhotoId, setOverlayPhotoId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    localStorage.setItem(DATA_KEY, JSON.stringify({ version: 2, themes, refillItems }));
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
    updateThemes((all) => [{ id: makeId(), title, category: "その他", status: "探し中", reason: "", memo: "", purchasedDate: "", purchasedPrice: null, purchaseNote: "", purchasedCandidateId: "", satisfaction: null, candidates: [], createdAt: now(), updatedAt: now() }, ...all]);
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
    setThemeDraft({ title: theme.title, status: theme.status, category: theme.category, reason: theme.reason, memo: theme.memo });
    setCandidateFormThemeId("");
    setPurchaseThemeId("");
  };

  const submitThemeEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!themeDraft.title.trim()) return;
    updateTheme(editingThemeId, (t) => ({ ...t, ...themeDraft, title: themeDraft.title.trim() }));
    setEditingThemeId("");
  };

  const deleteTheme = (theme: WishlistTheme) => {
    if (!confirm(`「${theme.title}」を削除しますか？候補と写真も一緒に削除されます。`)) return;
    theme.candidates.forEach((c) => {
      if (c.photoId) deletePhoto(c.photoId).catch(() => {});
    });
    updateThemes((all) => all.filter((t) => t.id !== theme.id));
  };

  // ----- 候補（写真＋店名が必須。金額・メモは任意） -----

  const openCandidateForm = (themeId: string, candidate?: WishlistCandidate) => {
    setCandidateFormThemeId(themeId);
    setEditingCandidateId(candidate?.id ?? "");
    if (candidateDraft.previewUrl) URL.revokeObjectURL(candidateDraft.previewUrl);
    setCandidateDraft(candidate ? { shop: candidate.shop, price: candidate.price === null ? "" : String(candidate.price), memo: candidate.memo, file: null, previewUrl: null } : emptyCandidateDraft);
    setEditingThemeId("");
    setPurchaseThemeId("");
  };

  const closeCandidateForm = () => {
    if (candidateDraft.previewUrl) URL.revokeObjectURL(candidateDraft.previewUrl);
    setCandidateFormThemeId("");
    setEditingCandidateId("");
    setCandidateDraft(emptyCandidateDraft);
  };

  const selectCandidateFile = (file: File | undefined) => {
    if (!file) return;
    if (candidateDraft.previewUrl) URL.revokeObjectURL(candidateDraft.previewUrl);
    setCandidateDraft((d) => ({ ...d, file, previewUrl: URL.createObjectURL(file) }));
  };

  const submitCandidate = async (theme: WishlistTheme, e: FormEvent) => {
    e.preventDefault();
    const shop = candidateDraft.shop.trim();
    if (!shop) return;
    const editing = editingCandidateId ? theme.candidates.find((c) => c.id === editingCandidateId) : undefined;
    if (!editing && !candidateDraft.file) {
      alert("写真を選んでください（候補は写真が必須です）");
      return;
    }
    setCandidateSaving(true);
    try {
      let photoId = editing?.photoId ?? null;
      if (candidateDraft.file) {
        const blob = await compressImage(candidateDraft.file);
        const newPhotoId = makeId();
        await putPhoto(newPhotoId, blob);
        if (photoId) deletePhoto(photoId).catch(() => {});
        photoId = newPhotoId;
      }
      const price = candidateDraft.price.trim() === "" ? null : Number(candidateDraft.price);
      const fields = { shop, price: Number.isFinite(price as number) ? price : null, memo: candidateDraft.memo, photoId };
      updateTheme(theme.id, (t) => ({
        ...t,
        candidates: editing
          ? t.candidates.map((c) => (c.id === editing.id ? { ...c, ...fields, updatedAt: now() } : c))
          : [...t.candidates, { id: makeId(), ...fields, createdAt: now(), updatedAt: now() }],
      }));
      closeCandidateForm();
    } catch {
      alert("写真の保存に失敗しました。もう一度お試しください。");
    } finally {
      setCandidateSaving(false);
    }
  };

  const deleteCandidate = (theme: WishlistTheme, candidate: WishlistCandidate) => {
    if (!confirm("この候補を削除しますか？写真も削除されます。")) return;
    if (candidate.photoId) deletePhoto(candidate.photoId).catch(() => {});
    updateTheme(theme.id, (t) => ({ ...t, candidates: t.candidates.filter((c) => c.id !== candidate.id) }));
  };

  // ----- 購入（1ダイアログ・全項目任意。あとから編集も同じフォーム） -----

  const startPurchase = (theme: WishlistTheme) => {
    setPurchaseThemeId(theme.id);
    setPurchaseDraft(theme.status === "買った"
      ? { candidateId: theme.purchasedCandidateId, date: theme.purchasedDate || today(), price: theme.purchasedPrice === null ? "" : String(theme.purchasedPrice), satisfaction: theme.satisfaction ? String(theme.satisfaction) : "", note: theme.purchaseNote }
      : { ...emptyPurchaseDraft(), candidateId: theme.candidates[0]?.id ?? "" });
    setEditingThemeId("");
    setCandidateFormThemeId("");
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
    if (!confirm("購入記録を取り消して「探し中」に戻しますか？")) return;
    updateTheme(theme.id, (t) => ({ ...t, status: "探し中", purchasedDate: "", purchasedPrice: null, purchaseNote: "", purchasedCandidateId: "", satisfaction: null }));
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
  const exportJson = () => downloadText(`wishlist-backup-${today()}.json`, JSON.stringify({ version: 2, themes, refillItems, exportedAt: now() }, null, 2), "application/json");
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
  const searchThemes = themes.filter((t) => t.status !== "買った" && matchesKeyword(t, searchFilters.keyword) && (searchFilters.status === "すべて" || t.status === searchFilters.status));
  const boughtThemes = themes
    .filter((t) => t.status === "買った" && matchesKeyword(t, boughtFilters.keyword) && (boughtFilters.satisfaction === "すべて" || String(t.satisfaction ?? "") === boughtFilters.satisfaction))
    .sort((a, b) => (b.purchasedDate || b.updatedAt).localeCompare(a.purchasedDate || a.updatedAt));
  const visibleRefills = refillItems.filter(isRefillVisible);
  const waitingRefills = refillItems.filter((item) => !isRefillVisible(item)).sort((a, b) => nextShowDate(a).localeCompare(nextShowDate(b)));

  // ----- 各パーツ -----

  const renderThemeEditForm = (theme: WishlistTheme) => (
    <form className="inline-form" onSubmit={submitThemeEdit}>
      <label>テーマ名<input value={themeDraft.title} onChange={(e) => setThemeDraft({ ...themeDraft, title: e.target.value })} required /></label>
      <div className="grid-2">
        <label>状態<select value={themeDraft.status} onChange={(e) => setThemeDraft({ ...themeDraft, status: e.target.value as ThemeStatus })}>{statuses.filter((s) => s !== "買った").map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>カテゴリ<select value={themeDraft.category} onChange={(e) => setThemeDraft({ ...themeDraft, category: e.target.value as Category })}>{categories.map((v) => <option key={v}>{v}</option>)}</select></label>
      </div>
      <label>欲しい理由<textarea value={themeDraft.reason} onChange={(e) => setThemeDraft({ ...themeDraft, reason: e.target.value })} placeholder="なぜ欲しいのか。あとで冷静に見返す用" /></label>
      <label>メモ<textarea value={themeDraft.memo} onChange={(e) => setThemeDraft({ ...themeDraft, memo: e.target.value })} /></label>
      <div className="actions">
        <button className="primary" type="submit">保存する</button>
        <button type="button" onClick={() => setEditingThemeId("")}>キャンセル</button>
        <button type="button" className="danger-link" onClick={() => deleteTheme(theme)}><Trash2 size={15} />削除</button>
      </div>
    </form>
  );

  const renderCandidateForm = (theme: WishlistTheme) => {
    const editing = editingCandidateId ? theme.candidates.find((c) => c.id === editingCandidateId) : undefined;
    return (
      <form className="inline-form" onSubmit={(e) => submitCandidate(theme, e)}>
        <label className="photo-picker">
          写真{editing ? "（変えるときだけ選ぶ）" : "（必須）"}
          <input type="file" accept="image/*" onChange={(e) => selectCandidateFile(e.target.files?.[0])} />
          {candidateDraft.previewUrl
            ? <img src={candidateDraft.previewUrl} alt="" className="photo-preview" />
            : editing?.photoId
              ? <PhotoThumb photoId={editing.photoId} className="photo-preview" />
              : <span className="photo-picker-hint"><Camera size={18} />タップして撮影・選択</span>}
        </label>
        <label>店名・サイト名（必須）<input value={candidateDraft.shop} onChange={(e) => setCandidateDraft({ ...candidateDraft, shop: e.target.value })} required placeholder="例：ユニクロ 〇〇店" /></label>
        <div className="grid-2">
          <label>金額（任意）<input type="number" inputMode="numeric" value={candidateDraft.price} onChange={(e) => setCandidateDraft({ ...candidateDraft, price: e.target.value })} /></label>
          <label>メモ（任意）<input value={candidateDraft.memo} onChange={(e) => setCandidateDraft({ ...candidateDraft, memo: e.target.value })} /></label>
        </div>
        <div className="actions">
          <button className="primary" type="submit" disabled={candidateSaving}>{candidateSaving ? "保存中…" : editing ? "候補を保存" : "候補を追加"}</button>
          <button type="button" onClick={closeCandidateForm}>キャンセル</button>
        </div>
      </form>
    );
  };

  const renderPurchaseForm = (theme: WishlistTheme) => (
    <form className="inline-form" onSubmit={(e) => submitPurchase(theme, e)}>
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

  const renderCandidateRow = (theme: WishlistTheme, candidate: WishlistCandidate) => (
    <div className="candidate" key={candidate.id}>
      <PhotoThumb photoId={candidate.photoId} className="thumb" onClick={() => candidate.photoId && setOverlayPhotoId(candidate.photoId)} />
      <div className="candidate-body">
        <b>{candidate.shop}</b>
        <p>{[fmtPrice(candidate.price), `登録：${fmtDate(candidate.createdAt)}`].filter(Boolean).join(" ／ ")}</p>
        {candidate.memo && <p className="muted">{candidate.memo}</p>}
      </div>
      <div className="candidate-actions">
        <button onClick={() => openCandidateForm(theme.id, candidate)} aria-label="候補を編集"><Pencil size={15} /></button>
        <button onClick={() => deleteCandidate(theme, candidate)} aria-label="候補を削除"><Trash2 size={15} /></button>
      </div>
    </div>
  );

  const renderThemeCard = (theme: WishlistTheme) => (
    <article className="theme-card" key={theme.id}>
      <div className="card-head">
        <div>
          <h3>{theme.title}</h3>
          <p>{theme.status} ／ {theme.category} ／ 登録：{fmtDate(theme.createdAt)}</p>
        </div>
      </div>
      {editingThemeId === theme.id ? renderThemeEditForm(theme) : (
        <>
          {theme.reason && <p className="reason">{theme.reason}</p>}
          {theme.memo && <p className="muted">{theme.memo}</p>}
          {theme.candidates.length > 0 && <div className="candidate-list">{theme.candidates.map((c) => renderCandidateRow(theme, c))}</div>}
          {candidateFormThemeId === theme.id ? renderCandidateForm(theme) : purchaseThemeId === theme.id ? renderPurchaseForm(theme) : (
            <div className="actions">
              <button onClick={() => openCandidateForm(theme.id)}><Camera size={16} />候補を追加</button>
              <button onClick={() => startPurchase(theme)}><CheckCircle2 size={16} />買った</button>
              <button onClick={() => startEditTheme(theme)}><Pencil size={16} />編集</button>
            </div>
          )}
        </>
      )}
    </article>
  );

  const renderSearchView = () => (
    <>
      <form className="quick-add" onSubmit={submitQuickTheme}>
        <input value={quickTheme} onChange={(e) => setQuickTheme(e.target.value)} placeholder="欲しいものを名前だけで追加" aria-label="テーマ名" />
        <button className="primary" type="submit" disabled={!quickTheme.trim()}><Plus size={18} /></button>
      </form>
      <div className="filters">
        <label className="search-box"><Search size={16} /><input value={searchFilters.keyword} onChange={(e) => setSearchFilters({ ...searchFilters, keyword: e.target.value })} placeholder="検索" /></label>
        <select value={searchFilters.status} onChange={(e) => setSearchFilters({ ...searchFilters, status: e.target.value })}>
          <option>すべて</option>
          {searchGroups.map((v) => <option key={v}>{v}</option>)}
        </select>
      </div>
      {searchGroups.map((status) => {
        const items = searchThemes.filter((t) => t.status === status);
        const open = openGroups[status] ?? false;
        return (
          <section className="group" key={status}>
            <button className="group-toggle" onClick={() => setOpenGroups({ ...openGroups, [status]: !open })}>
              {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<span>{status}</span><b>{items.length}</b>
            </button>
            {open && <div className="card-list">{items.map(renderThemeCard)}{items.length === 0 && <p className="empty">なし</p>}</div>}
          </section>
        );
      })}
    </>
  );

  const renderRefillRow = (item: RefillItem) => (
    <div className="refill-row" key={item.id}>
      {editingRefillId === item.id ? (
        <form className="inline-form refill-edit" onSubmit={submitRefillEdit}>
          <label>品名<input value={refillDraft.name} onChange={(e) => setRefillDraft({ ...refillDraft, name: e.target.value })} required /></label>
          <label>再表示までの月数<input type="number" inputMode="numeric" min={1} max={24} value={refillDraft.intervalMonths} onChange={(e) => setRefillDraft({ ...refillDraft, intervalMonths: e.target.value })} /></label>
          <div className="actions">
            <button className="primary" type="submit">保存する</button>
            <button type="button" onClick={() => setEditingRefillId("")}>キャンセル</button>
            <button type="button" className="danger-link" onClick={() => deleteRefill(item)}><Trash2 size={15} />削除</button>
          </div>
        </form>
      ) : (
        <>
          <div className="refill-body">
            <b>{item.name}</b>
            <p>{lastPurchase(item) ? `前回：${fmtDate(lastPurchase(item))}` : "まだ買っていない"} ／ {item.intervalMonths}ヶ月ごと</p>
          </div>
          <div className="refill-actions">
            <button className="primary" onClick={() => buyRefill(item)}><CheckCircle2 size={16} />買った</button>
            <button onClick={() => startEditRefill(item)} aria-label="編集"><Pencil size={15} /></button>
          </div>
        </>
      )}
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
    const candidate = theme.candidates.find((c) => c.id === theme.purchasedCandidateId) ?? theme.candidates.find((c) => c.photoId);
    return (
      <article className="theme-card bought-card" key={theme.id}>
        <div className="bought-row">
          <PhotoThumb photoId={candidate?.photoId ?? null} className="thumb" onClick={() => candidate?.photoId && setOverlayPhotoId(candidate.photoId)} />
          <div className="bought-body">
            <h3>{theme.title}</h3>
            <p>{[fmtDate(theme.purchasedDate), fmtPrice(theme.purchasedPrice), candidate?.shop].filter(Boolean).join(" ／ ")}</p>
            <p className={theme.satisfaction ? "sat" : "muted"}>{theme.satisfaction ? `満足度 ${theme.satisfaction}：${satLabels[theme.satisfaction]}` : "満足度：未記入（あとから足せます）"}</p>
            {theme.purchaseNote && <p className="muted">{theme.purchaseNote}</p>}
          </div>
        </div>
        {purchaseThemeId === theme.id ? renderPurchaseForm(theme) : (
          <div className="actions">
            <button onClick={() => startPurchase(theme)}><Pencil size={15} />{theme.satisfaction ? "記録を編集" : "満足度を追記"}</button>
            <button onClick={() => deleteTheme(theme)} aria-label="削除"><Trash2 size={15} /></button>
          </div>
        )}
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
        <p className="note">既存データは消さず、新しいテーマ・候補・補充だけ追加します。初期版（v1）のバックアップも読み込めます。</p>
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
    { id: "search" as ActiveView, label: "探し中", icon: ShoppingBag },
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
      {overlayPhotoId && (
        <div className="photo-overlay" onClick={() => setOverlayPhotoId(null)}>
          <PhotoThumb photoId={overlayPhotoId} className="photo-full" />
          <button className="overlay-close" aria-label="閉じる"><X size={22} /></button>
        </div>
      )}
      <nav className="bottom-nav">
        {nav.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeView === id ? "active" : ""} onClick={() => { setActiveView(id); setEditingThemeId(""); setCandidateFormThemeId(""); setPurchaseThemeId(""); }}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
