-- MaisonFore: partner courses, their tee-sheet setup, holds and closures, and bookings.
--
-- Runs after the Maison core foundation. A partner course is a Maison business (businesses.id); its
-- tee sheet is worked out by the engine from these settings and is never stored.
-- Money in centavos (bigint), clock times as minutes after midnight (int), days as 'YYYY-MM-DD' text,
-- moments as epoch milliseconds (bigint).
--
-- Every row that the tee sheet reads carries `seq`, a number that goes up with every change, so a screen
-- can ask "anything new since?" cheaply.

create sequence if not exists fore_seq;
create or replace function fore_bump_seq() returns trigger language plpgsql as $$
begin new.seq := nextval('fore_seq'); return new; end $$;

create table courses (
  business_id text primary key references businesses(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'review', 'live', 'paused', 'declined')),
  address text not null default '',
  city text not null default '',
  province text not null default '',
  lat double precision,
  lng double precision,
  time_zone text not null default 'Asia/Manila',
  currency text not null default 'PHP',
  phone text not null default '',
  email text not null default '',
  description text not null default '',
  facilities jsonb not null default '[]',
  photos jsonb not null default '[]',
  rules jsonb not null default '{}',
  member_features boolean not null default false,   -- MaisonClub only; off for partner courses
  submitted_at bigint,
  reviewed_at bigint,
  reviewed_by text not null default '',
  review_note text not null default '',
  created_at bigint not null,
  seq bigint not null default nextval('fore_seq')
);

create table layouts (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  name text not null,
  holes int not null check (holes in (9, 18)),
  start_tees text[] not null default '{1}',
  active boolean not null default true,
  sort int not null default 0,
  seq bigint not null default nextval('fore_seq'),
  primary key (business_id, id)
);

create table sheet_settings (
  business_id text not null references businesses(id) on delete cascade,
  layout_id text not null,
  effective_from text not null,
  first_tee int not null,
  last_tee int not null,
  interval_min int not null,
  max_players int not null,
  seq bigint not null default nextval('fore_seq'),
  primary key (business_id, layout_id, effective_from),
  foreign key (business_id, layout_id) references layouts(business_id, id) on delete cascade
);

create table holidays (
  business_id text not null references businesses(id) on delete cascade,
  day text not null,
  name text not null default '',
  primary key (business_id, day)
);

create table player_types (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  name text not null,
  public boolean not null default false,
  member boolean not null default false,
  sort int not null default 0,
  primary key (business_id, id)
);

create table rates (
  business_id text not null references businesses(id) on delete cascade,
  player_type_id text not null,
  day_type text not null check (day_type in ('weekday', 'weekend', 'holiday')),
  holes int not null check (holes in (9, 18)),
  band text not null check (band in ('regular', 'twilight')),
  effective_from text not null,
  amount bigint not null check (amount >= 0),
  primary key (business_id, player_type_id, day_type, holes, band, effective_from)
);

-- Holds and closures. Removed ones stay, marked removed, so screens see the change.
create table blocks (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  layout_id text,
  start_tee text,
  day text not null,
  from_min int not null,
  to_min int not null check (to_min > from_min),
  kind text not null check (kind in ('walkin', 'regulars', 'event', 'maintenance', 'weather', 'members')),
  reason text not null default '',
  release_at bigint,
  created_by text not null default '',
  created_at bigint not null,
  removed_at bigint,
  seq bigint not null default nextval('fore_seq'),
  primary key (business_id, id)
);
create index blocks_day on blocks (business_id, day);

create table bookings (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  ref text not null,
  layout_id text not null,
  start_tee text not null,
  day text not null,
  time_min int not null,
  players int not null check (players between 1 and 5),
  status text not null check (status in ('held', 'confirmed', 'checked_in', 'played', 'cancelled', 'no_show', 'expired')),
  channel text not null check (channel in ('app', 'phone', 'viber', 'walkin', 'staff')),
  hold_expires_at bigint,
  golfer_account uuid references accounts(id),
  contact_name text not null default '',
  mobile text not null default '',
  email text not null default '',
  notes text not null default '',
  amount bigint not null default 0,                  -- total at booking time, centavos
  pay_status text not null default 'unpaid' check (pay_status in ('unpaid', 'paid_course', 'paid_online')),
  paid_amount bigint not null default 0,
  paid_method text not null default '',
  paid_ref text not null default '',
  cancel_reason text not null default '',
  created_by text not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  seq bigint not null default nextval('fore_seq'),
  primary key (business_id, id),
  unique (business_id, ref)
);
create index bookings_day on bookings (business_id, day, layout_id);
create index bookings_seq on bookings (business_id, seq);
create index bookings_golfer on bookings (golfer_account) where golfer_account is not null;

create table booking_players (
  business_id text not null,
  booking_id text not null,
  n int not null,
  name text not null default '',
  player_type_id text not null default '',
  rate bigint not null default 0,
  primary key (business_id, booking_id, n),
  foreign key (business_id, booking_id) references bookings(business_id, id) on delete cascade
);

-- One row per slot that has ever been booked: locked while a booking claims the slot, so two people
-- tapping the same time can't both get it.
create table slot_locks (
  business_id text not null references businesses(id) on delete cascade,
  layout_id text not null,
  start_tee text not null,
  day text not null,
  time_min int not null,
  primary key (business_id, layout_id, start_tee, day, time_min)
);

-- Messages waiting to go to golfers (a change, cancellation or weather stop on their booking).
create table notices (
  id bigserial primary key,
  business_id text not null references businesses(id) on delete cascade,
  booking_id text not null,
  kind text not null,
  detail text not null default '',
  created_at bigint not null,
  sent_at bigint
);

do $$
declare t text;
begin
  foreach t in array array['courses', 'layouts', 'sheet_settings', 'blocks', 'bookings'] loop
    execute format('create trigger %I before update on %I for each row execute function fore_bump_seq()', t || '_seq', t);
  end loop;
end $$;
