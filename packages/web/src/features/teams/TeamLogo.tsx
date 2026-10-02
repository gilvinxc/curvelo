import { useState } from "react";
import { api } from "../../lib/api";

/** Team logo with an initials fallback. */
export function TeamLogo({
  teamId,
  teamName,
  hasLogo,
  size = 48,
  version,
}: {
  teamId: string;
  teamName: string;
  hasLogo: boolean;
  size?: number;
  /** Bump to bust the browser cache after an upload/remove. */
  version?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initials = teamName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (!hasLogo || failed) {
    return (
      <div
        aria-hidden
        className="flex shrink-0 items-center justify-center rounded-xl bg-volt-400 font-extrabold text-ink-950"
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {initials || "T"}
      </div>
    );
  }
  return (
    <img
      src={version ? `${api.teamLogoUrl(teamId)}?v=${version}` : api.teamLogoUrl(teamId)}
      alt={`${teamName} logo`}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-xl object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/** Read a file, resize it client-side, return a JPEG data URL. */
export function resizeImageFile(file: File, maxDim = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not available"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}
