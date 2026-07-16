// 候補写真の保存先（IndexedDB）。
// 写真はJSONバックアップに含めない方針のため、テキストデータ（localStorage）とは保存場所を分ける。
// photoId をキーに Blob を1枚ずつ保存し、候補側は photoId だけを持つ。

const DB_NAME = "yuki-wishlist-photos";
const STORE_NAME = "photos";

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
};

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const putPhoto = (id: string, blob: Blob) => withStore("readwrite", (store) => store.put(blob, id));

export const getPhoto = async (id: string): Promise<Blob | null> => {
  const result = await withStore<Blob | undefined>("readonly", (store) => store.get(id) as IDBRequest<Blob | undefined>);
  return result instanceof Blob ? result : null;
};

export const deletePhoto = (id: string) => withStore("readwrite", (store) => store.delete(id));

// 撮影写真は数MBあるため、保存前に長辺1280px・JPEGへ圧縮する。
// 変換に失敗した端末・形式では元ファイルをそのまま保存する（保存できないよりよい）。
export const compressImage = async (file: File): Promise<Blob> => {
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("toBlob failed");
    return blob;
  } catch {
    return file;
  }
};
