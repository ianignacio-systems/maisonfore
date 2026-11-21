-- Maison core: the shared foundation every Maison product's database starts with (from MaisonPOS v1).
--
-- Maison account (the Supabase Auth user), business record with a Maison business ID, members and
-- their roles, invites, addresses, the activity log, and platform admins.
-- Money in centavos (bigint), times in epoch milliseconds (bigint), business days as 'YYYY-MM-DD' text.
-- Only the product's server connects; row-level security is on with no policies (see lockOutBrowserKeys).

create table accounts (
  id uuid primary key,                       -- Supabase Auth user id (the Maison account)
  email text not null,
  name text not null default '',
  mobile text not null default '',           -- +639XXXXXXXXX
  created_at bigint not null
);
create unique index accounts_email on accounts (lower(email));

create table businesses (
  id text primary key,
  maison_id uuid not null unique default gen_random_uuid(),   -- the Maison business ID, shared across products
  name text not null,
  owner_account uuid references accounts(id),
  slug text unique,
  settings jsonb not null default '{}',
  created_at bigint not null
);

create table slugs (
  slug text primary key check (slug ~ '^[a-z0-9]{3,30}$'),
  business_id text not null references businesses(id) on delete cascade,
  created_at bigint not null
);

-- Who can open a business, and as what. Each product names its own roles.
create table members (
  business_id text not null references businesses(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  email text not null,
  role text not null,
  added_at bigint not null,
  primary key (business_id, account_id)
);
create index members_account on members (account_id);

create table invites (
  business_id text not null references businesses(id) on delete cascade,
  email text not null,
  role text not null,
  invited_by text not null default '',
  created_at bigint not null,
  primary key (business_id, email)
);

-- The activity log: who changed what and when. Never updated or deleted.
create table audit (
  business_id text not null references businesses(id) on delete cascade,
  id text not null,
  at bigint not null,
  by_name text not null default '',
  action text not null,
  subject text not null default '',
  detail text not null default '',
  data jsonb,
  primary key (business_id, id)
);
create index audit_at on audit (business_id, at);

create table platform_admins (account_id uuid primary key references accounts(id), email text not null, added_at bigint not null);
create table platform_log (id bigserial primary key, at bigint not null, by_name text not null, action text not null, business_id text, detail text not null default '');
