/**
 * Each business has its own address: product.com/<slug> (e.g. maisonfore.com/valleygolf). An old address
 * keeps leading to the business after it changes. `reserved`: words the product itself uses.
 */
export const COMMON_RESERVED = [
  'admin', 'api', 'app', 'login', 'logout', 'signin', 'signup', 'register', 'start', 'trial', 'join', 'invite', 'reset', 'account', 'settings', 'billing', 'portal', 'dashboard', 'assets', 'brand', 'icons', 'static', 'sw', 'workbox', 'manifest', 'offline',
  'www', 'home', 'index', 'demo', 'pricing', 'plans', 'features', 'about', 'contact', 'blog', 'news', 'faq', 'help', 'support', 'docs', 'guide', 'guides', 'learn', 'resources', 'terms', 'privacy', 'legal', 'security', 'careers', 'jobs', 'partners', 'affiliates', 'referral', 'customers', 'stories', 'press', 'media', 'download', 'downloads', 'status', 'events', 'shop', 'test',
];

export function slugify(name: string, reserved: Set<string>, suffix = 'club'): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
  return s.length < 3 || reserved.has(s) ? `${s}${suffix}`.slice(0, 30) : s;
}

export function validSlug(s: string, reserved: Set<string>, product = 'Maison'): string | null {
  if (!/^[a-z0-9]{3,30}$/.test(s)) return 'Use 3 to 30 lowercase letters and numbers, no spaces.';
  if (reserved.has(s)) return `That word is used by ${product} itself. Choose another.`;
  return null;
}
