import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

export function decryptPassword(encryptedHex: string, keyHex: string): string {
  const [ivHex, cipherHex] = encryptedHex.split(':');
  const key    = Buffer.from(keyHex, 'hex');
  const iv     = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted  = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted     += decipher.final('utf8');
  return decrypted;
}

export function encryptPassword(plaintext: string, keyHex: string): string {
  const key    = Buffer.from(keyHex, 'hex');
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted  = cipher.update(plaintext, 'utf8', 'hex');
  encrypted     += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}
