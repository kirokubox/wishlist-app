import { latestPriceChange, normalizePriceHistory, sortPriceHistory } from "../src/priceHistory.js";

function equal(actual: unknown, expected: unknown, name: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

equal(normalizePriceHistory(undefined), [], "旧候補の値段履歴なしは空配列");

{
  const records = normalizePriceHistory([
    { id: "a", date: "2026-11-03", price: 3000, createdAt: "2026-11-03T10:00:00.000Z" },
    { id: "b", date: "2026-11-15", price: 2500, createdAt: "2026-11-15T10:00:00.000Z" },
    { id: "bad", date: "", price: 1000 },
  ]);
  equal(records.map((record) => record.id), ["b", "a"], "新しい日付順と壊れた行の除外");
  equal(latestPriceChange(records), { amount: -500, date: "2026-11-15" }, "前回との差");
}

{
  const one = [{ id: "a", date: "2026-11-15", price: 2500, createdAt: "2026-11-15T10:00:00.000Z" }];
  equal(latestPriceChange(one), null, "1件だけなら差なし");
  equal(latestPriceChange(sortPriceHistory([...one, { ...one[0], id: "b", date: "2026-11-01" }])), null, "同額なら差なし");
}

console.log("priceHistory: 3項目の検証に成功");
