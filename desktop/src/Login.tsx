import { useEffect, useRef, useState } from "react";
import { LoginFailedError, type DeviceLogin } from "@shared/device-auth";
import type { Session } from "./session";
import type { Platform } from "./platform";

type Phase =
  | { step: "starting" }
  | { step: "waiting"; login: DeviceLogin }
  | { step: "failed"; message: string };

const FAILURES: Record<string, string> = {
  denied: "登录被拒绝了。",
  expired: "验证码已过期，请重新登录。",
};

/** Device sign-in (standard 008, 8.7.2): shows a code, the person approves it in the browser, no password here. */
export function LoginDialog(props: {
  session: Session;
  platform: Platform;
  onDone: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ step: "starting" });
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const { session, platform, onDone } = props;

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setPhase({ step: "starting" });
    (async () => {
      try {
        const login = await session.auth.start();
        if (abort.signal.aborted) return;
        setPhase({ step: "waiting", login });
        void platform
          .openUrl(login.verificationUriComplete ?? login.verificationUri)
          .catch(() => undefined);
        const tokens = await session.auth.waitForApproval(login, abort.signal);
        await session.tokens.accept(tokens);
        await session.completeSignIn();
        onDone();
      } catch (error) {
        if (abort.signal.aborted) return;
        const message =
          error instanceof LoginFailedError
            ? (FAILURES[error.reason] ?? "登录没有完成。")
            : "连不上登录服务，请检查网络后重试。";
        setPhase({ step: "failed", message });
      }
    })();
    return () => abort.abort();
  }, [session, platform, onDone, attempt]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="登录"
        className="bg-surface w-full max-w-xs rounded-xl p-4 shadow-lg"
      >
        <h2 className="mb-2 text-base font-semibold">登录 Moli</h2>
        {phase.step === "starting" && <p className="text-muted text-sm">正在获取验证码…</p>}
        {phase.step === "waiting" && (
          <>
            <p className="text-muted mb-2 text-sm">
              已在浏览器里打开登录页。请确认页面上显示的验证码与下面一致，然后批准登录：
            </p>
            <p
              aria-label="验证码"
              className="bg-surface-2 mb-2 rounded-lg py-2 text-center font-mono text-xl tracking-widest select-text"
            >
              {phase.login.userCode}
            </p>
            <button
              type="button"
              className="text-accent mb-2 text-sm"
              onClick={() =>
                void platform.openUrl(
                  phase.login.verificationUriComplete ?? phase.login.verificationUri
                )
              }
            >
              重新打开登录页
            </button>
            <p className="text-muted text-xs">等待你在浏览器里批准…</p>
          </>
        )}
        {phase.step === "failed" && (
          <>
            <p role="alert" className="text-danger mb-2 text-sm">
              {phase.message}
            </p>
            <button
              type="button"
              className="text-accent text-sm"
              onClick={() => setAttempt((n) => n + 1)}
            >
              重试
            </button>
          </>
        )}
        <div className="mt-3 text-right">
          <button type="button" onClick={props.onClose} className="text-muted text-sm">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
