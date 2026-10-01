import crypto from "crypto";
import { ethers } from "ethers";

// Investor wallets are created and held by the platform (custodial). The
// private key is encrypted before it is stored, using WALLET_ENCRYPTION_KEY
// from the environment: 64 hex characters (32 bytes). TEST NETWORK ONLY until a
// proper key-management setup replaces this.

function getKey() {
  const hex = process.env.WALLET_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("WALLET_ENCRYPTION_KEY must be set to 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

export function encryptKey(privateKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptKey(blob) {
  const [v, iv, tag, enc] = String(blob).split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Unrecognized wallet key format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]).toString("utf8");
}

// Returns the investor's wallet address, creating the wallet first if they
// don't have one. Safe if two requests race: only one wallet is ever saved.
// `db` can be the pool or a client.
export async function ensureInvestorWallet(db, userId) {
  const have = await db.query(
    "SELECT wallet_address FROM users WHERE user_id = $1 AND role = 'investor'",
    [userId]
  );
  if (have.rows.length === 0) throw new Error("Investor not found");
  if (have.rows[0].wallet_address) return have.rows[0].wallet_address;

  const wallet = ethers.Wallet.createRandom();
  const saved = await db.query(
    `UPDATE users SET wallet_address = $2, wallet_key_enc = $3
      WHERE user_id = $1 AND wallet_address IS NULL
      RETURNING wallet_address`,
    [userId, wallet.address, encryptKey(wallet.privateKey)]
  );
  if (saved.rows.length > 0) return saved.rows[0].wallet_address;

  // someone else saved one a moment earlier - use theirs
  const again = await db.query("SELECT wallet_address FROM users WHERE user_id = $1", [userId]);
  return again.rows[0].wallet_address;
}
