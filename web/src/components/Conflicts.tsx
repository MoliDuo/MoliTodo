import type { SyncEngine } from "@shared/sync";

export function Conflicts({ engine }: { engine: SyncEngine }) {
  const conflicts = engine.getState().conflicts;
  if (conflicts.length === 0) return null;
  return (
    <div role="alert" className="border-warning bg-surface mb-4 rounded-lg border p-3 text-sm">
      <p className="mb-2 font-medium">
        有 {conflicts.length}{" "}
        处修改和别处的修改冲突，已采用服务器上的版本。你这边被覆盖的内容如下，可以复制后重新添加：
      </p>
      <ul className="flex flex-col gap-1">
        {conflicts.map((conflict) => (
          <li key={`${conflict.id}-${conflict.at}`} className="flex items-center gap-2">
            <span className="flex-1 break-words">{conflict.discarded.text}</span>
            <button
              type="button"
              className="text-accent"
              onClick={() => void navigator.clipboard?.writeText(conflict.discarded.text)}
            >
              复制
            </button>
            <button
              type="button"
              className="text-muted"
              onClick={() => engine.dismissConflict(conflict.id)}
            >
              忽略
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
