import { ChevronRight, Hash, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { TaskLine } from "../components/TaskText";
import { useApp } from "../context";
import { groupByDay, searchTasks, tagSummaries } from "../lib/model";
import { formatDuration, formatFullDay } from "../lib/time";
import { navigate } from "../router";
import { useTagColors } from "../useTagColors";

export function IndexPage({ query }: { query: string }) {
  const { engine, tick, today } = useApp();
  const tagColors = useTagColors();
  const [text, setText] = useState(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tags = useMemo(() => tagSummaries(engine), [engine, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const results = useMemo(() => groupByDay(searchTasks(engine, query)), [engine, query, tick]);
  const searching = query.trim() !== "";
  const setQuery = (value: string) => {
    setText(value);
    navigate({ name: "index", query: value }, true);
  };

  return (
    <div className="mx-auto max-w-2xl px-5 lg:px-10">
      <header className="pt-5 pb-3">
        <h1 className="text-2xl font-medium">索引</h1>
      </header>
      <label className="bg-surface-2 flex items-center gap-2 rounded-xl px-3 py-2.5">
        <Search size={16} className="text-muted shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={text}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索任务、#标签"
          aria-label="搜索"
          className="placeholder:text-muted min-w-0 flex-1 bg-transparent text-[15px] outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            type="button"
            aria-label="清除"
            onClick={() => setQuery("")}
            className="text-muted"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </label>

      {searching ? (
        <section className="pt-4" aria-label="搜索结果">
          {results.length === 0 && <p className="text-muted py-10 text-center text-sm">没有找到</p>}
          {results.map((group) => (
            <div key={group.day} className="mb-4">
              <button
                type="button"
                onClick={() =>
                  navigate({ name: "today", day: group.day === today ? null : group.day })
                }
                className="text-muted hover:text-accent-ink mb-1.5 text-xs"
              >
                {formatFullDay(group.day, today)}
              </button>
              <div className="space-y-1">
                {group.tasks.map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task.data}
                    tagColors={tagColors}
                    onOpen={() =>
                      navigate({
                        name: "today",
                        day: task.data.day === today ? null : task.data.day,
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="pt-6" aria-label="标签">
          <h2 className="mb-2 text-base font-semibold">标签</h2>
          {tags.length === 0 && (
            <p className="text-muted py-6 text-sm">
              还没有标签。在任务里写 <span className="text-accent-ink">#阅读</span>{" "}
              这样的词，就会出现在这里。
            </p>
          )}
          <ul>
            {tags.map((tag) => (
              <li key={tag.key}>
                <button
                  type="button"
                  onClick={() => navigate({ name: "tag", tag: tag.name })}
                  className="hover:bg-surface-2 -mx-2 flex w-[calc(100%+1rem)] items-center gap-4 rounded-lg px-2 py-3.5 text-left"
                >
                  <Hash
                    size={20}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    style={{ color: tag.color ?? "var(--accent-ink, var(--moli-accent))" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{tag.name}</span>
                  {tag.minutes > 0 && (
                    <span className="text-muted font-serif text-xs">
                      {formatDuration(tag.minutes)}
                    </span>
                  )}
                  <span className="text-muted text-xs">{tag.count} 条记录</span>
                  <ChevronRight size={16} className="text-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
