import type { PutTaskBody, Task } from "@shared/tasks";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const plain = ({
  id,
  text,
  done,
  doneAt,
  archived,
  duration,
  position,
  deleted,
  version,
}: Task): Task => ({
  id,
  text,
  done,
  doneAt,
  archived,
  duration,
  position,
  deleted,
  version,
});

export const ME = { username: "alice", name: "Alice", email: null, via: "session" };

/** The server's rules (versions, change counter, 409 on a stale base) behind a `fetch`, for page tests. */
export function createFakeApi() {
  const rows = new Map<string, Task & { seq: number }>();
  let seq = 0;
  const api = {
    /** Set to a status to make every request answer it, e.g. 401 or 500; "network" throws. */
    fail: null as number | "network" | null,
    /** When set, requests without exactly this `Authorization` header answer 401. */
    requireAuthorization: null as string | null,
    requests: [] as {
      method: string;
      url: string;
      body?: PutTaskBody;
      headers: Record<string, string>;
    }[],
    rows,
    /** A change made by another device. */
    remote(id: string, content: Omit<PutTaskBody, "baseVersion">) {
      const current = rows.get(id);
      seq += 1;
      rows.set(id, { id, ...content, version: (current?.version ?? 0) + 1, seq });
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://todo.test");
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as PutTaskBody) : undefined;
      api.requests.push({
        method,
        url: url.pathname + url.search,
        ...(body ? { body } : {}),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      const sent = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
      if (api.requireAuthorization !== null && sent !== api.requireAuthorization) {
        return json(401, { error: { code: "unauthorized", message: "x" } });
      }
      if (api.fail === "network") throw new TypeError("failed to fetch");
      if (api.fail) return json(api.fail, { error: { code: "x", message: "x" } });
      if (url.pathname === "/api/v1/me") return json(200, ME);
      if (url.pathname === "/api/v1/tasks/changes") {
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        const page = [...rows.values()]
          .filter((row) => row.seq > cursor)
          .sort((a, b) => a.seq - b.seq);
        return json(200, {
          tasks: page.map(plain),
          cursor: page.at(-1)?.seq ?? cursor,
          hasMore: false,
        });
      }
      const match = /^\/api\/v1\/tasks\/(.+)$/.exec(url.pathname);
      if (match && method === "PUT" && body) {
        const id = decodeURIComponent(match[1] as string);
        const { baseVersion, ...content } = body;
        const current = rows.get(id);
        if ((current?.version ?? 0) !== baseVersion) {
          const task = current ? plain(current) : null;
          return json(409, { error: { code: "conflict", message: "c" }, task });
        }
        seq += 1;
        const row = { id, ...content, version: baseVersion + 1, seq };
        rows.set(id, row);
        return json(200, { task: plain(row) });
      }
      return json(404, { error: { code: "not_found", message: "x" } });
    }) as typeof fetch,
  };
  return api;
}
