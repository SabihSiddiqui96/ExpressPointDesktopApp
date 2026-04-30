import * as dotenv from 'dotenv';
import * as path from 'path';
import { decryptPassword } from './crypto';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function require_env(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const EP_USERNAME    = require_env('EP_USERNAME');
export const EP_CRYPTO_KEY  = require_env('EP_CRYPTO_KEY');
export const EP_PASSWORD    = decryptPassword(require_env('EP_PASSWORD_ENC'), EP_CRYPTO_KEY);
