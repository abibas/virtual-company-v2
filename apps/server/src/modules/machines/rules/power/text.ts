import type { MachinePowerPolicy } from '@mwc/shared/machines';

/** A power policy in plain words, for the power log's reasons (pure). */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The keep-on days in words: `every day`, `Mon–Fri`, `Mon, Wed, Fri`, `Sat, Sun`. */
export function daysText(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'every day';
  const runs: number[][] = [];
  for (const day of sorted) {
    const run = runs.at(-1);
    if (run !== undefined && run.at(-1) === day - 1) run.push(day);
    else runs.push([day]);
  }
  const name = (day: number) => DAY_NAMES[day - 1] ?? String(day);
  return runs
    .flatMap((run) =>
      run.length >= 3 ? [`${name(run[0] as number)}–${name(run.at(-1) as number)}`] : run.map(name),
    )
    .join(', ');
}

/** The keep-on hours in words: `Mon–Fri 09:00–19:00 Europe/Kyiv`. */
export function hoursText(policy: MachinePowerPolicy): string {
  const { days, from, to, timezone } = policy.keepOn;
  return `${daysText(days)} ${from}–${to} ${timezone}`;
}

const onOff = (value: boolean) => (value ? 'on' : 'off');

/** A policy in words, for its `policy` event. */
export function policyText(policy: MachinePowerPolicy): string {
  const hours = policy.keepOn.enabled ? `on (${hoursText(policy)})` : 'off';
  return [
    `Keep-on hours ${hours}`,
    `start when they begin: ${onOff(policy.autoStartAtKeepOn)}`,
    `stop when they end: ${onOff(policy.stopAtKeepOnEnd)}`,
    `hold after a turn: ${policy.holdAfterTurnMin} min`,
    `keep This Mac awake: ${onOff(policy.keepMacAwake)}`,
    `start on work: ${onOff(policy.autoStartOnWork)}`,
    `start on a message: ${onOff(policy.autoStartOnMessage)}`,
  ].join('; ');
}
