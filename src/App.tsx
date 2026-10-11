import { FormEvent, useEffect, useRef, useState } from "react";
import { DATA_KEY, DEFAULT_INTERVAL_MONTHS, HINTS_DISMISSED_KEY, VIEW_KEY, categories, dateLabel, dateShort, emptyPhotos, fmtPrice, isRefillVisible, lastPurchase, mainPhotoId, makeId, nextShowDate, now, photoIdList, photoSlots, releaseDateLabel, satLabels, sats, today } from "./helpers";
import { downloadText } from "./fileUtils";
import { buildImportPreview } from "./importPreview";
import type { ImportPreview } from "./importPreview";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { createMarkdown } from "./markdownExport";
import { Modal } from "./Modal";
import { compressImage, deletePhoto, photoErrorMessage, putPhoto } from "./photoStore";
import { PhotoThumb } from "./PhotoThumb";
import { loadData } from "./storage";
import { IconButton, OverflowMenu } from "./ui";
import type { ActiveView, Category, PhotoSlot, RefillItem, Satisfaction, WishlistCandidate, WishlistData, WishlistTheme } from "./types";

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
const clearedPurchase = { status: "未購入" as const, purchasedDate: "", purchasedPrice: null, purchaseNote: "", purchasedCandidateId: "", satisfaction: null };

// 確認・お知らせのダイアログ。onConfirm が無いときは「閉じる」だけのお知らせになる
type DialogState = { message: string; detail?: string; confirmLabel?: string; danger?: boolean; onConfirm?: () => void };
// 操作直後のお知らせ。undo があるときは「取り消す」を出す
type ToastState = { text: string; undo?: () => void };
const TOAST_MS = 6000;

const loadDismissedHints = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HINTS_DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

function App() {
  const [{ themes, refillItems }, setData] = useState<WishlistData>(loadData);
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "refill" || v === "bought" || v === "settings" || v === "search" ? v : "search";
  });
  const [quickTheme, setQuickTheme] = useState("");
  const [quickRefill, setQuickRefill] = useState("");
  const [stoppedOpen, setStoppedOpen] = useState(false);
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
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [dismissedHints, setDismissedHints] = useState<string[]>(loadDismissedHints);

  useEffect(() => {
    localStorage.setItem(DATA_KEY, JSON.stringify({ version: 4, themes, refillItems }));
  }, [themes, refillItems]);
  useEffect(() => localStorage.setItem(VIEW_KEY, activeView), [activeView]);
  useEffect(() => localStorage.setItem(HINTS_DISMISSED_KEY, JSON.stringify(dismissedHints)), [dismissedHints]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  const stopTheme = (theme: WishlistTheme) => setDialog({
    message: `「${theme.title}」をやめた記録へ移しますか？`,
    confirmLabel: "やめたにする",
    onConfirm: () => {
      updateTheme(theme.id, (t) => ({ ...t, status: "やめた" }));
      setEditingThemeId("");
      setToast({ text: `「${theme.title}」をやめたへ移しました`, undo: () => updateTheme(theme.id, (t) => ({ ...t, status: "未購入" })) });
    },
  });

  const restoreTheme = (theme: WishlistTheme) => {
    updateTheme(theme.id, (t) => ({ ...t, status: "未購入" }));
    setEditingThemeId("");
  };

  const deleteTheme = (theme: WishlistTheme) => setDialog({
    message: `「${theme.title}」を削除しますか？`,
    detail: "候補と写真も一緒に削除されます。",
    confirmLabel: "削除",
    danger: true,
    onConfirm: () => {
      theme.candidates.forEach((c) => {
        photoIdList(c.photos).forEach((photoId) => deletePhoto(photoId).catch(() => {}));
      });
      updateThemes((all) => all.filter((t) => t.id !== theme.id));
      setEditingThemeId("");
      setPurchaseThemeId("");
    },
  });

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
      if (session === slotSessionRef.current) setDialog({ message: `${photoSlots.find((s) => s.key === slot)?.label}の写真を読み込めませんでした。選び直してください。`, detail: photoErrorMessage(error) });
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
      setDialog({ message: "写真をどれか1枚選んでください", detail: "値札・全体・試着のどの枠でもOKです。" });
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
      setDialog({ message: "写真の保存に失敗しました。もう一度お試しください。", detail: photoErrorMessage(error) });
    } finally {
      setCandidateSaving(false);
    }
  };

  const deleteCandidate = (theme: WishlistTheme, candidate: WishlistCandidate) => setDialog({
    message: `候補「${candidate.shop}」を削除しますか？`,
    detail: "写真も削除されます。",
    confirmLabel: "削除",
    danger: true,
    onConfirm: () => {
      photoIdList(candidate.photos).forEach((photoId) => deletePhoto(photoId).catch(() => {}));
      updateTheme(theme.id, (t) => ({ ...t, candidates: t.candidates.filter((c) => c.id !== candidate.id) }));
    },
  });

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
    if (theme.status !== "買った") {
      setActiveView("bought");
      // 押し間違いは直後のお知らせから戻せる（「購入を取り消す」と同じ処理）
      setToast({
        text: `「${theme.title}」を買ったへ移しました`,
        undo: () => {
          updateTheme(theme.id, (t) => ({ ...t, ...clearedPurchase }));
          setActiveView("search");
        },
      });
    }
  };

  const cancelPurchaseRecord = (theme: WishlistTheme) => setDialog({
    message: "購入記録を取り消して「ほしいもの」に戻しますか？",
    confirmLabel: "購入を取り消す",
    danger: true,
    onConfirm: () => {
      updateTheme(theme.id, (t) => ({ ...t, ...clearedPurchase }));
      setPurchaseThemeId("");
    },
  });

  // ----- 補充リスト -----

  const buyRefill = (item: RefillItem) => {
    updateRefill(item.id, (r) => ({ ...r, purchases: [today(), ...r.purchases], resurfacedAt: null }));
    // 押し間違いは直後のお知らせから戻せる（押す前の購入履歴と再表示の状態へ戻す）
    setToast({ text: `「${item.name}」を買ったにしました`, undo: () => updateRefill(item.id, (r) => ({ ...r, purchases: item.purchases, resurfacedAt: item.resurfacedAt })) });
  };

  const resurfaceRefill = (item: RefillItem) => updateRefill(item.id, (r) => ({ ...r, resurfacedAt: today() }));

  const undoRefillPurchase = (item: RefillItem) => setDialog({
    message: `「${item.name}」の前回の購入記録（${dateLabel(lastPurchase(item))}）を取り消しますか？`,
    confirmLabel: "記録を取り消す",
    danger: true,
    onConfirm: () => updateRefill(item.id, (r) => ({ ...r, purchases: r.purchases.slice(1) })),
  });

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

  const deleteRefill = (item: RefillItem) => setDialog({
    message: `「${item.name}」を補充リストから削除しますか？`,
    detail: "購入履歴も消えます。",
    confirmLabel: "削除",
    danger: true,
    onConfirm: () => {
      updateRefills((all) => all.filter((r) => r.id !== item.id));
      setEditingRefillId("");
    },
  });

  // ----- 入出力 -----

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
    setImportMessage(`追加しました：テーマ ${preview.newThemes.length} 件、候補 ${preview.candidateAdds.reduce((n, g) => n + g.candidates.length, 0) + preview.newThemes.reduce((n, t) => n + t.candidates.length, 0)} 件、補充 ${preview.newRefills.length} 件（すでにあるので飛ばした分：テーマ ${preview.duplicateThemeCount}・候補 ${preview.duplicateCandidateCount}・補充 ${preview.duplicateRefillCount}）`);
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

  // ----- 初回だけ見せる説明 -----

  const dismissHint = (key: string) => setDismissedHints((prev) => (prev.includes(key) ? prev : [...prev, key]));
  const refillHintText = `「買った」を押すと一度消えて、${DEFAULT_INTERVAL_MONTHS}ヶ月後（品目ごとに変更可）にまた表示されます。`;

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
      <div className="action-row form-actions">
        <button className="btn primary" type="submit">保存する</button>
        <button className="btn" type="button" onClick={() => setEditingThemeId("")}>キャンセル</button>
      </div>
      <div className="action-row sub-actions">
        {theme.status === "未購入"
          ? <button type="button" className="text-btn danger" onClick={() => stopTheme(theme)}>やめたにする</button>
          : theme.status === "やめた" && <button type="button" className="text-btn" onClick={() => restoreTheme(theme)}><Icon name="rotate-ccw" size={18} />ほしいものに戻す</button>}
        <button type="button" className="text-btn danger" onClick={() => deleteTheme(theme)}><Icon name="trash" size={18} />削除</button>
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
                    <input type="file" accept="image/*" aria-label={`${label}の写真を選ぶ`} onChange={(e) => { selectSlotFile(key, e.target.files?.[0]); e.currentTarget.value = ""; }} />
                    {draft.previewUrl
                      ? <img src={draft.previewUrl} alt="" className="slot-img" />
                      : existingId
                        ? <PhotoThumb photoId={existingId} className="slot-img" />
                        : <span className="slot-hint"><Icon name="camera" />追加</span>}
                  </label>
                  {hasPhoto && <button type="button" className="slot-remove" onClick={() => removeSlot(key)} aria-label={`${label}の写真を外す`}><Icon name="x" size={14} /></button>}
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
        <div className="action-row form-actions">
          <button className="btn primary" type="submit" disabled={candidateSaving || slotBusyCount > 0}>{candidateSaving ? "保存中…" : slotBusyCount > 0 ? "写真を処理中…" : editing ? "候補を保存" : "候補を追加"}</button>
          <button className="btn" type="button" onClick={closeCandidateForm}>キャンセル</button>
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
      <div className="action-row form-actions">
        <button className="btn primary" type="submit"><Icon name="circle-check" size={18} />{theme.status === "買った" ? "記録を保存" : "買ったにする"}</button>
        <button className="btn" type="button" onClick={() => setPurchaseThemeId("")}>キャンセル</button>
      </div>
      {theme.status === "買った" && (
        <div className="action-row sub-actions">
          <button type="button" className="text-btn danger" onClick={() => cancelPurchaseRecord(theme)}>購入を取り消す</button>
        </div>
      )}
    </form>
  );

  const renderRefillEditForm = (item: RefillItem) => (
    <form className="modal-form" onSubmit={submitRefillEdit}>
      <label>品名<input value={refillDraft.name} onChange={(e) => setRefillDraft({ ...refillDraft, name: e.target.value })} required /></label>
      <label>再表示までの月数<input type="number" inputMode="numeric" min={1} max={24} value={refillDraft.intervalMonths} onChange={(e) => setRefillDraft({ ...refillDraft, intervalMonths: e.target.value })} /></label>
      <div className="action-row form-actions">
        <button className="btn primary" type="submit">保存する</button>
        <button className="btn" type="button" onClick={() => setEditingRefillId("")}>キャンセル</button>
      </div>
      <div className="action-row sub-actions">
        <button type="button" className="text-btn danger" onClick={() => deleteRefill(item)}><Icon name="trash" size={18} />削除</button>
      </div>
    </form>
  );

  // ----- カード・行の表示 -----

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
            <p className="meta">{[fmtPrice(candidate.price), `登録 ${dateShort(candidate.createdAt)}`].filter(Boolean).join(" · ")}</p>
            {candidate.memo && <p className="memo">{candidate.memo}</p>}
          </div>
        </div>
        <OverflowMenu
          label={`候補「${candidate.shop}」の操作`}
          items={[
            { label: "候補を編集", icon: "pencil", onSelect: () => openCandidateForm(theme.id, candidate) },
            { label: "候補を削除", icon: "trash", danger: true, onSelect: () => deleteCandidate(theme, candidate) },
          ]}
        />
      </div>
    );
  };

  const renderThemeCard = (theme: WishlistTheme) => (
    <article className="card theme-card" key={theme.id}>
      <div className="card-head">
        <div className="card-head-main">
          <h3>{theme.title}</h3>
          <p className="meta">{[theme.category, releaseDateLabel(theme.releaseDate), `登録 ${dateShort(theme.createdAt)}`].filter(Boolean).join(" · ")}</p>
        </div>
        <IconButton icon="pencil" label={`「${theme.title}」を編集`} onClick={() => startEditTheme(theme)} />
      </div>
      {theme.reason && <p className="reason">{theme.reason}</p>}
      {theme.memo && <p className="memo">{theme.memo}</p>}
      {theme.candidates.length > 0 && <div className="candidate-list">{theme.candidates.map((c) => renderCandidateRow(theme, c))}</div>}
      {theme.status === "やめた" ? (
        <div className="action-row">
          <button className="btn small" type="button" onClick={() => restoreTheme(theme)}><Icon name="rotate-ccw" size={18} />ほしいものに戻す</button>
        </div>
      ) : (
        <div className="action-row">
          <button className="btn small" type="button" onClick={() => openCandidateForm(theme.id)}><Icon name="camera" size={18} />候補を追加</button>
          <button className="btn small" type="button" onClick={() => startPurchase(theme)}><Icon name="circle-check" size={18} />買った</button>
        </div>
      )}
    </article>
  );

  const renderSearchView = () => (
    <div className="screen-body">
      <form className="quick-add" onSubmit={submitQuickTheme}>
        <input value={quickTheme} onChange={(e) => setQuickTheme(e.target.value)} placeholder="欲しいものを名前だけで追加" aria-label="テーマ名" />
        <button className="send-btn" type="submit" disabled={!quickTheme.trim()} aria-label="ほしいものを追加"><Icon name="plus" /></button>
      </form>
      <label className="search-box"><Icon name="search" size={18} /><input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="検索" aria-label="ほしいものを検索" /></label>
      {activeSearchThemes.length === 0 && <p className="empty">ほしいものはまだありません。</p>}
      {([
        ["発売予定", scheduledThemes],
        ["候補あり", candidateThemes],
        ["テーマだけ", themeOnlyThemes],
      ] as const).filter(([, items]) => items.length > 0).map(([groupName, items]) => (
        <section className="list-section" key={groupName}>
          <h2 className="section-title">{groupName}<span className="count">{items.length}</span></h2>
          <div className="card-list">{items.map(renderThemeCard)}</div>
        </section>
      ))}
      {stoppedThemes.length > 0 && (
        <section className="list-section">
          <button className="section-toggle" type="button" aria-expanded={stoppedOpen} onClick={() => setStoppedOpen(!stoppedOpen)}>
            <span className={stoppedOpen ? "fold-caret open" : "fold-caret"}><Icon name="chevron-right" size={18} /></span>
            <span>やめた</span><span className="count">{stoppedThemes.length}</span>
          </button>
          {stoppedOpen && <div className="card-list">{stoppedThemes.map(renderThemeCard)}</div>}
        </section>
      )}
    </div>
  );

  const renderRefillRow = (item: RefillItem) => (
    <div className="refill-row" key={item.id}>
      <div className="row-main">
        <b className="row-title">{item.name}</b>
        <p className="row-sub">{lastPurchase(item) ? `前回 ${dateShort(lastPurchase(item))}` : "まだ買っていない"} · {item.intervalMonths}ヶ月ごと</p>
      </div>
      <button className="btn small primary" type="button" onClick={() => buyRefill(item)}><Icon name="circle-check" size={18} />買った</button>
      <IconButton icon="pencil" label={`「${item.name}」を編集`} onClick={() => startEditRefill(item)} />
    </div>
  );

  const renderRefillView = () => (
    <div className="screen-body">
      <form className="quick-add" onSubmit={submitQuickRefill}>
        <input value={quickRefill} onChange={(e) => setQuickRefill(e.target.value)} placeholder="日用品などを名前だけで追加" aria-label="品名" />
        <button className="send-btn" type="submit" disabled={!quickRefill.trim()} aria-label="補充を追加"><Icon name="plus" /></button>
      </form>
      {!dismissedHints.includes("refill") && (
        <div className="hint">
          <p>{refillHintText}</p>
          <IconButton icon="x" label="この説明を閉じる" onClick={() => dismissHint("refill")} />
        </div>
      )}
      {visibleRefills.length > 0
        ? <div className="card list-rows">{visibleRefills.map(renderRefillRow)}</div>
        : <p className="empty">いま表示中の補充はありません。{refillItems.length === 0 && dismissedHints.includes("refill") && <><br />{refillHintText}</>}</p>}
      <section className="list-section">
        <button className="section-toggle" type="button" aria-expanded={waitingOpen} onClick={() => setWaitingOpen(!waitingOpen)}>
          <span className={waitingOpen ? "fold-caret open" : "fold-caret"}><Icon name="chevron-right" size={18} /></span>
          <span>待機中（購入済み）</span><span className="count">{waitingRefills.length}</span>
        </button>
        {waitingOpen && (waitingRefills.length > 0 ? (
          <div className="card list-rows">
            {waitingRefills.map((item) => (
              <div className="refill-row waiting" key={item.id}>
                <div className="row-main">
                  <b className="row-title">{item.name}</b>
                  <p className="row-sub">前回 {dateShort(lastPurchase(item))} · 次に出る日 {dateShort(nextShowDate(item))}</p>
                </div>
                <OverflowMenu
                  label={`「${item.name}」の操作`}
                  items={[
                    { label: "今すぐ表示", icon: "rotate-ccw", onSelect: () => resurfaceRefill(item) },
                    { label: "記録を取り消す", icon: "x", danger: true, onSelect: () => undoRefillPurchase(item) },
                  ]}
                />
              </div>
            ))}
          </div>
        ) : <p className="empty">待機中の品目はありません。</p>)}
      </section>
    </div>
  );

  const renderBoughtRow = (theme: WishlistTheme) => {
    const candidate = theme.candidates.find((c) => c.id === theme.purchasedCandidateId) ?? theme.candidates.find((c) => photoIdList(c.photos).length > 0);
    const photoId = candidate ? mainPhotoId(candidate.photos) : null;
    return (
      <article className="bought-row" key={theme.id}>
        <PhotoThumb photoId={photoId} className="thumb" onClick={() => photoId && setOverlayPhoto({ photoId, label: theme.title })} />
        <div className="bought-body">
          <h3>{theme.title}</h3>
          <p className="meta">{[dateShort(theme.purchasedDate), fmtPrice(theme.purchasedPrice), candidate?.shop].filter(Boolean).join(" · ")}</p>
          {theme.satisfaction
            ? <p className="sat">満足度 {theme.satisfaction}：{satLabels[theme.satisfaction]}</p>
            : <p className="meta">満足度は未記入（あとから足せます）</p>}
          {theme.purchaseNote && <p className="memo">{theme.purchaseNote}</p>}
          {!theme.satisfaction && <button className="btn small" type="button" onClick={() => startPurchase(theme)}><Icon name="pencil" size={18} />満足度を追記</button>}
        </div>
        <OverflowMenu
          label={`「${theme.title}」の操作`}
          items={[
            { label: "記録を編集", icon: "pencil", onSelect: () => startPurchase(theme) },
            { label: "削除", icon: "trash", danger: true, onSelect: () => deleteTheme(theme) },
          ]}
        />
      </article>
    );
  };

  const renderBoughtView = () => (
    <div className="screen-body">
      <div className="filters">
        <label className="search-box"><Icon name="search" size={18} /><input value={boughtFilters.keyword} onChange={(e) => setBoughtFilters({ ...boughtFilters, keyword: e.target.value })} placeholder="検索" aria-label="買ったものを検索" /></label>
        <select value={boughtFilters.satisfaction} aria-label="満足度で絞り込む" onChange={(e) => setBoughtFilters({ ...boughtFilters, satisfaction: e.target.value })}>
          <option>すべて</option>
          {sats.map((v) => <option key={v} value={v}>{v}：{satLabels[v]}</option>)}
        </select>
      </div>
      {boughtThemes.length > 0
        ? <div className="card list-rows">{boughtThemes.map(renderBoughtRow)}</div>
        : <p className="empty">買ったテーマはまだありません。</p>}
    </div>
  );

  const importCandidateCount = importPreview ? importPreview.candidateAdds.reduce((n, g) => n + g.candidates.length, 0) + importPreview.newThemes.reduce((n, t) => n + t.candidates.length, 0) : 0;

  const renderSettingsView = () => (
    <div className="screen-body">
      <section className="list-section">
        <h2 className="section-title">バックアップ</h2>
        <div className="card list-rows">
          <button className="row-btn" type="button" onClick={exportJson}>
            <Icon name="download" />
            <span className="row-main"><span className="row-title">バックアップを保存</span><span className="row-sub">保存・復元用。写真は含まれません</span></span>
          </button>
          <label className="row-btn">
            <Icon name="upload" />
            <span className="row-main"><span className="row-title">バックアップから追加</span><span className="row-sub">いまのデータは消さず、新しい分だけ足します</span></span>
            <input type="file" accept="application/json,.json" onChange={(e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; readImportFile(file); }} />
          </label>
          <button className="row-btn" type="button" onClick={exportMarkdown}>
            <Icon name="text" />
            <span className="row-main"><span className="row-title">全記録をテキストで書き出す</span><span className="row-sub">読み返す・AIに渡す用。写真は含まれません</span></span>
          </button>
        </div>
        {importPreview && (
          <div className="card pad import-preview">
            <h3>追加する内容</h3>
            {importPreview.valid ? (
              <>
                <div className="stat-grid">
                  <span>新しいテーマ {importPreview.newThemes.length}</span>
                  <span>新しい候補 {importCandidateCount}</span>
                  <span>新しい補充 {importPreview.newRefills.length}</span>
                  <span>すでにある分 テーマ{importPreview.duplicateThemeCount}・候補{importPreview.duplicateCandidateCount}・補充{importPreview.duplicateRefillCount}</span>
                </div>
                {importPreview.warnings.map((x) => <p className="warning-text" key={x}>{x}</p>)}
                <button className="btn primary" type="button" onClick={applyImport}>新しい分だけ追加する</button>
              </>
            ) : importPreview.errors.map((x) => <p className="danger-text" key={x}>{x}</p>)}
          </div>
        )}
        {importMessage && <p className="status-line" role="status">{importMessage}</p>}
      </section>
      <section className="list-section">
        <h2 className="section-title">そのほか</h2>
        <details className="card details">
          <summary>このアプリについて<Icon name="chevron-down" /></summary>
          <div className="details-body info">
            <ul>
              <li>データと写真はこのブラウザの中に保存されます。PCとスマホで自動同期はされません。</li>
              <li>ブラウザのサイトデータを削除すると、データも写真も消えます。「バックアップを保存」で定期的に控えを取ってください。</li>
              <li>写真はバックアップに含まれない「参考用」です。消えて困る写真は端末の写真アプリにも残してください。</li>
              <li>バックアップや書き出したファイルには個人的な内容が含まれるため、人に見える場所に置かないでください。</li>
              <li>以前の版で保存したバックアップも読み込めます。</li>
            </ul>
          </div>
        </details>
      </section>
    </div>
  );

  const nav: { id: ActiveView; label: string; icon: IconName }[] = [
    { id: "search", label: "ほしいもの", icon: "shopping-bag" },
    { id: "refill", label: "補充", icon: "rotate-ccw" },
    { id: "bought", label: "買った", icon: "circle-check" },
    { id: "settings", label: "設定", icon: "settings" },
  ];
  const closeDialog = () => setDialog(null);

  return (
    <div className="app-shell">
      <header className="app-bar">
        <h1 className="app-bar-title">{nav.find((n) => n.id === activeView)?.label}</h1>
      </header>
      <main>
        <div className="screen" key={activeView}>
          {activeView === "search" && renderSearchView()}
          {activeView === "refill" && renderRefillView()}
          {activeView === "bought" && renderBoughtView()}
          {activeView === "settings" && renderSettingsView()}
        </div>
      </main>
      {editingTheme && <Modal title="テーマを編集" onClose={() => setEditingThemeId("")}>{renderThemeEditForm(editingTheme)}</Modal>}
      {candidateFormTheme && <Modal title={editingCandidateId ? "候補を編集" : `候補を追加：${candidateFormTheme.title}`} onClose={closeCandidateForm}>{renderCandidateForm(candidateFormTheme)}</Modal>}
      {purchaseTheme && <Modal title={purchaseTheme.status === "買った" ? "購入記録を編集" : `買った：${purchaseTheme.title}`} onClose={() => setPurchaseThemeId("")}>{renderPurchaseForm(purchaseTheme)}</Modal>}
      {editingRefill && <Modal title="補充を編集" onClose={() => setEditingRefillId("")}>{renderRefillEditForm(editingRefill)}</Modal>}
      {overlayPhoto && (
        <div className="photo-overlay" onClick={() => setOverlayPhoto(null)}>
          <PhotoThumb photoId={overlayPhoto.photoId} className="photo-full" />
          <span className="overlay-label">{overlayPhoto.label}</span>
          <button className="overlay-close" type="button" aria-label="閉じる"><Icon name="x" size={22} /></button>
        </div>
      )}
      {dialog && (
        <div className="dialog-backdrop" onClick={closeDialog}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label={dialog.message} onClick={(e) => e.stopPropagation()}>
            <p className="dialog-message">{dialog.message}</p>
            {dialog.detail && <p className="dialog-detail">{dialog.detail}</p>}
            <div className="action-row dialog-actions">
              {dialog.onConfirm ? (
                <>
                  <button className="btn" type="button" onClick={closeDialog}>キャンセル</button>
                  <button className={dialog.danger ? "btn danger" : "btn primary"} type="button" onClick={() => { const run = dialog.onConfirm!; closeDialog(); run(); }}>{dialog.confirmLabel}</button>
                </>
              ) : <button className="btn primary" type="button" onClick={closeDialog}>閉じる</button>}
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span className="toast-text">{toast.text}</span>
          {toast.undo && <button type="button" className="toast-btn" onClick={() => { const undo = toast.undo!; setToast(null); undo(); }}>取り消す</button>}
          <button type="button" className="toast-btn close" aria-label="閉じる" onClick={() => setToast(null)}><Icon name="x" size={16} /></button>
        </div>
      )}
      <nav className="bottom-tabs" aria-label="画面切り替え">
        {nav.map(({ id, label, icon }) => (
          <button key={id} type="button" className={activeView === id ? "tab active" : "tab"} aria-current={activeView === id ? "page" : undefined} onClick={() => { setActiveView(id); setEditingThemeId(""); closeCandidateForm(); setPurchaseThemeId(""); setEditingRefillId(""); }}>
            <span className="tab-icon"><Icon name={icon} size={22} /></span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
