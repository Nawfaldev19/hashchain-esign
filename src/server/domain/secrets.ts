import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Link tokens and session tokens are random and shown to the holder once. Only
 * their SHA-256 hash is stored, so a copy of the database cannot be used to sign
 * in or to sign a document. A fast hash is enough here because the tokens carry
 * 256 bits of randomness; passwords, which people choose, go through scrypt.
 */

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const SCRYPT = { cost: 16384, blockSize: 8, parallelization: 1, keyLength: 32 } as const;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keyLength,
      { N: cost, r: SCRYPT.blockSize, p: SCRYPT.parallelization },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

/** Returns "scrypt$<cost>$<salt>$<key>", so the cost can be raised later. */
export async function hashPassword(password: string, cost: number = SCRYPT.cost): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return `scrypt$${cost}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, costText, saltText, keyText] = stored.split('$');
  const cost = Number(costText);
  if (scheme !== 'scrypt' || !Number.isInteger(cost) || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await derive(password, Buffer.from(saltText, 'base64url'), cost);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
