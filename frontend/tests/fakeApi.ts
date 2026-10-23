import { vi } from "vitest";

type Reply = { status: number; body?: unknown };
type Handler = (body: unknown) => Reply;

// Stubs fetch with one handler per "METHOD /api/path". Anything else
// answers 404, so a page's incidental requests (version footer, ...) don't
// need a handler each.
export function fakeApi(routes: Record<string, Handler | Reply>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const reply = typeof route === "function" ? route(body) : route ?? { status: 404, body: { error: "not found" } };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
