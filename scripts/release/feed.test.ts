import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assetUrl,
  buildFeed,
  checksums,
  releaseAssets,
  updaterAssets,
  verifyFeed,
  type Feed,
} from "./feed.ts";

const REPO = "MoliDuo/MoliTodo";
const VERSION = "2.0.0";

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  const keyId = Buffer.alloc(8, 7);
  const pub = Buffer.from(
    `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64")}\n`
  ).toString("base64");
  const signFile = (data: Buffer, version: string | null = VERSION) => {
    const file = sign(null, createHash("blake2b512").update(data).digest(), privateKey);
    const comment =
      version === null ? "timestamp:1\tfile:x" : `timestamp:1\tfile:x\tversion:${version}`;
    const global = sign(null, Buffer.concat([file, Buffer.from(comment)]), privateKey);
    return Buffer.from(
      `untrusted comment: sig\n${Buffer.concat([Buffer.from("ED"), keyId, file]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`
    ).toString("base64");
  };
  return { pub, signFile };
}

const files = {
  "windows-x86_64": Buffer.from("windows installer"),
  "darwin-aarch64": Buffer.from("mac archive"),
} as const;

function release(options: { signedVersion?: string | null } = {}) {
  const { pub, signFile } = signer();
  const feed = buildFeed({
    repo: REPO,
    version: VERSION,
    notes: "notes",
    pubDate: new Date("2026-10-04T12:00:00Z"),
    signatures: {
      "windows-x86_64": signFile(files["windows-x86_64"], options.signedVersion),
      "darwin-aarch64": signFile(files["darwin-aarch64"], options.signedVersion),
    },
  });
  const download = async (url: string) => {
    const name = decodeURIComponent(url.split("/").pop() ?? "");
    const names = updaterAssets(VERSION);
    if (name === names["windows-x86_64"]) return files["windows-x86_64"];
    if (name === names["darwin-aarch64"]) return files["darwin-aarch64"];
    throw new Error("404");
  };
  return { pub, feed, download };
}

describe("names", () => {
  it("follow standard 006 6.6.1 and carry the version", () => {
    expect(releaseAssets("2.0.0")).toEqual([
      "MoliTodo_2.0.0_windows_x64.exe",
      "MoliTodo_2.0.0_macos_arm64.app.tar.gz",
      "MoliTodo_2.0.0_macos_arm64.dmg",
    ]);
    for (const name of releaseAssets("2.0.0"))
      expect(name).toMatch(
        /^[A-Za-z0-9]+_\d+\.\d+\.\d+_(macos|windows)_(arm64|x64)\.[A-Za-z0-9.]+$/
      );
  });
});

describe("buildFeed", () => {
  it("points at the files of this version, never at latest, and carries the signatures", () => {
    const { feed } = release();
    expect(feed.version).toBe("2.0.0");
    expect(feed.pub_date).toBe("2026-10-04T12:00:00.000Z");
    expect(feed.platforms["windows-x86_64"]?.url).toBe(
      "https://github.com/MoliDuo/MoliTodo/releases/download/v2.0.0/MoliTodo_2.0.0_windows_x64.exe"
    );
    expect(feed.platforms["darwin-aarch64"]?.url).not.toContain("latest");
    expect(feed.platforms["darwin-aarch64"]?.signature).not.toMatch(/\s/);
    expect(assetUrl(REPO, "1.0.0", "a b.exe")).toContain("a%20b.exe");
  });
});

describe("checksums", () => {
  it("writes sha256sum's format", () => {
    const text = checksums([
      { name: "a.txt", data: Buffer.from("hello") },
      { name: "b.txt", data: Buffer.from("") },
    ]);
    expect(text).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  a.txt\n" +
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  b.txt\n"
    );
  });
});

describe("verifyFeed", () => {
  const check = (feed: unknown, pub: string, download: (url: string) => Promise<Uint8Array>) =>
    verifyFeed({ feed, repo: REPO, version: VERSION, publicKey: pub, download });

  it("passes a feed whose files verify with the shipped key", async () => {
    const { pub, feed, download } = release();
    expect(await check(feed, pub, download)).toEqual([]);
  });

  it("accepts signatures that record no version, as the Tauri CLI makes them today", async () => {
    const { pub, feed, download } = release({ signedVersion: null });
    expect(await check(feed, pub, download)).toEqual([]);
  });

  it("reports a wrong version, a wrong address, a missing platform and unreachable files", async () => {
    const { pub, feed, download } = release();
    const wrong: Feed = {
      ...feed,
      version: "1.9.0",
      platforms: {
        "windows-x86_64": {
          ...feed.platforms["windows-x86_64"]!,
          url: "https://example.com/latest",
        },
      },
    };
    const problems = await check(wrong, pub, download);
    expect(problems.join("\n")).toContain("announces 1.9.0");
    expect(problems.join("\n")).toContain("points at https://example.com/latest");
    expect(problems.join("\n")).toContain("darwin-aarch64: missing");
    const gone = await check(feed, pub, async () => {
      throw new Error("404");
    });
    expect(gone.join("\n")).toContain("cannot download");
    expect(await check(null, pub, download)).toEqual(["the feed is not a JSON object"]);
  });

  it("reports a file that does not match its signature, a different key, and a signature for another version", async () => {
    const { pub, feed } = release();
    const tampered = await check(feed, pub, async () => Buffer.from("tampered"));
    expect(tampered.join("\n")).toContain("does not match the file");
    const other = release();
    const wrongKey = await check(feed, other.pub, release().download);
    expect(wrongKey.join("\n")).toMatch(/different key|does not match/);
    const old = release({ signedVersion: "1.0.0" });
    const stale = await check(old.feed, old.pub, old.download);
    expect(stale.join("\n")).toContain("made for version 1.0.0, not 2.0.0");
  });
});
