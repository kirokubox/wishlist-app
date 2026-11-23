import type { Category, RefillItem, Satisfaction, WishlistTheme } from "./types.js";

const dayNumber = (date: string): number | null => {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

const localCreatedDay = (stamp: string): string => {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function purchaseYears(themes: readonly WishlistTheme[]): number[] {
  return [...new Set(themes.filter((item) => item.status === "買った" && /^\d{4}-\d{2}-\d{2}$/.test(item.purchasedDate)).map((item) => Number(item.purchasedDate.slice(0, 4))))].sort((a, b) => a - b);
}

export function yearlySummary(themes: readonly WishlistTheme[], year: number) {
  const items = themes.filter((item) => item.status === "買った" && item.purchasedDate.startsWith(`${year}-`));
  const priced = items.filter((item) => item.purchasedPrice !== null);
  const categoryTotals = new Map<Category, number>();
  const satisfactionCounts = new Map<Satisfaction, number>();
  const leadTimes: { title: string; days: number }[] = [];
  for (const item of items) {
    if (item.purchasedPrice !== null) categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.purchasedPrice);
    if (item.satisfaction !== null) satisfactionCounts.set(item.satisfaction, (satisfactionCounts.get(item.satisfaction) ?? 0) + 1);
    const start = dayNumber(localCreatedDay(item.createdAt));
    const end = dayNumber(item.purchasedDate);
    if (start !== null && end !== null && end >= start) leadTimes.push({ title: item.title, days: end - start });
  }
  leadTimes.sort((a, b) => a.days - b.days);
  const middle = Math.floor(leadTimes.length / 2);
  const medianDays = leadTimes.length === 0 ? null : leadTimes.length % 2 ? leadTimes[middle].days : (leadTimes[middle - 1].days + leadTimes[middle].days) / 2;
  return { year, count: items.length, totalPrice: priced.reduce((sum, item) => sum + item.purchasedPrice!, 0), missingPrices: items.length - priced.length,
    categoryTotals: [...categoryTotals].sort((a, b) => b[1] - a[1]), satisfactionCounts,
    medianDays, longest: leadTimes[leadTimes.length - 1] ?? null };
}

/**
 * 補充品の実際の買う間隔（すべての購入から。年で区切らない）。2回以上買った品目だけ。
 * 2026-11-23：「今年買ったもの」から補充品の画面へ移した（本人「移す」）。
 */
export function refillInterval(item: RefillItem): { averageDays: number; count: number } | null {
  const dates = [...new Set(item.purchases.map(dayNumber).filter((day): day is number => day !== null))].sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const intervals = dates.slice(1).map((day, index) => day - dates[index]);
  return { averageDays: intervals.reduce((sum, days) => sum + days, 0) / intervals.length, count: dates.length };
}

/** 画面用：「実際 約3.4か月」（1か月＝30.44日で月にそろえる。小数1桁） */
export function refillIntervalLabel(item: RefillItem): string | null {
  const interval = refillInterval(item);
  return interval ? `実際 約${(interval.averageDays / 30.44).toFixed(1)}か月` : null;
}
