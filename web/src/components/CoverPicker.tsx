import { Check, ImagePlus } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "../context";
import { compressCover, COVERS, UPLOAD } from "../lib/covers";
import { getSettings, saveSettings, saveUploadedCover, uploadedCover } from "../lib/model";

/** The paintings to choose from, and her own picture. */
export function CoverPicker({
  compress = compressCover,
}: {
  compress?: (file: Blob) => Promise<string>;
}) {
  const { engine } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = getSettings(engine).cover;
  const uploaded = uploadedCover(engine);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      saveUploadedCover(engine, await compress(file));
    } catch {
      setError("这张图片用不了，换一张试试");
    } finally {
      setBusy(false);
    }
  };

  const tile = (selected: boolean) =>
    `relative aspect-[600/860] overflow-hidden rounded-md shadow-sm transition ${
      selected
        ? "ring-accent ring-2 ring-offset-2 ring-offset-[var(--moli-surface)]"
        : "hover:opacity-90"
    }`;

  return (
    <div>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {COVERS.map((cover) => (
          <li key={cover.id}>
            <button
              type="button"
              aria-pressed={current === cover.id}
              aria-label={`${cover.artist}《${cover.name}》`}
              onClick={() => saveSettings(engine, { cover: cover.id })}
              className={`${tile(current === cover.id)} w-full`}
            >
              <img
                src={`/covers/${cover.id}.webp`}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
              {current === cover.id && (
                <span className="bg-accent text-accent-fg absolute top-1 right-1 rounded-full p-0.5">
                  <Check size={12} aria-hidden="true" />
                </span>
              )}
            </button>
            <p className="text-muted mt-1 truncate text-center text-[11px]">{cover.name}</p>
          </li>
        ))}
        <li>
          <button
            type="button"
            aria-pressed={current === UPLOAD}
            aria-label={uploaded ? "我的图片" : "上传图片"}
            onClick={() =>
              uploaded && current !== UPLOAD
                ? saveSettings(engine, { cover: UPLOAD })
                : input.current?.click()
            }
            className={`${tile(current === UPLOAD)} border-border bg-surface-2 text-muted flex w-full items-center justify-center border border-dashed`}
          >
            {uploaded ? (
              <img src={uploaded} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <ImagePlus size={22} aria-hidden="true" />
            )}
          </button>
          <p className="text-muted mt-1 truncate text-center text-[11px]">
            {busy ? "处理中…" : uploaded ? "我的图片" : "上传"}
          </p>
        </li>
      </ul>
      {uploaded && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-accent-ink mt-3 text-xs"
        >
          换一张我的图片
        </button>
      )}
      {error && <p className="text-danger mt-2 text-xs">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="选择图片"
        className="hidden"
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
