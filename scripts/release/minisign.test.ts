import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMinisign } from "./minisign.ts";

const KEY_ID = Buffer.from("0123456789abcdef", "hex").subarray(0, 8);

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  const pubText = `untrusted comment: test public key\n${Buffer.concat([Buffer.from("Ed"), KEY_ID, raw]).toString("base64")}\n`;
  return { privateKey, pubkey: Buffer.from(pubText).toString("base64") };
}

function makeSignature(
  privateKey: KeyObject,
  data: Buffer,
  options: { prehashed?: boolean; comment?: string; keyId?: Buffer } = {}
) {
  const { prehashed = true, comment = "timestamp:1\tfile:app.exe\tversion:2.0.0" } = options;
  const message = prehashed ? createHash("blake2b512").update(data).digest() : data;
  const fileSignature = sign(null, message, privateKey);
  const global = sign(null, Buffer.concat([fileSignature, Buffer.from(comment)]), privateKey);
  const body = Buffer.concat([
    Buffer.from(prehashed ? "ED" : "Ed"),
    options.keyId ?? KEY_ID,
    fileSignature,
  ]);
  const text = `untrusted comment: signature from tauri secret key\n${body.toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`;
  return Buffer.from(text).toString("base64");
}

const data = Buffer.from("the installer bytes");

describe("verifyMinisign", () => {
  it("accepts a prehashed signature and reads the signed version", () => {
    const { privateKey, pubkey } = makeKey();
    const result = verifyMinisign({
      publicKey: pubkey,
      signature: makeSignature(privateKey, data),
      data,
    });
    expect(result.signedVersion).toBe("2.0.0");
    expect(result.trustedComment).toContain("file:app.exe");
  });

  it("accepts a legacy signature of the raw file, and reports no version when none was recorded", () => {
    const { privateKey, pubkey } = makeKey();
    const result = verifyMinisign({
      publicKey: pubkey,
      signature: makeSignature(privateKey, data, { prehashed: false, comment: "timestamp:1" }),
      data,
    });
    expect(result.signedVersion).toBeNull();
  });

  it("rejects a changed file, a wrong key, a changed comment and another key id", () => {
    const { privateKey, pubkey } = makeKey();
    const signature = makeSignature(privateKey, data);
    expect(() =>
      verifyMinisign({ publicKey: pubkey, signature, data: Buffer.from("tampered") })
    ).toThrow("does not match the file");
    expect(() => verifyMinisign({ publicKey: makeKey().pubkey, signature, data })).toThrow(
      "does not match the file"
    );
    const edited = Buffer.from(signature, "base64")
      .toString()
      .replace("version:2.0.0", "version:9.9.9");
    expect(() =>
      verifyMinisign({
        publicKey: pubkey,
        signature: Buffer.from(edited).toString("base64"),
        data,
      })
    ).toThrow("comment was changed");
    expect(() =>
      verifyMinisign({
        publicKey: pubkey,
        signature: makeSignature(privateKey, data, { keyId: Buffer.alloc(8, 1) }),
        data,
      })
    ).toThrow("different key");
  });

  it("rejects things that are not minisign files", () => {
    const { privateKey, pubkey } = makeKey();
    const signature = makeSignature(privateKey, data);
    const notMinisign = Buffer.from("hello").toString("base64");
    expect(() => verifyMinisign({ publicKey: notMinisign, signature, data })).toThrow(
      "not a minisign file"
    );
    expect(() => verifyMinisign({ publicKey: pubkey, signature: notMinisign, data })).toThrow(
      "not a minisign file"
    );
    const shortKey = Buffer.from("untrusted comment: x\nQUJD\n").toString("base64");
    expect(() => verifyMinisign({ publicKey: shortKey, signature, data })).toThrow("Ed25519");
    const shortSig = Buffer.from("untrusted comment: x\nQUJD\n").toString("base64");
    expect(() => verifyMinisign({ publicKey: pubkey, signature: shortSig, data })).toThrow(
      "wrong length"
    );
    const unknown = Buffer.from(
      `untrusted comment: x\n${Buffer.concat([Buffer.from("XX"), KEY_ID, Buffer.alloc(64)]).toString("base64")}\n`
    ).toString("base64");
    expect(() => verifyMinisign({ publicKey: pubkey, signature: unknown, data })).toThrow(
      "unknown signature algorithm"
    );
  });
});
