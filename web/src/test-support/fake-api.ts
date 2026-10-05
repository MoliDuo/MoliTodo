import type { PutRecordBody, RecordKind, SyncRecord } from "@shared/records";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const ME = { username: "alice", name: "Alice", email: null, via: "session" as const };

const plain = ({ kind, id, data, deleted, version }: SyncRecord): SyncRecord => ({
  kind,
  id,
  data,
  deleted,
  version,
});

/** The server's rules (versions, change counter, 409 on a stale base) behind a `fetch`, for page tests. */
export function createFakeApi() {
  const rows = new Map<string, SyncRecord & { seq: number }>();
  let seq = 0;
  let files = 0;
  const api = {
    /** Uploaded pictures by id. */
    files: new Map<string, Blob>(),
    /** Set to a status to make every request answer it, e.g. 401 or 500; "network" throws. */
    fail: null as number | "network" | null,
    requests: [] as {
      method: string;
      url: string;
      body?: PutRecordBody;
      headers: Record<string, string>;
    }[],
    rows,
    /** A change made by another device. */
    remote(kind: RecordKind, id: string, data: unknown, deleted = false) {
      const current = rows.get(`${kind}/${id}`);
      seq += 1;
      rows.set(`${kind}/${id}`, {
        kind,
        id,
        data,
        deleted,
        version: (current?.version ?? 0) + 1,
        seq,
      });
    },
    /** What the server has for a record now (null when it has none or it was deleted). */
    data(kind: RecordKind, id: string): unknown {
      const row = rows.get(`${kind}/${id}`);
      return row && !row.deleted ? row.data : null;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://todo.test");
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? (JSON.parse(init.body) as PutRecordBody) : undefined;
      api.requests.push({
        method,
        url: url.pathname + url.search,
        ...(body ? { body } : {}),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      if (api.fail === "network") throw new TypeError("failed to fetch");
      if (api.fail) return json(api.fail, { error: { code: "x", message: "x" } });
      if (url.pathname === "/api/v1/me") return json(200, ME);
      if (url.pathname === "/api/v2/files" && method === "POST") {
        const id = `00000000-0000-4000-8000-${String((files += 1)).padStart(12, "0")}`;
        api.files.set(id, init?.body as Blob);
        return json(200, { id });
      }
      const file = /^\/api\/v2\/files\/(.+)$/.exec(url.pathname);
      if (file && method === "DELETE") {
        api.files.delete(file[1] as string);
        return json(200, { ok: true });
      }
      if (url.pathname === "/api/v2/changes") {
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        const page = [...rows.values()]
          .filter((row) => row.seq > cursor)
          .sort((a, b) => a.seq - b.seq);
        return json(200, {
          records: page.map(plain),
          cursor: page.at(-1)?.seq ?? cursor,
          hasMore: false,
        });
      }
      const match = /^\/api\/v2\/records\/([a-z]+)\/(.+)$/.exec(url.pathname);
      if (match && method === "PUT" && body) {
        const kind = match[1] as RecordKind;
        const id = decodeURIComponent(match[2] as string);
        const key = `${kind}/${id}`;
        const current = rows.get(key);
        if ((current?.version ?? 0) !== body.baseVersion) {
          const record = current ? plain(current) : null;
          return json(409, { error: { code: "conflict", message: "c" }, record });
        }
        seq += 1;
        const row = {
          kind,
          id,
          data: body.data,
          deleted: body.deleted,
          version: body.baseVersion + 1,
          seq,
        };
        rows.set(key, row);
        return json(200, { record: plain(row) });
      }
      return json(404, { error: { code: "not_found", message: "x" } });
    }) as typeof fetch,
  };
  return api;
}
