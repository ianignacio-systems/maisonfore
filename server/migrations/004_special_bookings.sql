-- Special bookings: a VIP, a member or a favour accepted by the owner or a manager outside the sheet. They
-- take no slot's spots and may have no set time.
alter table bookings add column special boolean not null default false;
alter table bookings alter column time_min drop not null;
