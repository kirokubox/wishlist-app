import { purchaseYears, refillInterval, refillIntervalLabel, yearlySummary } from "../src/yearlySummary.js";
import type { RefillItem, WishlistTheme } from "../src/types.js";

function equal(actual: unknown, expected: unknown, name: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

const item = (id: string, date: string, price: number | null, createdAt: string): WishlistTheme => ({
  id, title: id, category: "趣味", status: "買った", purchasedDate: date, purchasedPrice: price,
  satisfaction: 5, createdAt, updatedAt: createdAt, releaseDate: "", reason: "", memo: "", purchaseNote: "", purchasedCandidateId: "", candidates: [],
});
const themes = [item("A", "2026-01-11", 1000, "2026-01-01T12:00:00Z"), item("B", "2026-12-22", null, "2026-12-02T12:00:00Z"), item("old", "2025-12-31", 500, "2025-12-01T12:00:00Z")];
const refill = { id: "r", name: "洗剤", purchases: ["2026-04-01", "2026-01-01"], intervalMonths: 3 } as RefillItem;
equal(purchaseYears(themes), [2025, 2026], "購入日の暦年だけを表示");
const summary = yearlySummary(themes, 2026);
equal([summary.count, summary.totalPrice, summary.missingPrices, summary.medianDays, summary.longest?.title], [2, 1000, 1, 15, "B"], "年の金額と購入までの日数");
equal(refillInterval(refill), { averageDays: 90, count: 2 }, "補充の実際の購入間隔（すべての購入から）");
equal(refillIntervalLabel(refill), "実際 約3.0か月", "補充の間隔の表示");
equal(refillInterval({ ...refill, purchases: ["2026-04-01"] }), null, "1回だけなら出さない");
equal(refillInterval({ ...refill, purchases: ["2026-04-01", "2026-04-01"] }), null, "同じ日の重複は1回として数える");
