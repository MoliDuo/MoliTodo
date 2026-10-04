import { Check } from "lucide-react";
import type { TaskData } from "@shared/records";
import { splitTags, tagKey } from "@shared/tags";
import { formatDuration } from "../lib/time";

/** Tag colours by tag key; tags without one use the theme colour. */
export type TagColors = Map<string, string>;

/** The words of a task, with tags in their colour and the highlight behind. */
export function TaskWords({
  text,
  highlight,
  tagColors,
  muted = false,
}: {
  text: string;
  highlight: TaskData["highlight"];
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
  return highlight ? <span className={`hl hl-${highlight}`}>{parts}</span> : <>{parts}</>;
}

/** The box at the start of a line: an empty square, or a light tick once done. */
export function TaskMark({ done, size = 18 }: { done: boolean; size?: number }) {
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
      <span className={`flex shrink-0 items-center ${small ? "h-5" : "h-6"}`}>
        <TaskMark done={task.done} size={small ? 14 : 18} />
      </span>
      <span className={`min-w-0 break-words ${task.done ? "text-muted" : ""}`}>
        <TaskWords
          text={task.text}
          highlight={task.highlight}
          tagColors={tagColors}
          muted={task.done}
        />
        {task.done && task.duration !== null && (
          <span className="text-muted ml-2 font-serif text-[0.95em] whitespace-nowrap">
            {formatDuration(task.duration)}
          </span>
        )}
      </span>
    </>
  );
  const className = `flex items-start text-left ${small ? "gap-2 text-[13px] leading-5" : "gap-3 text-[15px] leading-6"}`;
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
