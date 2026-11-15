export type CandidatePriceRecord = {
  id: string;
  date: string;
  price: number;
  createdAt: string;
};

const asString = (value: unknown) => typeof value === "string" ? value : "";
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** 旧候補（項目なし）と形の崩れたバックアップを安全に空配列・有効な記録へそろえる。 */
export function normalizePriceHistory(value: unknown): CandidatePriceRecord[] {
  if (!Array.isArray(value)) return [];
  const records: CandidatePriceRecord[] = [];
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as Record<string, unknown>;
    const date = asString(item.date).slice(0, 10);
    const price = typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0 ? item.price : null;
    if (!isDate(date) || price === null) return;
    records.push({
      id: asString(item.id) || `price-${date}-${index}`,
      date,
      price,
      createdAt: asString(item.createdAt) || `${date}T00:00:00.000Z`,
    });
  });
  return sortPriceHistory(records);
}

export function sortPriceHistory(records: CandidatePriceRecord[]): CandidatePriceRecord[] {
  return [...records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function latestPriceChange(records: CandidatePriceRecord[]): { amount: number; date: string } | null {
  const sorted = sortPriceHistory(records);
  if (sorted.length < 2) return null;
  const amount = sorted[0].price - sorted[1].price;
  return amount === 0 ? null : { amount, date: sorted[0].date };
}
