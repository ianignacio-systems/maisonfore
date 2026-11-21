import { randomBytes } from 'node:crypto';

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** A 20-character record ID, the same shape as the app's Firestore IDs. */
export function newId(): string {
  const b = randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) s += CHARS[b[i] % CHARS.length];
  return s;
}
