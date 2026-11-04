import { describe, expect, it } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";
import { route } from "../../src/stream-router";

const rec = (eventName: string, PK: string, SK: string, next?: object, prev?: object, t = 1_790_000_000) =>
  ({
    eventName,
    dynamodb: {
      Keys: marshall({ PK, SK }),
      NewImage: next ? marshall({ PK, SK, ...next }) : undefined,
      OldImage: prev ? marshall({ PK, SK, ...prev }) : undefined,
      ApproximateCreationDateTime: t,
    },
  }) as any;

const job = { kind: "sync", jobId: "J1", accountId: "A1", lastCorrelationId: "c-1" };

describe("stream-router", () => {
  it("routes queued jobs (insert, upload confirmed, retry) and ignores other job transitions", () => {
    const { ingest } = route([
      rec("INSERT", "USER#u", "JOB#J1", { ...job, status: "queued" }),
      rec("MODIFY", "USER#u", "JOB#J2", { ...job, jobId: "J2", status: "queued" }, { status: "awaiting_upload" }),
      rec("MODIFY", "USER#u", "JOB#J3", { ...job, jobId: "J3", status: "running" }, { status: "queued" }),
      rec("MODIFY", "USER#u", "JOB#J4", { ...job, jobId: "J4", status: "queued" }, { status: "failed" }),
      rec("INSERT", "USER#u", "JOB#J5", { ...job, jobId: "J5", status: "awaiting_upload" }),
    ]);
    expect(ingest.map((m) => m.jobId)).toEqual(["J1", "J2", "J4"]);
    expect(ingest[0]).toMatchObject({ kind: "sync", userId: "u", accountId: "A1", correlationId: "c-1" });
  });

  it("emits one recompute per user for TXN changes, carrying the newest correlationId", () => {
    const { forecast } = route([
      rec("INSERT", "USER#u1", "TXN#2026-10-01#a", { lastCorrelationId: "old" }, undefined, 100),
      rec("MODIFY", "USER#u1", "TXN#2026-10-01#b", { lastCorrelationId: "new" }, {}, 200),
      rec("REMOVE", "USER#u1", "TXN#2026-10-02#c", undefined, { lastCorrelationId: "x" }, 150),
      rec("INSERT", "USER#u2", "TXN#2026-10-01#d", { lastCorrelationId: "u2c" }, undefined, 100),
      rec("INSERT", "USER#u2", "TXN#2026-10-01#e", { lastCorrelationId: "u2c" }, undefined, 100),
    ]);
    expect(forecast).toHaveLength(2);
    expect(forecast.find((m) => m.userId === "u1")).toMatchObject({ correlationId: "new", changedAt: new Date(200_000).toISOString() });
  });

  it("ignores aggregates, forecasts, profiles and activity markers (no loops)", () => {
    const r = route([
      rec("INSERT", "USER#u", "AGG#2026-10", {}),
      rec("INSERT", "USER#u", "FORECAST", {}),
      rec("MODIFY", "USER#u", "PROFILE", {}, {}),
      rec("INSERT", "ACTIVE#2026-10", "USER#u", {}),
    ]);
    expect(r).toEqual({ ingest: [], forecast: [] });
  });
});
