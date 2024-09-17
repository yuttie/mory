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
