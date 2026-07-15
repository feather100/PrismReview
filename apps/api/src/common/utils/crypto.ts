/**
 * crypto.ts — AES-256-GCM Verschlüsselung für API-Keys.
 *
 * Secret kommt aus env (LLM_SECRET) oder wird einmalig generiert und in
 * data/.secret abgelegt (nur lokaler Dev-Fall). Der Plaintext-Key wird
 * NIE geloggt, NIE in Responses geschickt.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;

function resolveSecret(): string {
  const fromEnv = process.env.LLM_SECRET;
  if (fromEnv && fromEnv.length >= 8) return fromEnv;

  // Fallback: generiere einmalig eine lokale Datei (nur Dev!)
  const dir = join(process.cwd(), 'data');
  const file = join(dir, '.llm_secret');
  if (existsSync(file)) {
    return readFileSync(file, 'utf8').trim();
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const generated = randomBytes(32).toString('hex');
  writeFileSync(file, generated, { mode: 0o600 });
  // eslint-disable-next-line no-console
  console.warn('[crypto] LLM_SECRET nicht gesetzt — generiert:', file);
  return generated;
}

const SECRET = resolveSecret();
const KEY = scryptSync(SECRET, 'prismreview-static-salt', 32);

export function encryptApiKey(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(salt+iv+tag+enc) — self-contained für Decrypt
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptApiKey(encBase64: string): string {
  if (!encBase64) return '';
  const buf = Buffer.from(encBase64, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Maskiere einen Key für die Anzeige: sk-XXXX••••1234 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
