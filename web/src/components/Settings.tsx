import { X } from "lucide-react";
import { useState } from "react";
import { parseLegacyStore, planLegacyImport } from "@shared/legacy-import";
import type { SyncEngine } from "@shared/sync";

export async function importLegacyFile(engine: SyncEngine, text: string): Promise<string> {
  const old = parseLegacyStore(text);
  if (!old) return "这不是哞哞清单的任务文件（store.json）。";
  // Know what the server has first, so tasks imported earlier are skipped rather than collide.
  await engine.sync();
  const plan = await planLegacyImport(
    old,
    (id) => engine.knows(id),
    engine.all().at(-1)?.position ?? null
  );
  engine.addMissing(plan.items);
  await engine.sync();
  const extra = plan.invalid > 0 ? `，${plan.invalid} 条无法识别` : "";
  return `导入 ${plan.items.length} 条，跳过 ${plan.skipped} 条（之前导入过）${extra}。`;
}

export function Settings(props: { engine: SyncEngine; username: string; onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setMessage(await importLegacyFile(props.engine, await file.text()));
    } catch {
      setMessage("导入失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="bg-surface w-full max-w-md rounded-xl p-5 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">设置</h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="关闭"
            className="text-muted hover:text-text"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="text-muted mb-4 text-sm">当前账号：{props.username}</p>
        <h3 className="mb-1 font-medium">导入哞哞清单的历史任务</h3>
        <p className="text-muted mb-2 text-sm">
          选择旧版的任务文件 store.json（Windows 上在 %APPDATA%\哞哞清单
          里）。只会添加任务，不会修改或删除已有的； 再次导入会跳过之前导入过的。
        </p>
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          aria-label="选择 store.json"
          onChange={(event) => void onFile(event.target.files?.[0])}
          className="text-sm"
        />
        {message && (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
