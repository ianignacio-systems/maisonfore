/** A problem the person can fix (shown as is): 400. */
export class UserError extends Error {
  constructor(message: string) { super(message); this.name = 'UserError'; }
}
/** Not found, or not theirs to see (never says which): 404. */
export class NotFound extends Error {
  constructor(message = 'Not found.') { super(message); this.name = 'NotFound'; }
}
/** Signed in but not allowed: 403. */
export class Forbidden extends Error {
  constructor(message = 'You don’t have access to this.') { super(message); this.name = 'Forbidden'; }
}
