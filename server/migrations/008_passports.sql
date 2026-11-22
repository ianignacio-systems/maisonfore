-- Paying after playing: each player registers on arrival and gets a passport (their share of the booking,
-- plus food and drinks from the tee houses), settled at the counter after the round.

-- Registration details for each player (the booking's name is player 1's by default).
alter table booking_players add column mobile text not null default '';

-- Tee houses on the course, usually run by concessionaires. The club collects for them at the counter and
-- remits what's due: their sales less the club's share (share_bp, in hundredths of a percent; 0 = none).
-- Rent is recorded for reference and settled separately. receipts: who issues the receipt for their sales.
create table tee_houses (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  name text not null,
  concessionaire text not null default '',
  share_bp int not null default 0 check (share_bp between 0 and 10000),
  rent_amount int not null default 0,
  rent_note text not null default '',
  receipts text not null default 'club' check (receipts in ('club', 'tee_house')),
  active boolean not null default true,
  sort int not null default 0,
  created_at bigint not null,
  primary key (business_id, id)
);

create table tee_house_items (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  tee_house_id text not null,
  name text not null,
  price int not null check (price >= 0),
  active boolean not null default true,
  sort int not null default 0,
  primary key (business_id, id)
);

-- Which tee house a staff member with the Tee house role works at (by email, so invites work too).
create table tee_house_staff (
  business_id text not null references businesses(id) on delete cascade,
  email text not null,
  tee_house_id text not null,
  primary key (business_id, email)
);

-- Charges on a player's passport from a tee house (or added at the counter). client_id makes an order sent
-- twice from a phone that lost its signal count once.
create table passport_charges (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  booking_id text not null,
  player_n int not null,
  tee_house_id text,
  item_id text,
  label text not null,
  qty int not null default 1 check (qty between 1 and 99),
  unit_amount int not null check (unit_amount >= 0),
  amount int not null,
  client_id text,
  created_by text not null,
  created_at bigint not null,
  voided_at bigint,
  voided_by text,
  void_reason text not null default '',
  primary key (business_id, id)
);
create index passport_charges_booking on passport_charges (business_id, booking_id);
create index passport_charges_house on passport_charges (business_id, tee_house_id, created_at);
create unique index passport_charges_client on passport_charges (business_id, client_id) where client_id is not null;

-- Payments at the counter against passports: one player's (player_n), or the whole group's (null).
create table passport_payments (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  booking_id text not null,
  player_n int,
  amount int not null check (amount > 0),
  method text not null,
  ref text not null default '',
  created_by text not null,
  created_at bigint not null,
  primary key (business_id, id)
);
create index passport_payments_booking on passport_payments (business_id, booking_id);

-- What the club has paid each tee house, by day.
create table tee_house_remits (
  business_id text not null references businesses(id) on delete cascade,
  tee_house_id text not null,
  day text not null,
  amount int not null,
  note text not null default '',
  remitted_by text not null,
  remitted_at bigint not null,
  primary key (business_id, tee_house_id, day)
);

-- Charges that belong to one passport (a cart, a gallery guest, a once-per-booking fee) moved by the counter
-- to the player who pays them: { "<line>#<unit>": player number }.
alter table bookings add column passport_moves jsonb not null default '{}';
