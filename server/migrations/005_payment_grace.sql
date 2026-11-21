-- Unpaid phone, Viber and walk-in bookings keep their tee time until pay_due_by; after that they are pencil
-- bookings that no longer take their spots. null = paid, or the club gives no time limit.
alter table bookings add column pay_due_by bigint;
