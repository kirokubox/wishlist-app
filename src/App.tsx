
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, ChevronDown, ChevronRight, Download, ListPlus, PackageCheck, Plus, RotateCcw, Search, Settings, ShoppingBag, Trash2 } from "lucide-react";
import "./styles.css";

type Category = "服" | "家電" | "ガジェット" | "日用品" | "家具・インテリア" | "趣味" | "美容・身だしなみ" | "その他";
type ShoppingType = "出会ったら買う" | "比較して買う" | "補充する";
type ThemeStatus = "気になる" | "探し中" | "比較中" | "買う予定" | "そろそろ買う" | "次回買う" | "保留" | "買った" | "やめた";
type NeedLevel = "低" | "中" | "高";
type Priority = "あとで" | "そのうち" | "早めに";
type CandidateRating = "有力" | "普通" | "微妙";
type Satisfaction = 1 | 2 | 3 | 4 | 5;
type ActiveView = "search" | "refill" | "bought" | "settings";

type WishlistCandidate = { id: string; name: string; price: number | null; shop: string; url: string; goodPoints: string; concerns: string; rating: CandidateRating; memo: string; createdAt: string; updatedAt: string };
type WishlistTheme = { id: string; title: string; category: Category; shoppingType: ShoppingType; reason: string; conditions: string; budget: string; needLevel: NeedLevel; priority: Priority; status: ThemeStatus; buyingTiming: string; memo: string; purchasedDate: string; purchasedPrice: number | null; purchasedCandidateId: string; purchasedCandidateName: string; satisfaction: Satisfaction | null; goodAfterPurchase: string; regretMemo: string; candidates: WishlistCandidate[]; createdAt: string; updatedAt: string };
type ThemeDraft = Omit<WishlistTheme, "id" | "createdAt" | "updatedAt" | "candidates">;
type CandidateDraft = Omit<WishlistCandidate, "id" | "createdAt" | "updatedAt">;
type ImportPreview = { valid: boolean; rawCount: number; newThemeCount: number; newCandidateCount: number; duplicateThemeCount: number; duplicateCandidateCount: number; errorCount: number; warningCount: number; errors: string[]; warnings: string[]; themesToAdd: WishlistTheme[]; candidateAdds: { themeId: string; candidates: WishlistCandidate[] }[] };

const DATA_KEY = "yuki-wishlist-data";
const VIEW_KEY = "yuki-wishlist-active-view";
const categories: Category[] = ["服", "家電", "ガジェット", "日用品", "家具・インテリア", "趣味", "美容・身だしなみ", "その他"];
const shoppingTypes: ShoppingType[] = ["出会ったら買う", "比較して買う", "補充する"];
const statuses: ThemeStatus[] = ["気になる", "探し中", "比較中", "買う予定", "そろそろ買う", "次回買う", "保留", "買った", "やめた"];
const needLevels: NeedLevel[] = ["低", "中", "高"];
const priorities: Priority[] = ["あとで", "そのうち", "早めに"];
const ratings: CandidateRating[] = ["有力", "普通", "微妙"];
const sats: Satisfaction[] = [5, 4, 3, 2, 1];
const satLabels: Record<Satisfaction, string> = { 5: "かなり満足", 4: "よかった", 3: "普通", 2: "微妙", 1: "後悔" };
const searchGroups: ThemeStatus[] = ["買う予定", "比較中", "探し中", "気になる", "保留", "やめた"];
const refillGroups: ThemeStatus[] = ["次回買う", "そろそろ買う", "保留", "やめた"];
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const makeId = () => `${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const price = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T) => (list.includes(v as T) ? (v as T) : fallback);
const fmtPrice = (v: number | null) => (v === null ? "" : `${v.toLocaleString("ja-JP")}円`);
const fmtDate = (v: string) => (v ? v.slice(0, 10) : "");

const emptyTheme = (shoppingType: ShoppingType): ThemeDraft => ({ title: "", category: shoppingType === "補充する" ? "日用品" : "その他", shoppingType, reason: "", conditions: "", budget: "", needLevel: "中", priority: "そのうち", status: shoppingType === "補充する" ? "そろそろ買う" : "探し中", buyingTiming: "", memo: "", purchasedDate: "", purchasedPrice: null, purchasedCandidateId: "", purchasedCandidateName: "", satisfaction: null, goodAfterPurchase: "", regretMemo: "" });
const emptyCandidate = (): CandidateDraft => ({ name: "", price: null, shop: "", url: "", goodPoints: "", concerns: "", rating: "普通", memo: "" });
const createTheme = (draft: ThemeDraft): WishlistTheme => ({ ...draft, id: makeId(), title: draft.title.trim(), candidates: [], createdAt: now(), updatedAt: now() });
const createCandidate = (draft: CandidateDraft): WishlistCandidate => ({ ...draft, id: makeId(), name: draft.name.trim(), createdAt: now(), updatedAt: now() });
const sameTheme = (a: WishlistTheme, b: WishlistTheme) => a.id === b.id || (a.title === b.title && a.shoppingType === b.shoppingType && a.createdAt === b.createdAt);
const sameCandidate = (a: WishlistCandidate, b: WishlistCandidate) => a.id === b.id || (a.name === b.name && a.shop === b.shop && a.price === b.price && a.createdAt === b.createdAt);
const candidateName = (t: WishlistTheme) => t.purchasedCandidateName || "テーマそのもの";
const normalizeCandidate = (value: unknown, warnings: string[], path: string): WishlistCandidate | null => {
  if (!value || typeof value !== "object") { warnings.push(`${path}: 候補をスキップしました`); return null; }
  const item = value as Record<string, unknown>;
  if (item.price !== undefined && item.price !== null && typeof item.price !== "number") warnings.push(`${path}: 価格を空にしました`);
  return { id: str(item.id) || makeId(), name: str(item.name), price: price(item.price), shop: str(item.shop), url: str(item.url), goodPoints: str(item.goodPoints), concerns: str(item.concerns), rating: oneOf(item.rating, ratings, "普通"), memo: str(item.memo), createdAt: str(item.createdAt) || now(), updatedAt: str(item.updatedAt) || now() };
};

const normalizeTheme = (value: unknown, errors: string[], warnings: string[], index: number): WishlistTheme | null => {
  if (!value || typeof value !== "object") { errors.push(`themes[${index}]: テーマがオブジェクトではありません`); return null; }
  const item = value as Record<string, unknown>;
  if (!str(item.id) || !str(item.title)) { errors.push(`themes[${index}]: id と title が必要です`); return null; }
  if (item.candidates !== undefined && !Array.isArray(item.candidates)) { errors.push(`themes[${index}]: candidates は配列である必要があります`); return null; }
  if (item.candidates === undefined) warnings.push(`themes[${index}]: candidates がないため空配列にしました`);
  if (item.purchasedPrice !== undefined && item.purchasedPrice !== null && typeof item.purchasedPrice !== "number") warnings.push(`themes[${index}]: 購入価格を空にしました`);
  const shoppingType = oneOf(item.shoppingType, shoppingTypes, "出会ったら買う");
  const rawSat = typeof item.satisfaction === "number" && sats.includes(item.satisfaction as Satisfaction) ? item.satisfaction as Satisfaction : null;
  return { id: str(item.id), title: str(item.title), category: oneOf(item.category, categories, "その他"), shoppingType, reason: str(item.reason), conditions: str(item.conditions), budget: str(item.budget), needLevel: oneOf(item.needLevel, needLevels, "中"), priority: oneOf(item.priority, priorities, "そのうち"), status: oneOf(item.status, statuses, shoppingType === "補充する" ? "そろそろ買う" : "探し中"), buyingTiming: str(item.buyingTiming), memo: str(item.memo), purchasedDate: str(item.purchasedDate), purchasedPrice: price(item.purchasedPrice), purchasedCandidateId: str(item.purchasedCandidateId), purchasedCandidateName: str(item.purchasedCandidateName), satisfaction: rawSat, goodAfterPurchase: str(item.goodAfterPurchase), regretMemo: str(item.regretMemo), candidates: (Array.isArray(item.candidates) ? item.candidates : []).map((c, i) => normalizeCandidate(c, warnings, `themes[${index}].candidates[${i}]`)).filter(Boolean) as WishlistCandidate[], createdAt: str(item.createdAt) || now(), updatedAt: str(item.updatedAt) || now() };
};

const buildImportPreview = (text: string, existing: WishlistTheme[]): ImportPreview => {
  const errors: string[] = [], warnings: string[] = [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { valid: false, rawCount: 0, newThemeCount: 0, newCandidateCount: 0, duplicateThemeCount: 0, duplicateCandidateCount: 0, errorCount: 1, warningCount: 0, errors: ["JSONとして読み込めませんでした"], warnings: [], themesToAdd: [], candidateAdds: [] }; }
  const root = parsed as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") errors.push("JSONのルートがオブジェクトではありません");
  if (root.version === undefined) errors.push("version が存在しません");
  if (!Array.isArray(root.themes)) errors.push("themes が配列ではありません");
  if (errors.length) return { valid: false, rawCount: 0, newThemeCount: 0, newCandidateCount: 0, duplicateThemeCount: 0, duplicateCandidateCount: 0, errorCount: errors.length, warningCount: warnings.length, errors, warnings, themesToAdd: [], candidateAdds: [] };
  const normalized = (root.themes as unknown[]).map((t, i) => normalizeTheme(t, errors, warnings, i)).filter(Boolean) as WishlistTheme[];
  let duplicateThemeCount = 0, duplicateCandidateCount = 0;
  const themesToAdd: WishlistTheme[] = [], candidateAdds: { themeId: string; candidates: WishlistCandidate[] }[] = [];
  normalized.forEach((theme) => {
    const existingTheme = existing.find((current) => sameTheme(current, theme));
    if (!existingTheme) { themesToAdd.push(theme); return; }
    duplicateThemeCount += 1;
    const candidates = theme.candidates.filter((candidate) => {
      const dup = existingTheme.candidates.some((current) => sameCandidate(current, candidate));
      if (dup) duplicateCandidateCount += 1;
      return !dup;
    });
    if (candidates.length) candidateAdds.push({ themeId: existingTheme.id, candidates });
  });
  return { valid: errors.length === 0, rawCount: normalized.length, newThemeCount: themesToAdd.length, newCandidateCount: themesToAdd.reduce((n, t) => n + t.candidates.length, 0) + candidateAdds.reduce((n, g) => n + g.candidates.length, 0), duplicateThemeCount, duplicateCandidateCount, errorCount: errors.length, warningCount: warnings.length, errors, warnings, themesToAdd, candidateAdds };
};

const matchesKeyword = (theme: WishlistTheme, keyword: string) => {
  if (!keyword.trim()) return true;
  const text = [theme.title, theme.reason, theme.conditions, theme.memo, ...theme.candidates.flatMap((c) => [c.name, c.memo, c.shop])].join(" ").toLowerCase();
  return text.includes(keyword.toLowerCase());
};
const md = (v: unknown) => String(v ?? "").replaceAll("\r", " ").replaceAll("\n", " ").trim();
const countLines = <T extends string>(themes: WishlistTheme[], values: T[], pick: (t: WishlistTheme) => T) => values.map((v) => `- ${v}：${themes.filter((t) => pick(t) === v).length}`).join("\n");
const createMarkdown = (themes: WishlistTheme[]) => {
  const search = themes.filter((t) => t.status !== "買った" && t.status !== "やめた" && t.shoppingType !== "補充する");
  const refill = themes.filter((t) => t.status !== "買った" && t.status !== "やめた" && t.shoppingType === "補充する");
  const bought = themes.filter((t) => t.status === "買った");
  const stopped = themes.filter((t) => t.status === "やめた");
  const candidateBlock = (c: WishlistCandidate) => `##### ${md(c.name)}\n\n- 価格：${c.price ?? ""}\n- 店舗・サイト：${md(c.shop)}\n- リンク：${md(c.url)}\n- よさそうな点：${md(c.goodPoints)}\n- 気になる点：${md(c.concerns)}\n- 候補評価：${c.rating}\n- メモ：${md(c.memo)}`;
  const themeBlock = (t: WishlistTheme, includeCandidates = true) => `### ${md(t.title)}\n\n- カテゴリ：${t.category}\n- 買い物タイプ：${t.shoppingType}\n- 状態：${t.status}\n- 欲しい理由：${md(t.reason)}\n- 欲しい条件：${md(t.conditions)}\n- 予算感：${md(t.budget)}\n- 必要度：${t.needLevel}\n- 優先度：${t.priority}\n- 買うタイミング：${md(t.buyingTiming)}\n- メモ：${md(t.memo)}\n- 作成日：${t.createdAt}\n- 更新日：${t.updatedAt}${includeCandidates && t.candidates.length ? `\n\n#### 候補\n\n${t.candidates.map(candidateBlock).join("\n\n")}` : ""}`;
  const boughtBlock = (t: WishlistTheme) => `### ${md(t.title)}\n\n- カテゴリ：${t.category}\n- 買い物タイプ：${t.shoppingType}\n- 買った候補名：${md(t.purchasedCandidateName)}\n- 購入日：${md(t.purchasedDate)}\n- 購入価格：${t.purchasedPrice ?? ""}\n- 満足度：${t.satisfaction ? `${t.satisfaction}：${satLabels[t.satisfaction]}` : ""}\n- 買ってよかった理由：${md(t.goodAfterPurchase)}\n- 後悔メモ：${md(t.regretMemo)}\n- メモ：${md(t.memo)}`;
  const stoppedBlock = (t: WishlistTheme) => `### ${md(t.title)}\n\n- カテゴリ：${t.category}\n- 買い物タイプ：${t.shoppingType}\n- 欲しい理由：${md(t.reason)}\n- 欲しい条件：${md(t.conditions)}\n- メモ：${md(t.memo)}`;
  return `# 買いたいものリスト エクスポート\n\n## 出力情報\n\n- 出力日時：${now()}\n- 総テーマ数：${themes.length}\n- 探し中：${search.length}\n- 補充：${refill.length}\n- 買った：${bought.length}\n- やめた：${stopped.length}\n\n## カテゴリ別まとめ\n\n${countLines(themes, categories, (t) => t.category)}\n\n## 状態別まとめ\n\n${countLines(themes, statuses, (t) => t.status)}\n\n## 探し中・比較中のテーマ\n\n${search.map((t) => themeBlock(t)).join("\n\n") || "該当なし"}\n\n## 補充テーマ\n\n${refill.map((t) => themeBlock(t, false)).join("\n\n") || "該当なし"}\n\n## 買ったテーマ\n\n${bought.map(boughtBlock).join("\n\n") || "該当なし"}\n\n## やめたテーマ\n\n${stopped.map(stoppedBlock).join("\n\n") || "該当なし"}\n`;
};

function App() {
  const [themes, setThemes] = useState<WishlistTheme[]>(() => { try { return JSON.parse(localStorage.getItem(DATA_KEY) || "[]"); } catch { return []; } });
  const [activeView, setActiveView] = useState<ActiveView>(() => { const v = localStorage.getItem(VIEW_KEY); return v === "refill" || v === "bought" || v === "settings" || v === "search" ? v : "search"; });
  const [themeDraft, setThemeDraft] = useState<ThemeDraft>(emptyTheme("出会ったら買う"));
  const [editingThemeId, setEditingThemeId] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ "買う予定": true, "比較中": true, "探し中": true, "次回買う": true, "そろそろ買う": true });
  const [filters, setFilters] = useState({ keyword: "", category: "すべて", status: "すべて", shoppingType: "すべて", satisfaction: "すべて" });
  const [candidateDrafts, setCandidateDrafts] = useState<Record<string, CandidateDraft>>({});
  const [editingCandidates, setEditingCandidates] = useState<Record<string, string>>({});
  const [purchaseThemeId, setPurchaseThemeId] = useState("");
  const [purchaseDraft, setPurchaseDraft] = useState({ candidateId: "", purchasedDate: today(), purchasedPrice: "", satisfaction: "", goodAfterPurchase: "", regretMemo: "" });
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");
  useEffect(() => localStorage.setItem(DATA_KEY, JSON.stringify(themes)), [themes]);
  useEffect(() => localStorage.setItem(VIEW_KEY, activeView), [activeView]);
  const updateTheme = (id: string, fn: (theme: WishlistTheme) => WishlistTheme) => setThemes((all) => all.map((t) => t.id === id ? { ...fn(t), updatedAt: now() } : t));
  const submitTheme = (e: FormEvent) => { e.preventDefault(); if (!themeDraft.title.trim()) return; if (editingThemeId) { updateTheme(editingThemeId, (t) => ({ ...t, ...themeDraft, title: themeDraft.title.trim() })); setEditingThemeId(""); } else setThemes((all) => [createTheme(themeDraft), ...all]); setThemeDraft(emptyTheme(activeView === "refill" ? "補充する" : "出会ったら買う")); };
  const startEditTheme = (theme: WishlistTheme) => { setEditingThemeId(theme.id); setThemeDraft({ ...theme }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const deleteTheme = (id: string) => { if (confirm("このテーマを削除しますか？候補も一緒に削除されます。")) setThemes((all) => all.filter((t) => t.id !== id)); };
  const submitCandidate = (themeId: string, e: FormEvent) => { e.preventDefault(); const draft = candidateDrafts[themeId] ?? emptyCandidate(); if (!draft.name.trim()) return; const editingId = editingCandidates[themeId]; updateTheme(themeId, (theme) => ({ ...theme, candidates: editingId ? theme.candidates.map((c) => c.id === editingId ? { ...c, ...draft, name: draft.name.trim(), updatedAt: now() } : c) : [...theme.candidates, createCandidate(draft)] })); setCandidateDrafts((d) => ({ ...d, [themeId]: emptyCandidate() })); setEditingCandidates((d) => ({ ...d, [themeId]: "" })); };
  const startEditCandidate = (themeId: string, c: WishlistCandidate) => { setCandidateDrafts((d) => ({ ...d, [themeId]: { ...c } })); setEditingCandidates((d) => ({ ...d, [themeId]: c.id })); };
  const deleteCandidate = (themeId: string, candidateId: string) => { if (confirm("この候補を削除しますか？")) updateTheme(themeId, (t) => ({ ...t, candidates: t.candidates.filter((c) => c.id !== candidateId) })); };
  const startPurchase = (theme: WishlistTheme) => { setPurchaseThemeId(theme.id); setPurchaseDraft({ candidateId: theme.candidates[0]?.id ?? "", purchasedDate: today(), purchasedPrice: "", satisfaction: "", goodAfterPurchase: "", regretMemo: "" }); };
  const submitPurchase = (theme: WishlistTheme, e: FormEvent) => { e.preventDefault(); const c = theme.candidates.find((x) => x.id === purchaseDraft.candidateId); updateTheme(theme.id, (t) => ({ ...t, status: "買った", purchasedCandidateId: c?.id ?? "", purchasedCandidateName: c?.name ?? "", purchasedDate: purchaseDraft.purchasedDate, purchasedPrice: purchaseDraft.purchasedPrice ? Number(purchaseDraft.purchasedPrice) : null, satisfaction: purchaseDraft.satisfaction ? Number(purchaseDraft.satisfaction) as Satisfaction : null, goodAfterPurchase: purchaseDraft.goodAfterPurchase, regretMemo: purchaseDraft.regretMemo })); setPurchaseThemeId(""); setActiveView("bought"); };
  const visibleThemes = useMemo(() => themes.filter((t) => { if (activeView === "search" && (t.shoppingType === "補充する" || t.status === "買った")) return false; if (activeView === "refill" && (t.shoppingType !== "補充する" || t.status === "買った")) return false; if (activeView === "bought" && t.status !== "買った") return false; if (!matchesKeyword(t, filters.keyword)) return false; if (filters.category !== "すべて" && t.category !== filters.category) return false; if (filters.status !== "すべて" && t.status !== filters.status) return false; if (filters.shoppingType !== "すべて" && t.shoppingType !== filters.shoppingType) return false; if (filters.satisfaction !== "すべて" && String(t.satisfaction ?? "") !== filters.satisfaction) return false; return true; }), [themes, activeView, filters]);
  const downloadText = (filename: string, text: string, type: string) => { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); };
  const exportJson = () => downloadText(`wishlist-backup-${today()}.json`, JSON.stringify({ version: 1, themes, exportedAt: now() }, null, 2), "application/json");
  const exportMarkdown = () => downloadText(`wishlist-export-${today()}.md`, createMarkdown(themes), "text/markdown");
  const readImportFile = async (file?: File) => { setImportMessage(""); setImportPreview(null); if (file) setImportPreview(buildImportPreview(await file.text(), themes)); };
  const applyImport = () => { if (!importPreview || !importPreview.valid || importPreview.errorCount) return; setThemes((current) => { const withNewThemes = [...importPreview.themesToAdd, ...current]; return withNewThemes.map((theme) => { const add = importPreview.candidateAdds.find((g) => g.themeId === theme.id); return add ? { ...theme, candidates: [...theme.candidates, ...add.candidates], updatedAt: now() } : theme; }); }); setImportMessage(`追加したテーマ ${importPreview.newThemeCount} 件、追加した候補 ${importPreview.newCandidateCount} 件、重複テーマ ${importPreview.duplicateThemeCount} 件、重複候補 ${importPreview.duplicateCandidateCount} 件、エラー ${importPreview.errorCount} 件、警告 ${importPreview.warningCount} 件`); setImportPreview(null); };

  const renderThemeForm = (fixedType?: ShoppingType) => <form className="panel form" onSubmit={submitTheme}>
    <div className="panel-title"><ListPlus size={18} />{editingThemeId ? "テーマを編集" : "新規テーマ"}</div>
    <label>テーマ名<input value={themeDraft.title} onChange={(e) => setThemeDraft({ ...themeDraft, title: e.target.value })} required placeholder="ライトグレーのスウェット" /></label>
    <div className="grid-3"><label>買い物タイプ<select value={themeDraft.shoppingType} disabled={!!fixedType} onChange={(e) => setThemeDraft({ ...themeDraft, shoppingType: e.target.value as ShoppingType, status: e.target.value === "補充する" ? "そろそろ買う" : "探し中" })}>{shoppingTypes.map((v) => <option key={v}>{v}</option>)}</select></label><label>カテゴリ<select value={themeDraft.category} onChange={(e) => setThemeDraft({ ...themeDraft, category: e.target.value as Category })}>{categories.map((v) => <option key={v}>{v}</option>)}</select></label><label>状態<select value={themeDraft.status} onChange={(e) => setThemeDraft({ ...themeDraft, status: e.target.value as ThemeStatus })}>{statuses.map((v) => <option key={v}>{v}</option>)}</select></label></div>
    <label>欲しい理由<textarea value={themeDraft.reason} onChange={(e) => setThemeDraft({ ...themeDraft, reason: e.target.value })} /></label><label>欲しい条件<textarea value={themeDraft.conditions} onChange={(e) => setThemeDraft({ ...themeDraft, conditions: e.target.value })} /></label>
    <div className="grid-3"><label>予算感<input value={themeDraft.budget} onChange={(e) => setThemeDraft({ ...themeDraft, budget: e.target.value })} /></label><label>必要度<select value={themeDraft.needLevel} onChange={(e) => setThemeDraft({ ...themeDraft, needLevel: e.target.value as NeedLevel })}>{needLevels.map((v) => <option key={v}>{v}</option>)}</select></label><label>優先度<select value={themeDraft.priority} onChange={(e) => setThemeDraft({ ...themeDraft, priority: e.target.value as Priority })}>{priorities.map((v) => <option key={v}>{v}</option>)}</select></label></div>
    <label>買うタイミング<input value={themeDraft.buyingTiming} onChange={(e) => setThemeDraft({ ...themeDraft, buyingTiming: e.target.value })} /></label><label>メモ<textarea value={themeDraft.memo} onChange={(e) => setThemeDraft({ ...themeDraft, memo: e.target.value })} /></label>
    <div className="actions"><button className="primary" type="submit"><Plus size={16} />{editingThemeId ? "保存する" : "登録する"}</button>{editingThemeId && <button type="button" onClick={() => { setEditingThemeId(""); setThemeDraft(emptyTheme(activeView === "refill" ? "補充する" : "出会ったら買う")); }}><RotateCcw size={16} />キャンセル</button>}</div>
  </form>;
  const renderFilters = () => <div className="panel filters"><label className="search-box"><Search size={18} /><input value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} placeholder="キーワード検索" /></label><select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}><option>すべて</option>{categories.map((v) => <option key={v}>{v}</option>)}</select>{activeView !== "bought" && <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option>すべて</option>{statuses.map((v) => <option key={v}>{v}</option>)}</select>}{activeView === "search" && <select value={filters.shoppingType} onChange={(e) => setFilters({ ...filters, shoppingType: e.target.value })}><option>すべて</option><option>出会ったら買う</option><option>比較して買う</option></select>}{activeView === "bought" && <select value={filters.satisfaction} onChange={(e) => setFilters({ ...filters, satisfaction: e.target.value })}><option>すべて</option>{sats.map((v) => <option key={v} value={v}>{v}：{satLabels[v]}</option>)}</select>}</div>;

  const renderCandidateForm = (theme: WishlistTheme) => { const d = candidateDrafts[theme.id] ?? emptyCandidate(); const editing = editingCandidates[theme.id]; return <form className="candidate-form" onSubmit={(e) => submitCandidate(theme.id, e)}><input value={d.name} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, name: e.target.value } })} placeholder="候補名" /><input type="number" value={d.price ?? ""} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, price: e.target.value ? Number(e.target.value) : null } })} placeholder="価格" /><input value={d.shop} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, shop: e.target.value } })} placeholder="店舗・サイト" /><input value={d.url} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, url: e.target.value } })} placeholder="リンク" /><textarea value={d.goodPoints} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, goodPoints: e.target.value } })} placeholder="よさそうな点" /><textarea value={d.concerns} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, concerns: e.target.value } })} placeholder="気になる点" /><select value={d.rating} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, rating: e.target.value as CandidateRating } })}>{ratings.map((v) => <option key={v}>{v}</option>)}</select><textarea value={d.memo} onChange={(e) => setCandidateDrafts({ ...candidateDrafts, [theme.id]: { ...d, memo: e.target.value } })} placeholder="候補メモ" /><div className="actions"><button type="submit"><Plus size={16} />{editing ? "候補を保存" : "候補を追加"}</button>{editing && <button type="button" onClick={() => { setCandidateDrafts({ ...candidateDrafts, [theme.id]: emptyCandidate() }); setEditingCandidates({ ...editingCandidates, [theme.id]: "" }); }}>キャンセル</button>}</div></form>; };

  const renderPurchaseForm = (theme: WishlistTheme) => <form className="purchase-box" onSubmit={(e) => submitPurchase(theme, e)}>{theme.candidates.length > 0 ? <label>買った候補<select value={purchaseDraft.candidateId} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, candidateId: e.target.value })}>{theme.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : <p>候補がないため、テーマそのものを買った扱いにします。</p>}<div className="grid-3"><label>購入日<input type="date" value={purchaseDraft.purchasedDate} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, purchasedDate: e.target.value })} /></label><label>購入価格<input type="number" value={purchaseDraft.purchasedPrice} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, purchasedPrice: e.target.value })} /></label><label>満足度<select value={purchaseDraft.satisfaction} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, satisfaction: e.target.value })}><option value="">未入力</option>{sats.map((v) => <option key={v} value={v}>{v}：{satLabels[v]}</option>)}</select></label></div><label>買ってよかった理由<textarea value={purchaseDraft.goodAfterPurchase} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, goodAfterPurchase: e.target.value })} /></label><label>後悔メモ<textarea value={purchaseDraft.regretMemo} onChange={(e) => setPurchaseDraft({ ...purchaseDraft, regretMemo: e.target.value })} /></label><div className="actions"><button className="primary" type="submit"><CheckCircle2 size={16} />買ったにする</button><button type="button" onClick={() => setPurchaseThemeId("")}>キャンセル</button></div></form>;

  const renderThemeCard = (theme: WishlistTheme) => { const best = theme.candidates.find((c) => c.rating === "有力"); return <article className="theme-card" key={theme.id}><div className="card-head"><div><h3>{theme.title}</h3><p>{theme.category} / {theme.shoppingType} / {theme.status}</p></div><div className="actions compact"><button onClick={() => startEditTheme(theme)}>編集</button><button onClick={() => deleteTheme(theme.id)}><Trash2 size={15} /></button></div></div>{activeView === "bought" ? <div className="info-grid"><span>買った候補</span><b>{candidateName(theme)}</b><span>購入日</span><b>{fmtDate(theme.purchasedDate)}</b><span>購入価格</span><b>{fmtPrice(theme.purchasedPrice)}</b><span>満足度</span><b>{theme.satisfaction ? `${theme.satisfaction}：${satLabels[theme.satisfaction]}` : ""}</b><span>よかった理由</span><p>{theme.goodAfterPurchase}</p><span>後悔メモ</span><p>{theme.regretMemo}</p><span>メモ</span><p>{theme.memo}</p></div> : theme.shoppingType === "補充する" ? <div className="info-grid"><span>買うタイミング</span><b>{theme.buyingTiming}</b><span>メモ</span><p>{theme.memo}</p><span>更新日</span><b>{fmtDate(theme.updatedAt)}</b></div> : <div className="info-grid"><span>予算感</span><b>{theme.budget}</b><span>欲しい条件</span><p>{theme.conditions}</p><span>候補件数</span><b>{theme.candidates.length}件</b><span>有力候補</span><b>{best?.name ?? ""}</b><span>メモ</span><p>{theme.memo}</p></div>}{activeView !== "bought" && <div className="actions"><button className="primary" onClick={() => startPurchase(theme)}><PackageCheck size={16} />購入処理</button></div>}{purchaseThemeId === theme.id && renderPurchaseForm(theme)}<details className="candidates"><summary>候補 {theme.candidates.length}件</summary>{theme.candidates.map((c) => <div className="candidate" key={c.id}><div><b>{c.name}</b><p>{fmtPrice(c.price)} {c.shop} / {c.rating}</p><p>{c.goodPoints}</p><p className="muted">{c.concerns}</p>{c.url && <a href={c.url} target="_blank" rel="noreferrer">リンクを開く</a>}</div><div className="actions compact"><button onClick={() => startEditCandidate(theme.id, c)}>編集</button><button onClick={() => deleteCandidate(theme.id, c.id)}><Trash2 size={15} /></button></div></div>)}{renderCandidateForm(theme)}</details></article>; };

  const renderGrouped = (groups: ThemeStatus[]) => groups.map((status) => { const items = visibleThemes.filter((t) => t.status === status); const open = openGroups[status] ?? false; return <section className="group" key={status}><button className="group-toggle" onClick={() => setOpenGroups({ ...openGroups, [status]: !open })}>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<span>{status}</span><b>{items.length}</b></button>{open && <div className="card-list">{items.map(renderThemeCard)}{items.length === 0 && <p className="empty">該当するテーマはありません。</p>}</div>}</section>; });
  const renderSettings = () => <div className="settings-view"><section className="panel"><div className="panel-title"><Download size={18} />データ出力</div><div className="actions"><button className="primary" onClick={exportJson}>JSONエクスポート</button><button onClick={exportMarkdown}>Markdownエクスポート</button></div><p className="note">JSONは保存・復元用、Markdownは人間やAIが読んで振り返るための形式です。</p></section><section className="panel"><div className="panel-title"><Archive size={18} />追加型JSONインポート</div><input type="file" accept="application/json,.json" onChange={(e) => readImportFile(e.target.files?.[0])} />{importPreview && <div className="preview"><b>インポート前プレビュー</b><div className="stats"><span>読み込み件数: {importPreview.rawCount}</span><span>新規追加テーマ: {importPreview.newThemeCount}</span><span>新規追加候補: {importPreview.newCandidateCount}</span><span>重複テーマ: {importPreview.duplicateThemeCount}</span><span>重複候補: {importPreview.duplicateCandidateCount}</span><span>エラー: {importPreview.errorCount}</span><span>警告: {importPreview.warningCount}</span></div>{importPreview.errors.map((x) => <p className="error" key={x}>{x}</p>)}{importPreview.warnings.slice(0, 8).map((x) => <p className="warning" key={x}>{x}</p>)}<button className="primary" disabled={!importPreview.valid || importPreview.errorCount > 0} onClick={applyImport}>新規データだけ追加する</button></div>}{importMessage && <p className="success">{importMessage}</p>}</section><section className="panel"><div className="panel-title"><Settings size={18} />保存キーと注意</div><p>データ保存キー：<code>{DATA_KEY}</code></p><p>最後に開いていた画面：<code>{VIEW_KEY}</code></p><ul><li>このアプリのデータは、このブラウザ内の localStorage に保存されます。</li><li>PCとスマホで自動同期はされません。</li><li>JSONエクスポートで定期的にバックアップしてください。</li><li>JSONバックアップやMarkdownエクスポートには個人データが含まれる可能性があるため、GitHubや公開フォルダには入れないでください。</li></ul></section></div>;
  const nav = [{ id: "search" as ActiveView, label: "探し中", icon: ShoppingBag }, { id: "refill" as ActiveView, label: "補充", icon: RotateCcw }, { id: "bought" as ActiveView, label: "買った", icon: CheckCircle2 }, { id: "settings" as ActiveView, label: "設定", icon: Settings }];
  return <div className="app-shell"><header><h1>買いたいものリスト</h1><p>欲しい気持ちを一度置いて、比較したりタイミングを見たりしながら納得して買うためのリスト。</p></header><main>{activeView === "search" && <>{renderThemeForm()} {renderFilters()} {renderGrouped(searchGroups)}</>}{activeView === "refill" && <>{renderThemeForm("補充する")} {renderFilters()} {renderGrouped(refillGroups)}</>}{activeView === "bought" && <>{renderFilters()} <div className="card-list">{visibleThemes.map(renderThemeCard)}{visibleThemes.length === 0 && <p className="empty">買ったテーマはまだありません。</p>}</div></>}{activeView === "settings" && renderSettings()}</main><nav className="bottom-nav">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={activeView === id ? "active" : ""} onClick={() => { setActiveView(id); setEditingThemeId(""); setThemeDraft(emptyTheme(id === "refill" ? "補充する" : "出会ったら買う")); }}><Icon size={20} /><span>{label}</span></button>)}</nav></div>;
}

export default App;
