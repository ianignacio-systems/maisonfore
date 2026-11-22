-- Payment deadlines tied to the tee time replace "hours after booking" (rules.paymentGraceHours is no longer
-- read; rules.payBeforeMinutes and rules.payWithinDays take its place, in the course's rules).

-- Waiting for a tee time. kind 'standby': a group waiting at the counter, kept by staff. kind 'app': a golfer
-- on the app waitlist for a range of times on a day. When spots open, the first app golfer in line who fits
-- gets an offer: a hold in their name (booking_id) they can claim until offer_expires_at. Under an hour
-- before the tee time everyone who fits is told at once instead (last_told_at).
create table waitlist (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('app', 'standby')),
  golfer_account uuid references accounts(id) on delete cascade,
  layout_id text,
  day text not null,
  from_min int not null,
  to_min int not null,
  players int not null check (players between 1 and 5),
  contact_name text not null default '',
  mobile text not null default '',
  notes text not null default '',
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'missed', 'cancelled', 'expired')),
  booking_id text,
  offer_expires_at bigint,
  last_told_at bigint,
  told_times jsonb not null default '[]',
  created_by text not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  seq bigint not null default nextval('fore_seq'),
  primary key (business_id, id)
);
create index waitlist_day on waitlist (business_id, day, status);
create index waitlist_golfer on waitlist (golfer_account, day) where golfer_account is not null;
create trigger waitlist_seq before update on waitlist for each row execute function fore_bump_seq();

-- Phone alerts (Web Push) for golfers who turned them on in the app: one row per phone or browser.
create table push_subs (
  endpoint text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  keys jsonb not null,
  created_at bigint not null
);
create index push_subs_account on push_subs (account_id);

-- What golfers are told in the app (and by phone alert when they allow it): payment reminders, waitlist
-- offers, a time that opened, a booking changed by the course.
create table golfer_messages (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  business_id text,
  kind text not null,
  title text not null,
  body text not null,
  link text not null default '',
  ref_id text not null default '',
  created_at bigint not null,
  read_at bigint
);
create index golfer_messages_account on golfer_messages (account_id, created_at desc);
create unique index golfer_messages_once on golfer_messages (account_id, kind, ref_id) where ref_id <> '';

-- Phone alerts go out from the server's minute-by-minute round; pushed_at marks those already sent.
alter table golfer_messages add column pushed_at bigint;
