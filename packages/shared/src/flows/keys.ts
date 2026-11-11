/** A task's key in its company (S5.3a): `T-` and its number. */
export const taskKey = (number: number): string => `T-${number}`;

/** The number of a task key (`T-12`, any case), or undefined for anything else. */
export function taskNumber(key: string): number | undefined {
  const match = /^t-([1-9]\d{0,8})$/i.exec(key.trim());
  return match ? Number(match[1]) : undefined;
}
