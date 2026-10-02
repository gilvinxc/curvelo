import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Loads a team photo with the user's session (cookies) and renders it via an
 * object URL, since plain <img> tags can't attach credentials cross-origin.
 */
export function PhotoImg({
  photoId,
  alt,
  className,
}: {
  photoId: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setSrc(null);
    setFailed(false);
    fetch(api.photoFileUrl(photoId), { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        return res.blob();
      })
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoId]);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-white/5 text-[13px] text-mist/60 ${className ?? ""}`}
      >
        Photo unavailable
      </div>
    );
  }
  if (!src) {
    return <div className={`animate-pulse bg-white/5 ${className ?? ""}`} />;
  }
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}
