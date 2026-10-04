import { SyncError, type PutResult, type Transport } from "./sync";
import {
  changesResponseSchema,
  CLIENT_HEADER,
  conflictResponseSchema,
  putTaskResponseSchema,
  type PutTaskBody,
} from "./tasks";

export interface HttpTransportOptions {
  /** "" for the website (same origin); the site's address for the desktop app. */
  baseUrl?: string;
  /** `<client>/<version>`, e.g. `todo-desktop/2.0.0`; sent on every request (the 426 check reads it). */
  client: string;
  /** Extra headers, e.g. the bearer token; read on every request so a refreshed token is used. */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  fetch?: typeof fetch;
}

/** Talks to the sync interface over HTTP and turns every failure into a `SyncError` the engine understands. */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const extra = (await options.headers?.()) ?? {};
    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl ?? ""}${path}`, {
        ...init,
        headers: { [CLIENT_HEADER]: options.client, ...extra, ...(init.headers as object) },
        credentials: "same-origin",
      });
    } catch {
      throw new SyncError("offline", "network");
    }
    if (response.status === 401 || response.status === 403) throw new SyncError("auth");
    if (response.status === 426) throw new SyncError("upgrade");
    return response;
  }

  async function body(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new SyncError("offline", "bad response");
    }
  }

  return {
    async put(id: string, payload: PutTaskBody): Promise<PutResult> {
      const response = await request(`/api/v1/tasks/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 200) {
        const parsed = putTaskResponseSchema.safeParse(await body(response));
        if (!parsed.success) throw new SyncError("offline", "unexpected response");
        return { kind: "ok", task: parsed.data.task };
      }
      if (response.status === 409) {
        const parsed = conflictResponseSchema.safeParse(await body(response));
        if (!parsed.success) throw new SyncError("offline", "unexpected response");
        return { kind: "conflict", task: parsed.data.task };
      }
      if (response.status === 400 || response.status === 404 || response.status === 413) {
        throw new SyncError("rejected");
      }
      throw new SyncError("offline", `server answered ${response.status}`);
    },

    async changes(cursor: number, limit: number) {
      const response = await request(`/api/v1/tasks/changes?cursor=${cursor}&limit=${limit}`);
      if (response.status !== 200)
        throw new SyncError("offline", `server answered ${response.status}`);
      const parsed = changesResponseSchema.safeParse(await body(response));
      if (!parsed.success) throw new SyncError("offline", "unexpected response");
      return parsed.data;
    },
  };
}
