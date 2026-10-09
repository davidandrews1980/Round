import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encryption at rest for users' provider keys (AES-256-GCM).
 *
 * Stored format: `enc:v1:<iv>.<tag>.<ciphertext>` (base64url parts). The key is
 * derived (HKDF-SHA256) from the `KEYS_ENCRYPTION_SECRET` env var, so a leaked
 * database dump alone does not reveal provider keys.
 *
 * - Secret set: new keys are encrypted; older plaintext rows still read fine
 *   (and are re-encrypted the next time the user saves that key).
 * - Secret unset: allowed outside production (plaintext, local dev); in
 *   production saving a key throws rather than silently storing plaintext.
 * - Rotating/losing the secret makes existing encrypted keys unreadable —
 *   users re-enter them.
 */
const PREFIX = "enc:v1:";

function masterSecret(): string | undefined {
  const v = process.env.KEYS_ENCRYPTION_SECRET?.trim();
  return v || undefined;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, "roundtable-keys-v1", "api-key-encryption", 32),
  );
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  const secret = masterSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "KEYS_ENCRYPTION_SECRET is not set on the server, so keys cannot be stored safely.",
      );
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

/** Returns the plaintext, or null when it cannot be decrypted. */
export function decryptSecret(stored: string): string | null {
  if (!isEncrypted(stored)) return stored;
  const secret = masterSecret();
  if (!secret) return null;
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(".");
  if (!iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
