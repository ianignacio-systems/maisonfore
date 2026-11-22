import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { AuthError, ensureAccount, Forbidden, NotFound, syncAdminEmails, UserError, type Caller, type Db, type VerifyToken } from '@maison/core';
import { overview } from './overview';
import { coursePage, courseTimes, findCourses, golferBook, golferCancel, golferMove, golferProfile, myBookings, saveProfile } from './golf';
import { servePortal } from './portal';
import { changeRole, claimInvites, inviteStaff, listStaff, removeStaff } from './staff';
import { addBlock, changeStatus, createBooking, createSpecial, daySummary, editBooking, getBooking, moveBooking, recordPayment, removeBlock, staffSheet } from './bookings';
import {
  activity, adminCourses, CAN, courseAtAddress, createPartner, getCourse, loadSetup, me, readiness, reviewCourse, roleAt, saveFees, saveOptions, saveRates, saveRules, saveSheet, submitCourse, updateCourse,
} from './courses';

export const API_VERSION = 'v1';

export interface AppOptions {
  db: Db;
  verify: VerifyToken;
  corsOrigins?: string[];
  logger?: boolean;
  /** Maison admins by email (PLATFORM_ADMIN_EMAILS), once they have signed in. */
  adminEmails?: string[];
  now?: () => number;
  /** The built portal, served from the same address as the API (the Render test site). */
  portalDir?: string;
  /** The built golfer app, served at /play. */
  appDir?: string;
}

type P = { Params: { id: string; bid: string; slug: string }; Body: Record<string, unknown>; Querystring: Record<string, string> };

/** The MaisonFore API (/api/v1). Every course call checks that the caller belongs to the course and that their role allows it. */
export function buildApp(o: AppOptions): FastifyInstance {
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const { db } = o;
  const now = o.now ?? (() => Date.now());
  const origins = new Set(o.corsOrigins ?? []);
  const admins = (o.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      reply.header('access-control-allow-origin', origin).header('vary', 'origin')
        .header('access-control-allow-headers', 'authorization, content-type').header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        .header('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  const signedIn = async (req: FastifyRequest): Promise<Caller> => {
    const h = req.headers.authorization ?? '';
    if (!h.startsWith('Bearer ')) throw new AuthError();
    const c = await ensureAccount(db, await o.verify(h.slice(7)));
    await syncAdminEmails(db, c, admins);
    await claimInvites(db, c, now());
    return c;
  };

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof AuthError) return reply.code(401).send({ error: e.message });
    if (e instanceof Forbidden) return reply.code(403).send({ error: e.message });
    if (e instanceof NotFound) return reply.code(404).send({ error: e.message });
    if (e instanceof UserError) return reply.code(400).send({ error: e.message });
    if ((e as { validation?: unknown }).validation || (e as { statusCode?: number }).statusCode === 400) return reply.code(400).send({ error: 'The request is not valid.' });
    app.log.error(e);
    if (process.env.DEBUG_ERRORS) console.error(e);
    return reply.code(500).send({ error: 'Something went wrong on the server. Try again.' });
  });

  // ---- public
  app.get('/api/v1/health', async () => { await db.query('select 1'); return { ok: true, api: API_VERSION }; });
  app.get<P>('/api/v1/addresses/:slug', async (req) => courseAtAddress(db, req.params.slug));

  // ---- signed in
  app.get('/api/v1/me', async (req) => me(db, await signedIn(req)));
  app.post<P>('/api/v1/partners', async (req) => createPartner(db, await signedIn(req), req.body ?? {}, now()));

  // ---- a course
  app.get<P>('/api/v1/courses/:id', async (req) => {
    const c = await signedIn(req);
    const role = await roleAt(db, c, req.params.id);
    const holidays = await db.query<{ day: string; name: string }>('select day, name from holidays where business_id = $1', [req.params.id]);
    return {
      course: await getCourse(db, req.params.id), role, setup: await loadSetup(db, req.params.id), readiness: await readiness(db, req.params.id),
      holidayNames: Object.fromEntries(holidays.map((h) => [h.day, h.name])),
    };
  });
  app.put<P>('/api/v1/courses/:id', async (req) => updateCourse(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.put<P>('/api/v1/courses/:id/teetimes', async (req) => saveSheet(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.put<P>('/api/v1/courses/:id/rates', async (req) => saveRates(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.put<P>('/api/v1/courses/:id/fees', async (req) => saveFees(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.put<P>('/api/v1/courses/:id/options', async (req) => saveOptions(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.put<P>('/api/v1/courses/:id/rules', async (req) => saveRules(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.post<P>('/api/v1/courses/:id/submit', async (req) => submitCourse(db, await signedIn(req), req.params.id, now()));
  app.get<P>('/api/v1/courses/:id/activity', async (req) => activity(db, await signedIn(req), req.params.id, req.query.before ? Number(req.query.before) : undefined));

  app.get<P>('/api/v1/courses/:id/overview', async (req) => overview(db, await signedIn(req), req.params.id, now()));

  // ---- the golfer app
  app.get('/api/v1/golf/me', async (req) => golferProfile(db, await signedIn(req)));
  app.put<P>('/api/v1/golf/me', async (req) => saveProfile(db, await signedIn(req), req.body ?? {}, now()));
  app.get<P>('/api/v1/golf/courses', async (req) => { await signedIn(req); return findCourses(db, req.query, now()); });
  app.get<P>('/api/v1/golf/courses/:slug', async (req) => { await signedIn(req); return coursePage(db, req.params.slug, now()); });
  app.get<P>('/api/v1/golf/courses/:slug/times', async (req) => { await signedIn(req); return courseTimes(db, req.params.slug, req.query, now()); });
  app.post<P>('/api/v1/golf/courses/:slug/bookings', async (req) => golferBook(db, await signedIn(req), req.params.slug, req.body ?? {}, now()));
  app.get('/api/v1/golf/bookings', async (req) => myBookings(db, await signedIn(req), now()));
  app.post<P>('/api/v1/golf/bookings/:bid/cancel', async (req) => golferCancel(db, await signedIn(req), req.params.bid, now()));
  app.post<P>('/api/v1/golf/bookings/:bid/move', async (req) => golferMove(db, await signedIn(req), req.params.bid, req.body ?? {}, now()));

  // ---- staff (owners)
  app.get<P>('/api/v1/courses/:id/staff', async (req) => listStaff(db, await signedIn(req), req.params.id));
  app.post<P>('/api/v1/courses/:id/staff', async (req) => inviteStaff(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.put<P>('/api/v1/courses/:id/staff', async (req) => changeRole(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.delete<P & { Params: { email: string } }>('/api/v1/courses/:id/staff/:email', async (req) => removeStaff(db, await signedIn(req), req.params.id, decodeURIComponent((req.params as { email: string }).email), now()));

  // ---- the tee sheet and bookings
  app.get<P>('/api/v1/courses/:id/days', async (req) => daySummary(db, await signedIn(req), req.params.id, req.query, now()));
  app.get<P>('/api/v1/courses/:id/sheet', async (req) => staffSheet(db, await signedIn(req), req.params.id, req.query, now()));
  app.post<P>('/api/v1/courses/:id/bookings', async (req) => createBooking(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.post<P>('/api/v1/courses/:id/specials', async (req) => createSpecial(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.post<P>('/api/v1/courses/:id/holds', async (req) => createBooking(db, await signedIn(req), req.params.id, { ...req.body, hold: true }, now()));
  app.get<P>('/api/v1/courses/:id/bookings/:bid', async (req) => getBooking(db, await signedIn(req), req.params.id, req.params.bid));
  app.patch<P>('/api/v1/courses/:id/bookings/:bid', async (req) => editBooking(db, await signedIn(req), req.params.id, req.params.bid, req.body ?? {}, now()));
  app.post<P>('/api/v1/courses/:id/bookings/:bid/status', async (req) => changeStatus(db, await signedIn(req), req.params.id, req.params.bid, req.body ?? {}, now()));
  for (const [path, to] of [['confirm', 'confirmed'], ['check-in', 'checked_in'], ['no-show', 'no_show'], ['cancel', 'cancelled'], ['played', 'played']] as const) {
    app.post<P>(`/api/v1/courses/:id/bookings/:bid/${path}`, async (req) => changeStatus(db, await signedIn(req), req.params.id, req.params.bid, { ...req.body, to }, now()));
  }
  app.post<P>('/api/v1/courses/:id/bookings/:bid/move', async (req) => moveBooking(db, await signedIn(req), req.params.id, req.params.bid, req.body ?? {}, now()));
  app.post<P>('/api/v1/courses/:id/bookings/:bid/payment', async (req) => recordPayment(db, await signedIn(req), req.params.id, req.params.bid, req.body ?? {}, now()));
  app.post<P>('/api/v1/courses/:id/blocks', async (req) => addBlock(db, await signedIn(req), req.params.id, req.body ?? {}, now()));
  app.delete<P>('/api/v1/courses/:id/blocks/:bid', async (req) => removeBlock(db, await signedIn(req), req.params.id, req.params.bid, now()));

  // ---- Maison admin
  app.get('/api/v1/admin/courses', async (req) => adminCourses(db, await signedIn(req)));
  app.post<P>('/api/v1/admin/courses/:id/review', async (req) => reviewCourse(db, await signedIn(req), req.params.id, req.body ?? {}, now()));

  if (o.portalDir) servePortal(app, o.portalDir, o.appDir);
  void CAN;
  return app;
}
