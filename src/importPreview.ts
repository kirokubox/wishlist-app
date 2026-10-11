import { photoIdList } from "./helpers";
import { parseStoredData } from "./storage";
import type { RefillItem, WishlistCandidate, WishlistData, WishlistTheme } from "./types";

// ---------- 追加型インポート ----------

export type ImportPreview = {
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

export const sameTheme = (a: WishlistTheme, b: WishlistTheme) => a.id === b.id || (a.title === b.title && a.createdAt === b.createdAt);
export const sameCandidate = (a: WishlistCandidate, b: WishlistCandidate) => a.id === b.id || (a.shop === b.shop && a.price === b.price && a.createdAt === b.createdAt);
export const sameRefill = (a: RefillItem, b: RefillItem) => a.id === b.id || (a.name === b.name && a.createdAt === b.createdAt);

export const buildImportPreview = (text: string, existing: WishlistData): ImportPreview => {
  const fail = (message: string): ImportPreview => ({ valid: false, errors: [message], warnings: [], newThemes: [], candidateAdds: [], newRefills: [], duplicateThemeCount: 0, duplicateCandidateCount: 0, duplicateRefillCount: 0 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("バックアップとして読み込めませんでした。ファイルを選び直してください");
  }
  const incoming = parseStoredData(parsed);
  if (!incoming) return fail("買いものリストのバックアップではありません");
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
