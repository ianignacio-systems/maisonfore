/**
 * The tee-sheet engine's vocabulary. Plain data, no database: the server loads these, the engine works
 * out the sheet and the rules, and the same code runs in tests, the portal and the golfer app.
 *
 * Units: money in centavos (whole numbers), clock times as minutes after midnight in the course's own
 * time zone (6:30 AM = 390), days as 'YYYY-MM-DD' in the course's time zone, moments as epoch milliseconds.
 */

export type Day = string;
export type Minutes = number;

/**
 * One course at the club, with its own tee sheet: e.g. "North course", 18 holes, flights from the 1st and
 * 10th. A course has 9 or 18 holes; a club with more than one course has one of these for each.
 */
export interface Layout {
  id: string;
  name: string;
  holes: 9 | 18;
  /** Where flights start: ['1'] or ['1', '10']. */
  startTees: string[];
  active: boolean;
}

/** A layout's tee times, in force from a day until the next settings for the same layout. */
export interface SheetSettings {
  layoutId: string;
  effectiveFrom: Day;
  firstTee: Minutes;
  lastTee: Minutes;
  /** Minutes between flights. */
  interval: number;
  /** Players per flight (usually 4). */
  maxPlayers: number;
}

export type DayType = 'weekday' | 'weekend' | 'holiday';
export type TimeBand = 'regular' | 'twilight';

/**
 * Who is playing, for pricing: Local, Foreign, Senior, Junior, Member's guest… Each has its own green
 * fees, and can be limited to some days or to tee times from a set time (e.g. seniors on Wednesdays,
 * juniors from 11:00 AM).
 */
export interface PlayerType {
  id: string;
  name: string;
  /** Golfers can pick it when they book in the app. Otherwise only staff can. */
  public: boolean;
  /** A member type: only used once MaisonClub runs the course (switched off for partner courses). */
  member: boolean;
  /** What the golfer shows at the counter, e.g. "Senior citizen ID". Empty = nothing. */
  proof: string;
  /** Days it can play, 0 = Sunday … 6 = Saturday. Empty = every day. */
  days: number[];
  /** Earliest tee time it can book; null = any time. */
  earliest: Minutes | null;
  /** Switched off types keep their history but can't be booked. */
  active: boolean;
}

export interface Rate {
  playerTypeId: string;
  dayType: DayType;
  holes: 9 | 18;
  band: TimeBand;
  /** Per player, centavos. */
  amount: number;
  effectiveFrom: Day;
}

export interface BookingRules {
  /** How many days ahead the public can book (0 = today only). */
  publicDaysAhead: number;
  /** Clock time a new day opens to the public, e.g. 7:00 AM = 420. */
  releaseTime: Minutes;
  /** Golfers can cancel or move up to this many hours before the tee time. Staff can any time. */
  cancelCutoffHours: number;
  /** Most players in one booking (usually the flight size). */
  maxPlayersPerBooking: number;
  /** Most bookings a golfer can have open at once. */
  maxOpenBookingsPerGolfer: number;
  /** Minutes a hold keeps the slot while the golfer pays or staff finish the booking. */
  holdMinutes: number;
  /** Twilight rates from this clock time; null = no twilight band. */
  twilightFrom: Minutes | null;
  /** No-shows in the last 90 days that block app booking; 0 = never block. */
  noShowLimit: number;
  /** MaisonClub only (switched off for partner courses): how many days ahead members can book. */
  memberDaysAhead: number | null;
}

export type BlockKind = 'walkin' | 'regulars' | 'event' | 'maintenance' | 'weather' | 'members';

/** Slots held back or closed. `to` is exclusive: 6:00 to 8:00 covers 6:00 … 7:52. */
export interface Block {
  id: string;
  /** null = every layout. */
  layoutId: string | null;
  /** null = every starting tee. */
  startTee: string | null;
  day: Day;
  from: Minutes;
  to: Minutes;
  kind: BlockKind;
  reason: string;
  /** When held slots open to the app on their own (epoch ms); null = only when staff release them. */
  releaseAt: number | null;
}

export type BookingStatus = 'held' | 'confirmed' | 'checked_in' | 'played' | 'cancelled' | 'no_show' | 'expired';
export type Channel = 'app' | 'phone' | 'viber' | 'walkin' | 'staff';

export interface Booking {
  id: string;
  ref: string;
  layoutId: string;
  startTee: string;
  day: Day;
  time: Minutes;
  players: number;
  status: BookingStatus;
  channel: Channel;
  /** Set while held: when the hold runs out (epoch ms). */
  holdExpiresAt: number | null;
  /** The golfer's Maison account, for app bookings. */
  golferId: string | null;
  contactName: string;
}

export type FeeKind = 'cart' | 'caddie' | 'gallery' | 'other';
/** What a fee is counted by: each player, each cart, each gallery guest, or once a booking. */
export type FeePer = 'player' | 'cart' | 'guest' | 'booking';
export type PaidTo = 'booking' | 'counter' | 'direct';

/**
 * One amount of a fee. A fee can differ by holes, by weekday or weekend (holidays use the weekend
 * amount) and by player type (e.g. a development fee of ₱40 for locals and ₱60 for foreigners).
 */
export interface FeeAmount {
  holes: 9 | 18;
  dayType: 'weekday' | 'weekend';
  /** null = every player type. */
  playerTypeId: string | null;
  amount: number;
}

/** Charges on top of the green fee: golf cart, caddie, gallery, insurance, development fee… */
export interface Fee {
  id: string;
  name: string;
  kind: FeeKind;
  per: FeePer;
  /** Always charged (e.g. caddie at most Philippine courses). Otherwise the golfer or staff choose it. */
  required: boolean;
  /**
   * How it is paid: with the booking (in the app, or with the green fee at the counter), separately at
   * the counter, or straight to the caddie (the amount is then the minimum the golfer pays the caddie).
   */
  paidTo: PaidTo;
  active: boolean;
  amounts: FeeAmount[];
}

/** Course-wide choices that shape a booking. */
export interface CourseOptions {
  /** Players per golf cart (2 = twin sharing). */
  cartSeats: number;
  /** Golfers can book 9 holes on an 18-hole layout. */
  nineHoles: boolean;
  /** Most non-playing guests (gallery) per booking; 0 = no gallery. */
  galleryMax: number;
}

export const DEFAULT_OPTIONS: CourseOptions = { cartSeats: 2, nineHoles: true, galleryMax: 2 };

/** Everything the engine needs to know about a course. */
export interface CourseSetup {
  timeZone: string;
  layouts: Layout[];
  settings: SheetSettings[];
  holidays: Day[];
  playerTypes: PlayerType[];
  rates: Rate[];
  rules: BookingRules;
  fees: Fee[];
  options: CourseOptions;
  /** Partner courses: false. MaisonClub courses: member windows, member-only times, charging to accounts. */
  memberFeatures: boolean;
}

/** Who is looking at or booking the sheet. */
export type Audience = 'staff' | 'public' | 'member';

export type SlotState =
  | 'open'          // bookable, nobody on it yet
  | 'partial'       // some players on it, room for more
  | 'full'
  | 'held'          // held back by staff (walk-ins, regulars, event); the public sees it as unavailable
  | 'closed'        // maintenance or weather
  | 'members'       // member-only time
  | 'not_released'  // beyond the public booking window
  | 'past';

export interface Slot {
  layoutId: string;
  startTee: string;
  day: Day;
  time: Minutes;
  capacity: number;
  /** Players on active bookings. */
  used: number;
  free: number;
  state: SlotState;
  /** The block that holds or closes it, if any. */
  block: Block | null;
  /** Active bookings on it (staff view only; empty for the public). */
  bookings: Booking[];
}

export const DEFAULT_RULES: BookingRules = {
  publicDaysAhead: 7,
  releaseTime: 7 * 60,
  cancelCutoffHours: 24,
  maxPlayersPerBooking: 4,
  maxOpenBookingsPerGolfer: 2,
  holdMinutes: 10,
  twilightFrom: null,
  noShowLimit: 2,
  memberDaysAhead: null,
};
