import { CloudOff, RefreshCw } from "lucide-react";
import { formatClock } from "../lib/time";
import type { SyncStatus } from "../lib/sync";

export function syncText(status: SyncStatus, lastSyncAt: number | null): string {
  if (status === "syncing") return "同步中…";
  if (status === "offline") return "离线，改动已保存，联网后自动同步";
  if (status === "upgrade") return "版本太旧，请刷新页面";
  if (status === "auth") return "登录已失效，正在重新登录…";
  return lastSyncAt === null ? "尚未同步" : `已同步 ${formatClock(lastSyncAt)}`;
}

export function SyncBadge(props: {
  status: SyncStatus;
  lastSyncAt: number | null;
  onSync: () => void;
}) {
  const Icon = props.status === "offline" ? CloudOff : RefreshCw;
  return (
    <button
      type="button"
      onClick={props.onSync}
      title="立即同步"
      className="text-muted hover:text-text flex items-center gap-1 text-xs"
    >
      <Icon
        size={14}
        aria-hidden="true"
        className={props.status === "syncing" ? "animate-spin" : ""}
      />
      <span role="status">{syncText(props.status, props.lastSyncAt)}</span>
    </button>
  );
}
