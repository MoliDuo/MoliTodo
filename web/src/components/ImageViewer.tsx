import { ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fileUrl } from "../lib/images";

/** A line's pictures, one at a time over the whole screen. Esc or the cross closes it. */
export function ImageViewer({
  files,
  start,
  onDelete,
  onClose,
}: {
  files: string[];
  start: string;
  onDelete: (file: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, files.indexOf(start)));
  const [confirming, setConfirming] = useState(false);
  const file = files[Math.min(index, files.length - 1)];
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (event.key === "ArrowRight") setIndex((i) => Math.min(files.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length]);
  useEffect(() => {
    if (!file) close.current();
  }, [file]);
  if (!file) return null;

  const step = (by: number) => {
    setConfirming(false);
    setIndex((i) => Math.min(files.length - 1, Math.max(0, i + by)));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片"
      className="fade-in fixed inset-0 z-50 flex flex-col bg-black/90 text-white"
    >
      <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="px-2 text-sm text-white/70">
          {files.length > 1 ? `${index + 1} / ${files.length}` : ""}
        </span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="rounded-full p-2.5 hover:bg-white/10"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center p-3"
        onClick={onClose}
      >
        <img
          src={fileUrl(file)}
          alt=""
          className="max-h-full max-w-full rounded-md object-contain"
          onClick={(event) => event.stopPropagation()}
        />
        {index > 0 && (
          <button
            type="button"
            aria-label="上一张"
            onClick={(event) => {
              event.stopPropagation();
              step(-1);
            }}
            className="absolute left-2 rounded-full bg-black/40 p-2"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        )}
        {index < files.length - 1 && (
          <button
            type="button"
            aria-label="下一张"
            onClick={(event) => {
              event.stopPropagation();
              step(1);
            }}
            className="absolute right-2 rounded-full bg-black/40 p-2"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="safe-bottom flex justify-center gap-3 px-4 pt-2 pb-4">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full bg-white/15 px-5 py-2 text-sm"
            >
              留着
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete(file);
                if (index > 0 && index >= files.length - 1) setIndex(index - 1);
              }}
              className="bg-danger rounded-full px-5 py-2 text-sm text-white"
            >
              删除这张
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 rounded-full bg-white/15 px-5 py-2 text-sm"
          >
            <Trash2 size={15} aria-hidden="true" /> 删除图片
          </button>
        )}
      </div>
    </div>
  );
}
