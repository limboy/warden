const KDF = "PBKDF2-SHA256";
const PBKDF2_ITERATIONS = 600_000;
const FORMAT_VERSION = 2;

/** A derived vault key plus the KDF parameters needed to write a file header. */
export interface VaultKey {
  key: CryptoKey;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WrongPasswordError";
  }
}

export class CorruptVaultError extends Error {
  constructor(detail: string) {
    super(`Vault file is corrupted or not a Warden vault (${detail})`);
    this.name = "CorruptVaultError";
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toBase64(bytes: Uint8Array): string {
  // Chunked to avoid blowing the call stack on large inputs.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Header fields authenticated as AES-GCM additional data. */
function headerAad(salt: string, iterations: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({ v: FORMAT_VERSION, kdf: KDF, iter: iterations, salt })
  );
}

/** Derive a fresh key (new random salt) for a new vault or a password change. */
export async function createVaultKey(password: string): Promise<VaultKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  return { key, salt, iterations: PBKDF2_ITERATIONS };
}

/** Encrypt content with an already-derived key. Each call uses a fresh IV. */
export async function seal(plaintext: string, vk: VaultKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = toBase64(vk.salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: headerAad(salt, vk.iterations) },
    vk.key,
    new TextEncoder().encode(plaintext)
  );

  return JSON.stringify({
    v: FORMAT_VERSION,
    kdf: KDF,
    iter: vk.iterations,
    salt,
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ciphertext)),
  });
}

export interface UnlockResult {
  content: string;
  vaultKey: VaultKey;
  /** True when the file uses weaker legacy parameters and should be re-keyed. */
  outdated: boolean;
}

export async function unlock(
  data: string,
  password: string
): Promise<UnlockResult> {
  let parsed: {
    v?: unknown;
    kdf?: unknown;
    iter?: unknown;
    salt?: unknown;
    iv?: unknown;
    ct?: unknown;
  };
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new CorruptVaultError("invalid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.salt !== "string" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.ct !== "string"
  ) {
    throw new CorruptVaultError("missing fields");
  }

  let iterations: number;
  let aad: Uint8Array<ArrayBuffer> | undefined;
  if (parsed.v === 1) {
    iterations = 100_000;
  } else if (parsed.v === 2) {
    if (parsed.kdf !== KDF || typeof parsed.iter !== "number") {
      throw new CorruptVaultError("unsupported KDF");
    }
    iterations = parsed.iter;
    aad = headerAad(parsed.salt, iterations);
  } else {
    throw new CorruptVaultError(`unsupported version ${String(parsed.v)}`);
  }

  let salt, iv, ct;
  try {
    salt = fromBase64(parsed.salt);
    iv = fromBase64(parsed.iv);
    ct = fromBase64(parsed.ct);
  } catch {
    throw new CorruptVaultError("invalid encoding");
  }

  const key = await deriveKey(password, salt, iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      aad ? { name: "AES-GCM", iv, additionalData: aad } : { name: "AES-GCM", iv },
      key,
      ct
    );
  } catch {
    // AES-GCM cannot distinguish a wrong key from tampered ciphertext.
    throw new WrongPasswordError();
  }

  return {
    content: new TextDecoder().decode(plaintext),
    vaultKey: { key, salt, iterations },
    outdated: parsed.v !== FORMAT_VERSION || iterations < PBKDF2_ITERATIONS,
  };
}
