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

/**
 * SSRF guard for user-supplied provider baseUrl (Sprint 9.x review finding).
 *
 * The provider test/connection path issues server-side `fetch(baseUrl/models)`
 * with the (decrypted) API key in the Authorization header. If a tenant can set
 * an arbitrary baseUrl, that becomes an SSRF vector against internal services
 * (cloud metadata 169.254.169.254, localhost admin ports, RFC1918 ranges).
 *
 * This rejects anything that does not resolve to a public, routable host:
 *  - non-http(s) schemes
 *  - literal loopback / link-local / private / unspecified addresses
 *  - hostnames that fail to resolve (defense-in-depth; DNS rebinding still
 *    needs egress filtering at the infra layer, but this blocks the easy path)
 *
 * Throws BadRequestException on rejection so callers can surface a 400.
 */
import { lookup } from 'dns/promises';
import { BadRequestException } from '@nestjs/common';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  '0:0:0:0:0:0:0:1',
  '169.254.169.254', // cloud metadata
  '169.254.0.1', // cloud metadata (GCP)
]);

function isPrivateIp(ip: string): boolean {
  // IPv4
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 127) return true;
    if (a === 0) return true;
    return false;
  }
  // IPv6 — block everything except globally routable (simplest safe stance)
  if (ip.includes(':')) {
    if (ip === '::1' || ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

export async function assertPublicUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(`Invalid baseUrl: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException(`baseUrl scheme must be http(s): ${raw}`);
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    throw new BadRequestException(`baseUrl points to a forbidden host: ${host}`);
  }
  // Literal IP (skip DNS for IPv6 with zone index etc.)
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) {
      throw new BadRequestException(`baseUrl points to a private/loopback address: ${host}`);
    }
    return;
  }
  // Hostname → resolve and reject if any resolved address is private
  try {
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        throw new BadRequestException(`baseUrl resolves to a private address: ${host} → ${a.address}`);
      }
    }
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    // DNS failure → fail closed (don't let unresolvable names through)
    throw new BadRequestException(`baseUrl host could not be resolved: ${host}`);
  }
}
