-- Golfers using the MaisonFore app: their profile on top of the Maison account. Residency is what the golfer
-- declares (local or foreign); checking it is a later step at registration.
create table golfers (
  account_id uuid primary key references accounts(id) on delete cascade,
  name text not null,
  mobile text not null default '',
  residency text not null default 'local' check (residency in ('local', 'foreign')),
  privacy_accepted_at bigint not null,
  created_at bigint not null,
  updated_at bigint not null
);
create index bookings_golfer_day on bookings (golfer_account, day) where golfer_account is not null;
