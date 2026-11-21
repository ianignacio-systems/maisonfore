-- Each fee says how it is paid: with the booking, separately at the counter, or straight to the caddie
-- (a minimum).

alter table fees add column paid_to text not null default 'booking' check (paid_to in ('booking', 'counter', 'direct'));
update fees set paid_to = case when in_app then 'booking' else 'counter' end;
alter table fees drop column in_app;
