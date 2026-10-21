import { createHmac } from "crypto";

export function hashPatientToken(token: string) {
  const secret = process.env.TOKEN_HASH_SECRET;
  if (!secret || secret === "change-me") throw new Error("TOKEN_HASH_SECRET is not securely configured");
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}
