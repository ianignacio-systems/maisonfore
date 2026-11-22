/** The server's settings, from environment variables (see SETUP.md). */
export function loadConfig() {
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  const devAuth = env.MAISON_DEV_AUTH === '1';
  if (production && devAuth) throw new Error('MAISON_DEV_AUTH must not be set in production.');
  const databaseUrl = env.DATABASE_URL ?? '';
  if (production && !databaseUrl) throw new Error('DATABASE_URL is not set: the MaisonFore Supabase project’s connection string (Session pooler).');
  // The Render test site builds the portal and runs the server as one service, so one setting serves both.
  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (!devAuth && !supabaseUrl) throw new Error('SUPABASE_URL is not set: the Supabase project whose sign-in is the Maison account (today the MaisonPOS project).');
  return {
    production,
    devAuth,
    databaseUrl,
    supabaseUrl,
    jwtSecret: env.SUPABASE_JWT_SECRET ?? '',
    port: Number(env.PORT ?? 8787),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5174,http://localhost:5175').split(',').map((s) => s.trim()).filter(Boolean),
    /** SERVE_PORTAL=1: serve the built portal (portal/dist) from this server too. */
    portalDir: env.SERVE_PORTAL === '1' ? (env.PORTAL_DIR || new URL('../../portal/dist', import.meta.url).pathname) : '',
    /** With SERVE_PORTAL=1, the golfer app (app/dist) is served at /play. */
    appDir: env.SERVE_PORTAL === '1' ? (env.APP_DIR || new URL('../../app/dist', import.meta.url).pathname) : '',
    adminEmails: (env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}
