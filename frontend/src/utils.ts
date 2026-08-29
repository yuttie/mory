export type Comparable = number | string | Date;

export function by<T>(keyFn: (item: T) => Comparable): (a: T, b: T) => number {
  return (a, b) => {
    const keyA = keyFn(a);
    const keyB = keyFn(b);
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return 0;
  };
}

// Order two RFC3339 timestamps newest first.
//
// By instant rather than by string: a repository's commit times carry the committer's UTC offset,
// so `09:00+09:00` is 00:00Z and precedes `01:00Z` however the two sort as text. An unparseable
// time sorts oldest rather than poisoning the comparison, and equal instants compare equal so the
// caller can break the tie on something stable.
export function compareInstantsDesc(a: string, b: string): number {
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (Number.isNaN(at) !== Number.isNaN(bt)) {
    return Number.isNaN(at) ? 1 : -1;
  }
  if (Number.isNaN(at) || at === bt) {
    return 0;
  }
  return bt - at;
}
