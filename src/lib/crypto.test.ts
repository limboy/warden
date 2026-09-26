import { describe, expect, it } from "vitest";
import {
  CorruptVaultError,
  WrongPasswordError,
  createVaultKey,
  seal,
  unlock,
  unlockWithKey,
} from "./crypto";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Build a vault file exactly as the v1 app (PBKDF2 100k, no AAD) did. */
async function legacyV1Vault(plaintext: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: 1,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
  });
}

describe("seal / unlock", () => {
  it("round-trips unicode content", async () => {
    const vk = await createVaultKey("hunter2");
    const text = "# 标题\n\n密码 🔐 – café\n";
    const { content, outdated } = await unlock(await seal(text, vk), "hunter2");
    expect(content).toBe(text);
    expect(outdated).toBe(false);
  });

  it("round-trips empty content", async () => {
    const vk = await createVaultKey("pw");
    expect((await unlock(await seal("", vk), "pw")).content).toBe("");
  });

  it("handles content far beyond the call-stack argument limit", async () => {
    const vk = await createVaultKey("pw");
    const big = "中文🙂".repeat(200_000); // ~2.2 MB of UTF-8
    expect((await unlock(await seal(big, vk), "pw")).content).toBe(big);
  });

  it("writes a v2 header with KDF parameters", async () => {
    const vk = await createVaultKey("pw");
    const file = JSON.parse(await seal("x", vk));
    expect(file).toMatchObject({ v: 2, kdf: "PBKDF2-SHA256", iter: 600_000 });
    expect(vk.iterations).toBe(600_000);
  });

  it("uses a fresh IV for every seal with the same key", async () => {
    const vk = await createVaultKey("pw");
    const a = JSON.parse(await seal("same", vk));
    const b = JSON.parse(await seal("same", vk));
    expect(a.salt).toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("returns a key that can re-seal without the password", async () => {
    const vk = await createVaultKey("pw");
    const { vaultKey } = await unlock(await seal("a", vk), "pw");
    expect((await unlock(await seal("b", vaultKey), "pw")).content).toBe("b");
  });
});

describe("failure modes", () => {
  it("rejects a wrong password", async () => {
    const vk = await createVaultKey("right");
    await expect(unlock(await seal("x", vk), "wrong")).rejects.toBeInstanceOf(
      WrongPasswordError
    );
  });

  it.each([
    ["not JSON", "garbage"],
    ["empty object", "{}"],
    ["null", "null"],
    ["unknown version", JSON.stringify({ v: 99, salt: "", iv: "", ct: "" })],
    [
      "unknown KDF",
      JSON.stringify({ v: 2, kdf: "md5", iter: 1, salt: "", iv: "", ct: "" }),
    ],
    [
      "bad base64",
      JSON.stringify({ v: 1, salt: "!!!", iv: "!!!", ct: "!!!" }),
    ],
  ])("reports a corrupt vault: %s", async (_, data) => {
    await expect(unlock(data, "pw")).rejects.toBeInstanceOf(CorruptVaultError);
  });

  it("detects a tampered header (iteration downgrade)", async () => {
    const vk = await createVaultKey("pw");
    const file = JSON.parse(await seal("x", vk));
    file.iter = 1;
    await expect(unlock(JSON.stringify(file), "pw")).rejects.toBeInstanceOf(
      WrongPasswordError
    );
  });

  it("detects tampered ciphertext", async () => {
    const vk = await createVaultKey("pw");
    const file = JSON.parse(await seal("hello world", vk));
    const ct = Uint8Array.from(atob(file.ct), (c) => c.charCodeAt(0));
    ct[0] ^= 1;
    file.ct = b64(ct);
    await expect(unlock(JSON.stringify(file), "pw")).rejects.toBeInstanceOf(
      WrongPasswordError
    );
  });
});

describe("legacy v1 vaults", () => {
  it("opens and flags them as outdated", async () => {
    const result = await unlock(await legacyV1Vault("old note", "pw"), "pw");
    expect(result.content).toBe("old note");
    expect(result.outdated).toBe(true);
    expect(result.vaultKey.iterations).toBe(100_000);
  });

  it("rejects a wrong password", async () => {
    await expect(
      unlock(await legacyV1Vault("x", "pw"), "nope")
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe("unlockWithKey", () => {
  it("decrypts files sealed with the same key parameters", async () => {
    const vk = await createVaultKey("pw");
    expect(await unlockWithKey(await seal("snap", vk), vk)).toBe("snap");
  });

  it("returns null for files sealed under a different salt", async () => {
    const before = await createVaultKey("pw");
    const after = await createVaultKey("pw");
    expect(await unlockWithKey(await seal("x", before), after)).toBeNull();
  });
});
