import { DEFAULT_OPTIONS, DEFAULT_RULES, zonedEpoch, type Booking, type CourseSetup, type PlayerType } from '../src';

export const TZ = 'Asia/Manila';
/** A course: 18 holes from the 1st, plus a two-tee start layout; 6:00 AM to 8:00 AM every 10 minutes. */
export function course(over: Partial<CourseSetup> = {}): CourseSetup {
  return {
    timeZone: TZ,
    layouts: [
      { id: 'L18', name: '18 holes', holes: 18, startTees: ['1'], active: true },
      { id: 'L2T', name: 'Two-tee start', holes: 18, startTees: ['1', '10'], active: true },
    ],
    settings: [
      { layoutId: 'L18', effectiveFrom: '2026-01-01', firstTee: 360, lastTee: 480, interval: 10, maxPlayers: 4 },
      { layoutId: 'L2T', effectiveFrom: '2026-01-01', firstTee: 360, lastTee: 420, interval: 10, maxPlayers: 4 },
    ],
    holidays: ['2026-12-25'],
    playerTypes: [pt('PUB', 'Public', true), pt('MEM', 'Member', false, { member: true })],
    rates: [
      { playerTypeId: 'PUB', dayType: 'weekday', holes: 18, band: 'regular', amount: 250000, effectiveFrom: '2026-01-01' },
      { playerTypeId: 'PUB', dayType: 'weekend', holes: 18, band: 'regular', amount: 350000, effectiveFrom: '2026-01-01' },
      { playerTypeId: 'PUB', dayType: 'weekday', holes: 18, band: 'twilight', amount: 180000, effectiveFrom: '2026-01-01' },
    ],
    rules: { ...DEFAULT_RULES },
    fees: [],
    options: { ...DEFAULT_OPTIONS },
    memberFeatures: false,
    ...over,
  };
}
/** A moment, Manila time. */
export const at = (day: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return zonedEpoch(day, h * 60 + m, TZ); };

let n = 0;
export function booking(over: Partial<Booking>): Booking {
  n++;
  return { id: `B${n}`, ref: `REF${n}`, layoutId: 'L18', startTee: '1', day: '2026-11-23', time: 360, players: 2, status: 'confirmed', channel: 'phone', holdExpiresAt: null, golferId: null, contactName: 'Juan', ...over };
}

export function pt(id: string, name: string, pub: boolean, over: Partial<PlayerType> = {}): PlayerType {
  return { id, name, public: pub, member: false, proof: '', days: [], earliest: null, active: true, ...over };
}
