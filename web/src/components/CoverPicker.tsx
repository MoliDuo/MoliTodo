import { Check, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { compressCover, visibleCovers } from "../lib/covers";
import {
  canUploadCover,
  getSettings,
  removeCover,
  restoreCovers,
  saveSettings,
  saveUploadedCover,
  uploadedCovers,
} from "../lib/model";
import { LONG_PRESS_MS } from "../lib/reorder";
import { ColorPicker } from "./ColorPicker";

/** The colour of the book's case, on its own or the same as the theme colour. */
export function CaseColorPicker() {
  const { engine } = useApp();
  return (
    <ColorPicker
      value={getSettings(engine).caseColor ?? null}
      noneLabel="跟主题色一样"
      onChange={(color) => saveSettings(engine, { caseColor: color })}
    />
  );
}

/** A long press (or a right click) on a tile; a short tap stays a tap. */
function usePress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const firedRef = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return {
    firedRef,
    handlers: {
      onPointerDown: (event: React.PointerEvent) => {
        if (event.button !== 0) return;
        firedRef.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        stop();
        timer.current = setTimeout(() => {
          firedRef.current = true;
          navigator.vibrate?.(10);
          onLong();
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event: React.PointerEvent) => {
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8)
          stop();
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        if (!firedRef.current) onLong();
        firedRef.current = true;
      },
    },
  };
}

function Tile({
  label,
  name,
  src,
  selected,
  deleting,
  onPick,
  onAskDelete,
  onDelete,
}: {
  label: string;
  name: string;
  src: string;
  selected: boolean;
  deleting: boolean;
  onPick: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
}) {
  const { firedRef, handlers } = usePress(onAskDelete);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={label}
        {...handlers}
        onClick={() => {
          if (firedRef.current) return void (firedRef.current = false);
          onPick();
        }}
        className={`no-callout relative aspect-[600/860] w-full overflow-hidden rounded-md shadow-sm transition select-none ${
          selected
            ? "ring-accent ring-2 ring-offset-2 ring-offset-[var(--moli-surface)]"
            : "hover:opacity-90"
        } ${deleting ? "scale-95 opacity-80" : ""}`}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full object-cover"
          loading="lazy"
        />
        {selected && (
          <span className="bg-accent text-accent-fg absolute top-1 right-1 rounded-full p-0.5">
            <Check size={12} aria-hidden="true" />
          </span>
        )}
      </button>
      {deleting ? (
        <button
          type="button"
          aria-label={`删除${name}`}
          data-cover-delete=""
          onClick={onDelete}
          className="bg-danger mx-auto mt-1.5 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-white"
        >
          <Trash2 size={12} aria-hidden="true" /> 删除
        </button>
      ) : (
        <p className="text-muted mt-1 truncate text-center text-[11px]">{name}</p>
      )}
    </li>
  );
}

/** The paintings to choose from and her own pictures. A long press on one offers to delete it. */
export function CoverPicker({
  compress = compressCover,
}: {
  compress?: (file: Blob) => Promise<string>;
}) {
  const { engine } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const settings = getSettings(engine);
  const hidden = settings.hiddenCovers ?? [];
  const uploads = uploadedCovers(engine);

  // A tap anywhere else puts the delete button away.
  useEffect(() => {
    if (!deleting) return;
    const away = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.("[data-cover-delete]")) setDeleting(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [deleting]);

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

  const tile = (choice: string, label: string, name: string, src: string) => (
    <Tile
      key={choice}
      label={label}
      name={name}
      src={src}
      selected={settings.cover === choice}
      deleting={deleting === choice}
      onPick={() => {
        setDeleting(null);
        saveSettings(engine, { cover: choice });
      }}
      onAskDelete={() => setDeleting(choice)}
      onDelete={() => {
        setDeleting(null);
        removeCover(engine, choice);
      }}
    />
  );

  return (
    <div>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {visibleCovers(hidden).map((cover) =>
          tile(cover.id, `${cover.artist}《${cover.name}》`, cover.name, `/covers/${cover.id}.webp`)
        )}
        {uploads.map((cover, i) =>
          tile(
            cover.choice,
            uploads.length > 1 ? `我的图片 ${i + 1}` : "我的图片",
            "我的图片",
            cover.image
          )
        )}
        {canUploadCover(engine) && (
          <li>
            <button
              type="button"
              aria-label="上传图片"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="border-border bg-surface-2 text-muted relative flex aspect-[600/860] w-full items-center justify-center rounded-md border border-dashed"
            >
              <ImagePlus size={22} aria-hidden="true" />
            </button>
            <p className="text-muted mt-1 truncate text-center text-[11px]">
              {busy ? "处理中…" : "上传"}
            </p>
          </li>
        )}
      </ul>
      <p className="text-muted mt-3 text-xs">
        长按一张封面可以删除它。
        {hidden.length > 0 && (
          <button
            type="button"
            onClick={() => restoreCovers(engine)}
            className="text-accent-ink ml-1"
          >
            恢复名画
          </button>
        )}
      </p>
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
