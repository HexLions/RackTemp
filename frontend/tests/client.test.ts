import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { fakeApi } from "./fakeApi";

describe("api client", () => {
  it("sends JSON with the session cookie and returns the parsed body", async () => {
    const fetchMock = fakeApi({ "POST /api/sensors": { status: 200, body: { id: "s1" } } });
    expect(await api.post("/sensors", { name: "rack 1" })).toEqual({ id: "s1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sensors");
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ name: "rack 1" }) });
  });

  it("throws ApiError with the server's error message and status", async () => {
    fakeApi({ "GET /api/sensors": { status: 401, body: { error: "not authenticated" } } });
    const err = await api.get("/sensors").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: "not authenticated" });
  });

  it("falls back to the status text when the error body isn't JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(api.get("/sensors")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });

  it("returns undefined for 204 No Content", async () => {
    fakeApi({ "DELETE /api/sensors/s1": { status: 204 } });
    expect(await api.delete("/sensors/s1")).toBeUndefined();
  });
});
