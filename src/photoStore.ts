// 候補写真の保存先（IndexedDB）。
// 写真はJSONバックアップに含めない方針のため、テキストデータ（localStorage）とは保存場所を分ける。
// photoId をキーに Blob を1枚ずつ保存し、候補側は photoId だけを持つ。
//
// 2026-07-18 堅牢化：実機（Android Chrome）で「保存成功扱いなのに写真が残らない」事象が出たため、
// - put はリクエスト成功ではなくトランザクションの確定（oncomplete）まで待つ
// - 保存後に読み戻して本当に取り出せるか検証する
// - 失敗は握りつぶさず、エラー内容を呼び出し側へ伝える
// という構成にしている。

const DB_NAME = "yuki-wishlist-photos";
const STORE_NAME = "photos";

let dbPromise: Promise<IDBDatabase> | null = null;
let persistRequested = false;

const openDb = (): Promise<IDBDatabase> => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // 予期しないclose（他タブでの削除など）後に再接続できるよう、キャッシュを捨てる
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした"));
    });
    // open失敗をキャッシュしたままにすると二度と復帰できないため、失敗時はキャッシュを捨てる
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
};

// ブラウザによるサイトデータの自動削除（追い出し）を減らすため、一度だけ永続化を要求する。
// 拒否されても動作には影響しない。
const requestPersistOnce = () => {
  if (persistRequested) return;
  persistRequested = true;
  navigator.storage?.persist?.().catch(() => {});
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error ?? "不明なエラー");
};

export const getPhoto = async (id: string): Promise<Blob | null> => {
  const db = await openDb();
  const result = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("写真の読み込みに失敗しました"));
  });
  return result instanceof Blob ? result : null;
};

// 保存はトランザクション確定まで待ち、さらに読み戻して検証する。
// リクエスト成功だけ見て安心すると、commit時の失敗（容量・読めないBlob等）を取りこぼす。
export const putPhoto = async (id: string, blob: Blob): Promise<void> => {
  requestPersistOnce();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    let requestError: unknown = null;
    const request = tx.objectStore(STORE_NAME).put(blob, id);
    request.onerror = () => {
      requestError = request.error;
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? requestError ?? new Error("写真の保存が確定できませんでした（transaction abort）"));
    tx.onerror = () => reject(tx.error ?? requestError ?? new Error("写真の保存に失敗しました（transaction error)"));
  });
  const stored = await getPhoto(id);
  if (!stored) throw new Error("保存後の読み戻し検証に失敗しました（写真が残っていません）");
};

export const deletePhoto = async (id: string): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("写真の削除に失敗しました"));
    tx.onerror = () => reject(tx.error ?? new Error("写真の削除に失敗しました"));
  });
};

const drawToJpeg = (source: ImageBitmap | HTMLImageElement, width: number, height: number): Promise<Blob> => {
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvasを利用できません");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("JPEGへの変換に失敗しました"))), "image/jpeg", 0.82);
  });
};

// FileReaderで先にメモリへ読み込んでからImage要素でデコードするフォールバック。
// createImageBitmapが使えない・失敗する端末向け。
const decodeViaImageElement = async (file: File): Promise<Blob> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("ファイルを読み込めませんでした"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像としてデコードできませんでした"));
    img.src = dataUrl;
  });
  return drawToJpeg(image, image.naturalWidth, image.naturalHeight);
};

// 撮影写真は数MBあるため、保存前に長辺1280px・JPEGへ圧縮する。
// 失敗しても元Fileを返さない（Androidでは選択ファイルが後から読めなくなることがあり、
// 読めないFileをIndexedDBへ入れると保存が静かに失敗するため）。読めない場合は例外を投げる。
export const compressImage = async (file: File): Promise<Blob> => {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return await drawToJpeg(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch (primaryError) {
    try {
      return await decodeViaImageElement(file);
    } catch (fallbackError) {
      throw new Error(`写真を読み込めませんでした（${errorMessage(primaryError)} ／ ${errorMessage(fallbackError)}）`);
    }
  }
};

export { errorMessage as photoErrorMessage };
