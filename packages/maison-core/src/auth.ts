import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Who is calling: the Maison account behind the request's access token. Sign-in happens in the browser
 * with Supabase Auth (the Maison account, today the MaisonPOS project's sign-in); a server only checks the token.
 */
export interface Caller {
  accountId: string;
  email: string;
}
export type VerifyToken = (token: string) => Promise<Caller>;

export class AuthError extends Error {
  constructor(message = 'Sign in again.') { super(message); this.name = 'AuthError'; }
}

/**
 * Checks a Supabase access token against the project's public signing keys (or, for projects still on the
 * legacy shared secret, against SUPABASE_JWT_SECRET).
 */
export function supabaseVerifier(supabaseUrl: string, jwtSecret = ''): VerifyToken {
  const secret = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;
  const jwks = secret ? null : createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return async (token) => {
    let payload: JWTPayload;
    try {
      const opts = { issuer: `${supabaseUrl}/auth/v1`, audience: 'authenticated' };
      payload = secret ? (await jwtVerify(token, secret, opts)).payload : (await jwtVerify(token, jwks!, opts)).payload;
    } catch {
      throw new AuthError();
    }
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!payload.sub || !email) throw new AuthError();
    return { accountId: payload.sub, email };
  };
}

/**
 * Local development only: a token "dev:<email>" signs in as that email, with a fixed account id made from
 * it. Never used when NODE_ENV is production (the server refuses to start with it).
 */
export function devVerifier(): VerifyToken {
  return async (token) => {
    if (!token.startsWith('dev:')) throw new AuthError();
    const email = token.slice(4).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError();
    return { accountId: await devAccountId(email), email };
  };
}

async function devAccountId(email: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256').update(`maison-dev:${email}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
