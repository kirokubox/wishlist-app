import { photoIdList } from "./helpers";
import { getPhotos } from "./photoStore";
import { parseStoredData } from "./storage";
import type { WishlistData } from "./types";
import { createZipBlob, readZipEntries } from "./zip";

const JSON_NAME = "wishlist-backup.json";
const photoPath = (id: string) => `photos/${id}.jpg`;

export function referencedPhotoIds(data: WishlistData): string[] {
  return [...new Set(data.themes.flatMap((theme) => theme.candidates.flatMap((candidate) => photoIdList(candidate.photos))))];
}

export async function buildPhotoBackup(data: WishlistData, exportedAt: string, date: string): Promise<{ blob: Blob; fileName: string; photoCount: number }> {
  const ids = referencedPhotoIds(data);
  const photos = await getPhotos(ids);
  const missing = ids.filter((id) => !photos.has(id));
  if (missing.length > 0) throw new Error(`保存場所から読み出せない写真が${missing.length}枚あります。候補の写真を開けるか確認してください。`);
  const json = JSON.stringify({ version: 4, themes: data.themes, refillItems: data.refillItems, exportedAt }, null, 2);
  const files = [
    { path: JSON_NAME, blob: new Blob([json], { type: "application/json" }) },
    ...ids.map((id) => ({ path: photoPath(id), blob: photos.get(id)! })),
  ];
  return { blob: await createZipBlob(files, new Date(exportedAt)), fileName: `wishlist-backup-with-photos-${date}.zip`, photoCount: ids.length };
}

export async function readPhotoBackup(file: Blob): Promise<{ data: WishlistData; photos: Map<string, Blob>; photoCount: number }> {
  const entries = await readZipEntries(file);
  const json = entries.find((entry) => entry.path.replace(/^.*\//, "") === JSON_NAME);
  if (!json) throw new Error(`ZIPの中に ${JSON_NAME} がありません`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await json.blob.text());
  } catch {
    throw new Error("ZIPのバックアップデータを読めませんでした");
  }
  const data = parseStoredData(parsed);
  if (!data) throw new Error("買いものリストのバックアップではありません");
  const root = json.path.slice(0, json.path.length - JSON_NAME.length);
  const entriesByPath = new Map(entries.map((entry) => [entry.path.slice(root.length), entry.blob]));
  const ids = referencedPhotoIds(data);
  const photos = new Map<string, Blob>();
  const missing: string[] = [];
  for (const id of ids) {
    const blob = entriesByPath.get(photoPath(id));
    if (blob) photos.set(id, blob.type === "image/jpeg" ? blob : new Blob([blob], { type: "image/jpeg" }));
    else missing.push(id);
  }
  if (missing.length > 0) throw new Error(`ZIPの中に写真が${missing.length}枚足りません。壊れていないバックアップを選んでください。`);
  return { data, photos, photoCount: photos.size };
}
