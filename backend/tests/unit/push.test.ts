import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPush } from "../../src/lib/push";

const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => void vi.unstubAllGlobals());

describe("sendPush", () => {
  it("does not call Expo with no tokens", async () => {
    const fetch = respond(200, {});
    vi.stubGlobal("fetch", fetch);
    expect(await sendPush([], "t", "b")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends one message per token and returns only unregistered devices", async () => {
    const fetch = respond(200, {
      data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }, { status: "error", details: { error: "MessageRateExceeded" } }],
    });
    vi.stubGlobal("fetch", fetch);
    expect(await sendPush(["a", "b", "c"], "Title", "Body")).toEqual(["b"]);
    const sent = JSON.parse((fetch.mock.calls[0] as any)[1].body);
    expect(sent).toEqual(["a", "b", "c"].map((to) => ({ to, title: "Title", body: "Body", sound: "default", channelId: "alerts" })));
  });

  it("logs and returns nothing when Expo is down (no device is dropped)", async () => {
    vi.stubGlobal("fetch", respond(503, {}));
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await sendPush(["a"], "t", "b")).toEqual([]);
  });
});
