import { fmtDate, fmtPrice, isRefillVisible, lastPurchase, nextShowDate, now, photoSlots, satLabels } from "./helpers";
import type { RefillItem, WishlistCandidate, WishlistData, WishlistTheme } from "./types";

// ---------- Markdownエクスポート ----------

export const md = (v: unknown) => String(v ?? "").replaceAll("\r", " ").replaceAll("\n", " ").trim();

export const createMarkdown = ({ themes, refillItems }: WishlistData) => {
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
