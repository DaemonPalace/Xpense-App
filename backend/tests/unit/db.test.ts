import { afterEach, describe, expect, it, vi } from "vitest";
import { batchWriteAll, ddb, putReq, queryAll, TABLE } from "../../src/lib/db";

afterEach(() => void vi.useRealTimers());

describe("queryAll", () => {
  it("follows LastEvaluatedKey and omits the sort-key condition for an empty prefix", async () => {
    const send = vi.spyOn(ddb, "send").mockResolvedValueOnce({ Items: [{ n: 1 }], LastEvaluatedKey: { k: 1 } } as never).mockResolvedValueOnce({ Items: [{ n: 2 }] } as never);
    expect(await queryAll("USER#u", "")).toEqual([{ n: 1 }, { n: 2 }]);
    const [first, second] = send.mock.calls.map((c: any) => c[0].input);
    expect(first.KeyConditionExpression).toBe("PK = :pk");
    expect(second.ExclusiveStartKey).toEqual({ k: 1 });
  });
});

describe("batchWriteAll", () => {
  it("chunks by 25 and retries unprocessed items", async () => {
    vi.useFakeTimers();
    const items = Array.from({ length: 30 }, (_, i) => putReq({ PK: "p", SK: String(i) }));
    const send = vi
      .spyOn(ddb, "send")
      .mockResolvedValueOnce({ UnprocessedItems: { [TABLE]: [items[0]] } } as never)
      .mockResolvedValue({} as never);
    const done = batchWriteAll(items);
    await vi.runAllTimersAsync();
    await done;
    const sizes = send.mock.calls.map((c: any) => c[0].input.RequestItems[TABLE].length);
    expect(sizes).toEqual([25, 1, 5]);
  });

  it("gives up after 8 attempts instead of looping forever", async () => {
    vi.useFakeTimers();
    vi.spyOn(ddb, "send").mockImplementation(async (cmd: any) => ({ UnprocessedItems: cmd.input.RequestItems }) as never);
    const done = expect(batchWriteAll([putReq({ PK: "p", SK: "s" })])).rejects.toThrow("1 items unprocessed");
    await vi.runAllTimersAsync();
    await done;
  });
});
