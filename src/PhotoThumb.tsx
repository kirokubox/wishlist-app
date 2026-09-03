import { useEffect, useState } from "react";
import { getPhoto } from "./photoStore";

// ---------- 写真表示 ----------

export const photoUrlCache = new Map<string, string>();

// 「写真なし」（IDなし）と「読込失敗」（IDはあるがBlobを取り出せない）を区別して表示する。
// 読込失敗はタップで再試行できる。区別することで、保存不具合が起きたときに気づきやすくする。
export function PhotoThumb({ photoId, className, onClick }: { photoId: string | null; className: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string | null>(photoId ? photoUrlCache.get(photoId) ?? null : null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    if (!photoId) {
      setUrl(null);
      return;
    }
    const cached = photoUrlCache.get(photoId);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    let cancelled = false;
    getPhoto(photoId)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setFailed(true);
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        photoUrlCache.set(photoId, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [photoId, attempt]);
  if (!photoId) return <div className={`photo-placeholder ${className}`}>写真なし</div>;
  if (failed) return <div className={`photo-placeholder photo-failed ${className}`} onClick={() => setAttempt((a) => a + 1)} role="button">読込失敗<br />再試行</div>;
  if (!url) return <div className={`photo-placeholder ${className}`}>…</div>;
  return <img src={url} alt="" className={className} onClick={onClick} loading="lazy" />;
}
