import { afterEach, describe, expect, it, vi } from "vitest";
import { CognitoJwtVerifier } from "aws-jwt-verify";

process.env.USER_POOL_ID = "us-east-1_test";
process.env.CLIENT_ID = "app,web";
const verify = vi.fn();
const create = vi.spyOn(CognitoJwtVerifier, "create").mockReturnValue({ verify } as any);
const { HttpError, requireOrigin, requireUser } = await import("../../src/lib/auth");

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as InstanceType<typeof HttpError>).status;
  }
};

afterEach(() => void delete process.env.ORIGIN_SECRET);

describe("requireOrigin", () => {
  it("accepts only the exact secret", () => {
    process.env.ORIGIN_SECRET = "s3cret";
    expect(status(() => requireOrigin({ "x-origin-secret": "s3cret" }))).toBeUndefined();
    expect(status(() => requireOrigin({ "x-origin-secret": "s3creT" }))).toBe(403);
    expect(status(() => requireOrigin({ "x-origin-secret": "s3cret-longer" }))).toBe(403);
    expect(status(() => requireOrigin({}))).toBe(403);
  });

  it("fails closed when the secret is not configured", () => {
    expect(status(() => requireOrigin({ "x-origin-secret": "" }))).toBe(403);
  });
});

describe("requireUser", () => {
  it("rejects a missing or non-bearer header", async () => {
    await expect(requireUser({})).rejects.toMatchObject({ status: 401, message: "Missing token" });
    await expect(requireUser({ authorization: "Basic abc" })).rejects.toMatchObject({ status: 401 });
  });

  it("returns sub and email of a valid access token for any configured client", async () => {
    verify.mockResolvedValueOnce({ sub: "user-1", email: "a@b.co" });
    expect(await requireUser({ authorization: "Bearer good" })).toEqual({ sub: "user-1", email: "a@b.co" });
    expect(verify).toHaveBeenCalledWith("good");
    expect(create).toHaveBeenCalledWith({ userPoolId: "us-east-1_test", clientId: ["app", "web"], tokenUse: "access" });
  });

  it("maps any verification error to 401", async () => {
    verify.mockRejectedValueOnce(new Error("Token expired"));
    await expect(requireUser({ authorization: "Bearer old" })).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });
});
