import { Check, Image } from "lucide-react";
import type { HighlightStyle, Mark, TaskData } from "@shared/records";
import { splitTags, tagKey } from "@shared/tags";
import { formatDuration } from "../lib/time";

/** Tag colours by tag key; tags without one use the theme colour. */
export type TagColors = Map<string, string>;

/** The words of a task, with tags in their colour and the highlight behind (or a coloured line under). */
export function TaskWords({
  text,
  highlight,
  highlightStyle = "fill",
  tagColors,
  muted = false,
}: {
  text: string;
  highlight: TaskData["highlight"];
  highlightStyle?: HighlightStyle | undefined;
  tagColors: TagColors;
  muted?: boolean;
}) {
  const parts = splitTags(text).map((part, i) =>
    part.tag === undefined ? (
      <span key={i}>{part.text}</span>
    ) : (
      <span
        key={i}
        style={{
          color: tagColors.get(tagKey(part.tag)) ?? "var(--accent-ink, var(--moli-accent))",
        }}
        className={muted ? "opacity-80" : ""}
      >
        {part.text}
      </span>
    )
  );
  return highlight ? (
    <span className={`hl hl-${highlight}${highlightStyle === "underline" ? " hl-u" : ""}`}>
      {parts}
    </span>
  ) : (
    <>{parts}</>
  );
}

/**
 * What starts a line: for a to-do an empty square, or a light tick once done; for a note a dot or a short dash.
 */
export function TaskMark({
  done,
  mark = "box",
  size = 18,
}: {
  done: boolean;
  mark?: Mark | undefined;
  size?: number;
}) {
  if (mark === "dot")
    return (
      <span
        className="bg-text/80 block rounded-full"
        style={{ width: Math.round(size / 3), height: Math.round(size / 3) }}
        aria-hidden="true"
      />
    );
  if (mark === "dash")
    return (
      <span
        className="bg-text/80 block rounded-full"
        style={{ width: Math.round(size * 0.6), height: 1.5 }}
        aria-hidden="true"
      />
    );
  return done ? (
    <Check size={size} strokeWidth={1.75} className="text-muted/70" aria-hidden="true" />
  ) : (
    <span
      className="border-text/80 block rounded-[3px] border-[1.5px]"
      style={{ width: size - 4, height: size - 4, margin: 2 }}
      aria-hidden="true"
    />
  );
}

/** A task as read-only text (book pages, tag pages, search). */
export function TaskLine({
  task,
  tagColors,
  small = false,
  onOpen,
}: {
  task: TaskData;
  tagColors: TagColors;
  small?: boolean;
  onOpen?: () => void;
}) {
  const indent = small ? 16 : 24;
  const content = (
    <>
      <span
        className={`flex shrink-0 items-center justify-center ${small ? "h-5 w-3.5" : "h-[var(--list-leading)] w-[18px]"}`}
      >
        <TaskMark done={task.done} mark={task.mark} size={small ? 14 : 18} />
      </span>
      <span className={`min-w-0 break-words ${task.done ? "text-muted" : ""}`}>
        <TaskWords
          text={task.text}
          highlight={task.highlight}
          highlightStyle={task.highlightStyle}
          tagColors={tagColors}
          muted={task.done}
        />
        {(task.images?.length ?? 0) > 0 && (
          <Image
            size={small ? 11 : 14}
            className="text-muted ml-1.5 inline-block align-[-1px]"
            aria-label={`${task.images?.length ?? 0} 张图片`}
          />
        )}
        {task.done && task.duration !== null && (
          <span className="text-muted ml-2 font-serif text-[0.95em] whitespace-nowrap">
            {formatDuration(task.duration)}
          </span>
        )}
      </span>
    </>
  );
  const className = `flex items-start text-left ${
    small
      ? "gap-2 text-[13px] leading-5"
      : "gap-3 text-[length:var(--list-size)] leading-[var(--list-leading)]"
  }`;
  const style = { paddingLeft: task.indent * indent };
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`${className} w-full`} style={style}>
      {content}
    </button>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}
