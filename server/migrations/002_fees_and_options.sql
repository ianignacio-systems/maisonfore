-- Flexible pricing, the Philippine way: player types with their own days and hours (seniors on
-- Wednesdays, juniors from 11:00 AM), fees on top of the green fee (golf cart, caddie, gallery,
-- insurance, development fee…), course options, and bookings that keep the price line by line.

alter table player_types
  add column proof text not null default '',
  add column days int[] not null default '{}',
  add column earliest int,
  add column active boolean not null default true;

alter table courses add column options jsonb not null default '{}';

create table fees (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  name text not null,
  kind text not null check (kind in ('cart', 'caddie', 'gallery', 'other')),
  per text not null check (per in ('player', 'cart', 'guest', 'booking')),
  required boolean not null default false,
  in_app boolean not null default true,
  active boolean not null default true,
  amounts jsonb not null default '[]',   -- [{ holes, dayType, playerTypeId, amount }]
  sort int not null default 0,
  primary key (business_id, id)
);

alter table bookings
  add column holes int not null default 18 check (holes in (9, 18)),
  add column carts int not null default 0,
  add column caddies int not null default 0,
  add column gallery int not null default 0,
  add column extras jsonb not null default '[]',
  add column quote jsonb not null default '[]',   -- the price, line by line, when booked or last changed
  add column pay_in_app bigint not null default 0;
