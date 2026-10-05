import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Ellipsis,
  Hash,
  Highlighter,
  Minus,
  Paperclip,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  HIGHLIGHTS,
  MAX_INDENT,
  type Highlight,
  type HighlightStyle,
  type Mark,
} from "@shared/records";
import { useKeyboardInset } from "../hooks";

export const HIGHLIGHT_NAMES: Record<Highlight, string> = {
  yellow: "黄色",
  red: "红色",
  blue: "蓝色",
  green: "绿色",
  purple: "紫色",
};

/** What the toolbar shows about the line being edited. */
export interface ToolbarLine {
  mark: Mark;
  indent: number;
  highlight: Highlight | null;
  highlightStyle: HighlightStyle;
  /** False for the bottom line while nothing is typed there yet: there is nothing to highlight or attach to. */
  written: boolean;
}

/** Keeps the caret in the line: a press on the toolbar must not take focus (and close the keyboard). */
const keepFocus = {
  onPointerDown: (event: React.PointerEvent) => event.preventDefault(),
  onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
};

function Tool({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      {...keepFocus}
      className={`flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-30 ${
        pressed ? "bg-accent-soft text-accent-ink" : "text-text/80 hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden="true" />;

/**
 * The bar above the keyboard while a line is being edited: what kind of line it is, a tag, the highlight, pictures,
 * indent, and the rest of the line's actions behind "⋯".
 */
export function LineToolbar({
  line,
  tags,
  onMark,
  onIndent,
  onHash,
  onTag,
  onHighlight,
  onImages,
  onMore,
}: {
  line: ToolbarLine;
  /** Tags that fit what is typed after a "#" at the caret; empty when not typing a tag. */
  tags: string[];
  onMark: (mark: Mark) => void;
  onIndent: (step: 1 | -1) => void;
  onHash: () => void;
  onTag: (name: string) => void;
  onHighlight: (color: Highlight | null, style: HighlightStyle) => void;
  onImages: () => void;
  onMore: () => void;
}) {
  const inset = useKeyboardInset();
  const [panel, setPanel] = useState<"highlight" | null>(null);
  const style = line.highlightStyle;

  return (
    <div
      className={`fixed inset-x-0 z-40 lg:left-24 ${
        inset > 0 ? "" : "bottom-[calc(3.5rem+env(safe-area-inset-bottom))] lg:bottom-0"
      }`}
      style={inset > 0 ? { bottom: inset } : undefined}
    >
      <div className="bg-surface/95 border-border mx-auto max-w-2xl border-t backdrop-blur lg:rounded-t-xl lg:border-x">
        {panel === "highlight" && (
          <div
            className="flex items-center gap-2 overflow-x-auto px-3 pt-2.5 pb-1"
            role="group"
            aria-label="高亮颜色"
          >
            <button
              type="button"
              aria-label="不高亮"
              aria-pressed={line.highlight === null}
              onClick={() => onHighlight(null, style)}
              {...keepFocus}
              className={`border-border flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                line.highlight === null ? "ring-text ring-2 ring-offset-1" : ""
              }`}
            >
              无
            </button>
            {HIGHLIGHTS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={HIGHLIGHT_NAMES[color]}
                aria-pressed={line.highlight === color}
                onClick={() => onHighlight(color, style)}
                {...keepFocus}
                className={`hl-${color} h-7 w-7 shrink-0 rounded-full ${
                  line.highlight === color ? "ring-text ring-2 ring-offset-1" : ""
                }`}
              />
            ))}
            <span className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden="true" />
            <div className="bg-surface-2 flex shrink-0 rounded-lg p-0.5 text-xs" role="group">
              {(
                [
                  ["fill", "底色"],
                  ["underline", "下划线"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={style === value}
                  onClick={() => onHighlight(line.highlight ?? "yellow", value)}
                  {...keepFocus}
                  className={`rounded-md px-2.5 py-1 ${style === value ? "bg-surface shadow-sm" : "text-muted"}`}
                >
                  <span
                    className={
                      value === "fill" ? "hl hl-yellow" : "hl hl-u hl-yellow decoration-[2px]"
                    }
                  >
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {panel === null && tags.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-2.5 pb-1" aria-label="标签">
            {tags.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onTag(name)}
                {...keepFocus}
                className="bg-surface-2 text-accent-ink shrink-0 rounded-full px-3 py-1 text-sm"
              >
                #{name}
              </button>
            ))}
          </div>
        )}
        <div
          role="toolbar"
          aria-label="编辑这一行"
          className="flex items-center overflow-x-auto px-2 py-1"
        >
          <Tool label="待办" pressed={line.mark === "box"} onClick={() => onMark("box")}>
            <span className="border-text/80 block h-3.5 w-3.5 rounded-[3px] border-[1.5px]" />
          </Tool>
          <Tool label="圆点" pressed={line.mark === "dot"} onClick={() => onMark("dot")}>
            <span className="bg-text/80 block h-1.5 w-1.5 rounded-full" />
          </Tool>
          <Tool label="横线" pressed={line.mark === "dash"} onClick={() => onMark("dash")}>
            <Minus size={18} strokeWidth={1.75} aria-hidden="true" />
          </Tool>
          <Divider />
          <Tool label="标签" onClick={onHash}>
            <Hash size={18} strokeWidth={1.75} aria-hidden="true" />
          </Tool>
          <Tool
            label="高亮"
            pressed={panel === "highlight"}
            disabled={!line.written}
            onClick={() => setPanel((p) => (p === "highlight" ? null : "highlight"))}
          >
            <Highlighter size={18} strokeWidth={1.75} aria-hidden="true" />
          </Tool>
          <Tool label="图片" disabled={!line.written} onClick={onImages}>
            <Paperclip size={18} strokeWidth={1.75} aria-hidden="true" />
          </Tool>
          <Divider />
          <Tool label="退格" disabled={line.indent <= 0} onClick={() => onIndent(-1)}>
            <ArrowLeftToLine size={18} strokeWidth={1.75} aria-hidden="true" />
          </Tool>
          <Tool label="缩进" disabled={line.indent >= MAX_INDENT} onClick={() => onIndent(1)}>
            <ArrowRightToLine size={18} strokeWidth={1.75} aria-hidden="true" />
          </Tool>
          <span className="flex-1" />
          <Tool label="更多" disabled={!line.written} onClick={onMore}>
            <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
          </Tool>
        </div>
      </div>
    </div>
  );
}
