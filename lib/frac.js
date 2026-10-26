// Exact rational arithmetic for musical durations (values in whole-note units).
export function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a || 1;
}

export function f(n, d = 1) {
  if (!Number.isInteger(n) || !Number.isInteger(d)) throw new Error(`bad fraction ${n}/${d}`);
  if (d === 0) throw new Error('division by zero');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const ZERO = f(0, 1);
export const add = (a, ...rest) => rest.reduce((acc, b) => f(acc.n * b.d + b.n * acc.d, acc.d * b.d), a);
export const sub = (a, b) => f(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => f(a.n * b.n, a.d * b.d);
export const div = (a, b) => (b.n === 0 ? (() => { throw new Error('div by zero'); })() : f(a.n * b.d, a.d * b.n));
export const cmp = (a, b) => a.n * b.d - b.n * a.d;
export const eq = (a, b) => cmp(a, b) === 0;
export const isZero = (a) => a.n === 0;
export const toNumber = (a) => a.n / a.d;
export const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);
export const $ = (a) => (a.d === 1 ? `${a.n}` : `${a.n}/${a.d}`);

export const HALF = f(1, 2);
export const QUARTER = f(1, 4);

// Split a duration into a list of standard notatable durations (largest first).
const STANDARD = [f(1, 1), f(3, 4), f(1, 2), f(5, 8), f(3, 8), f(1, 4), f(3, 16), f(1, 8), f(3, 32), f(1, 16), f(1, 32), f(1, 64), f(1, 128)];
export function splitDuration(total) {
  const out = [];
  let rest = total;
  let guard = 0;
  while (!isZero(rest) && guard++ < 64) {
    const hit = STANDARD.find((s) => cmp(s, rest) <= 0);
    if (!hit) break;
    out.push(hit);
    rest = sub(rest, hit);
  }
  return out;
}
