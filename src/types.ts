// ---------- 型 ----------

export type Category = "服" | "家電" | "ガジェット" | "日用品" | "家具・インテリア" | "趣味" | "美容・身だしなみ" | "その他";
export type ThemeStatus = "未購入" | "買った" | "やめた";
export type Satisfaction = 1 | 2 | 3 | 4 | 5;
export type ActiveView = "search" | "refill" | "bought" | "settings";

// 候補写真は「値札・全体・試着」のラベル付き3スロット（各1枚・どれか1枚以上必須）
export type PhotoSlot = "tag" | "overall" | "fitting";
export type CandidatePhotos = Record<PhotoSlot, string | null>;

export type WishlistCandidate = {
  id: string;
  shop: string;
  price: number | null;
  memo: string;
  photos: CandidatePhotos;
  createdAt: string;
  updatedAt: string;
};

export type WishlistTheme = {
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
export type RefillItem = {
  id: string;
  name: string;
  intervalMonths: number;
  purchases: string[]; // YYYY-MM-DD、新しい順
  resurfacedAt: string | null; // 「今すぐ表示」で手動再表示したローカル日付（YYYY-MM-DD）。購入日と同じ形式で比較する
  createdAt: string;
  updatedAt: string;
};

export type WishlistData = { themes: WishlistTheme[]; refillItems: RefillItem[] };
