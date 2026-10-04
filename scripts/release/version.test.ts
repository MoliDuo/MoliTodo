import { describe, expect, it } from "vitest";
import { checkTag, compareVersions, previousTag } from "./version.ts";

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.7", "1.0.7")).toBe(0);
    expect(compareVersions("1.0.6", "1.0.7")).toBeLessThan(0);
  });
});

describe("checkTag", () => {
  const tags = ["v1.0.6", "v1.0.7"];
  it("accepts the version file's version when it is newer than every tag", () => {
    expect(checkTag("v2.0.0", "2.0.0", [...tags, "v2.0.0"])).toEqual([]);
  });
  it("rejects a tag that is not vX.Y.Z or does not match package.json", () => {
    expect(checkTag("2.0.0", "2.0.0", tags)).toEqual(["the tag 2.0.0 is not vX.Y.Z"]);
    expect(checkTag("v2.0.1", "2.0.0", tags)[0]).toContain("package.json says 2.0.0");
  });
  it("rejects going backwards or repeating a version", () => {
    expect(checkTag("v1.0.5", "1.0.5", tags)[0]).toContain("not newer than v1.0.6, v1.0.7");
    expect(checkTag("v1.0.7", "1.0.7", ["v1.0.7", "v1.0.7"])).toEqual([]);
    expect(checkTag("v1.0.7", "1.0.7", ["v1.0.6", "v1.0.8"])[0]).toContain("v1.0.8");
  });
});

describe("previousTag", () => {
  it("finds the closest older release tag", () => {
    expect(previousTag("v2.0.0", ["v1.0.6", "v1.0.7", "v2.0.0", "junk"])).toBe("v1.0.7");
    expect(previousTag("v1.0.6", ["v1.0.6"])).toBeNull();
  });
});
