import "server-only";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { LibraryError } from "./library-validation.ts";

const derive = promisify(scrypt);
export function credentials(value: unknown) {
  if (!value || typeof value !== "object")
    throw new LibraryError("Enter your username and password.");
  const v = value as Record<string, unknown>;
  if (
    typeof v.username !== "string" ||
    !/^[a-zA-Z0-9_]{3,32}$/.test(v.username.trim())
  )
    throw new LibraryError(
      "Use a username of 3–32 letters, numbers, or underscores."
    );
  if (
    typeof v.password !== "string" ||
    v.password.length < 12 ||
    v.password.length > 128
  )
    throw new LibraryError("Use a password between 12 and 128 characters.");
  return { username: v.username.trim().toLowerCase(), password: v.password };
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  encoded: string | undefined
) {
  const [salt, hash] = (
    encoded ?? `${"0".repeat(32)}:${"0".repeat(128)}`
  ).split(":");
  const key = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return (
    expected.length === key.length &&
    timingSafeEqual(key, expected) &&
    !!encoded
  );
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
