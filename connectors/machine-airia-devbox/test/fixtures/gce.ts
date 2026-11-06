// Hand-written gcloud answers shaped like GCE's real output (`compute instances describe|list --format=json`), and
// a fake `CommandRun` that answers by the command line. No test ever runs gcloud or the airia CLI.
import type { CommandRun, RunResult } from '../../src/run.ts';

const API = 'https://www.googleapis.com/compute/v1/projects/airia-devbox';
export const ZONE = 'us-central1-a';
export const ACCOUNT = 'Ihor.Herasko@airia.com';
export const BOX = 'dev-ihor-herasko';
export const REF = { instance: BOX, zone: ZONE } as const;

export interface InstanceInput {
  readonly name?: string;
  readonly zone?: string;
  readonly status?: string;
  readonly machineType?: string;
  readonly items?: readonly { key: string; value?: string }[];
  readonly labels?: Record<string, string>;
}

/** The devbox metadata the airia CLI writes on create, with the box's scripts (long values) beside the rules. */
export const DEVBOX_ITEMS = [
  { key: 'enable-oslogin', value: 'TRUE' },
  { key: 'devbox-owner-email', value: ACCOUNT },
  { key: 'devbox-acr', value: 'airiacontainerregistry' },
  { key: 'devbox-tz', value: 'America/Chicago' },
  { key: 'idle-shutdown-min', value: '45' },
  { key: 'idle-offhours-min', value: '20' },
  { key: 'idle-load-threshold', value: '0.5' },
  { key: 'work-start-hour', value: '8' },
  { key: 'work-end-hour', value: '19' },
  { key: 'nightly-stop-hour', value: '20' },
  { key: 'startup-script', value: '#!/usr/bin/env bash\nset -euo pipefail\n# provisions the box\n' },
];

/** One instance as `describe --format=json` prints it (the fields GCE always has, a few left out for length). */
export function gceInstance(input: InstanceInput = {}): Record<string, unknown> {
  const zone = input.zone ?? ZONE;
  const name = input.name ?? BOX;
  return {
    canIpForward: false,
    cpuPlatform: 'Intel Broadwell',
    creationTimestamp: '2026-09-24T07:12:44.123-07:00',
    deletionProtection: false,
    disks: [
      { autoDelete: true, boot: true, deviceName: name, diskSizeGb: '200', kind: 'compute#attachedDisk' },
    ],
    id: '4390123456789012345',
    kind: 'compute#instance',
    labelFingerprint: 'a1b2c3d4e5f=',
    labels: input.labels ?? { 'managed-by': 'devbox', owner: 'ihor-herasko', size: 'm' },
    lastStartTimestamp: '2026-11-06T08:01:02.345-08:00',
    machineType: `${API}/zones/${zone}/machineTypes/${input.machineType ?? 'e2-standard-8'}`,
    metadata: {
      fingerprint: 'Zm9vYmFyMTI=',
      items: input.items ?? DEVBOX_ITEMS,
      kind: 'compute#metadata',
    },
    name,
    networkInterfaces: [{ name: 'nic0', networkIP: '10.10.0.7', stackType: 'IPV4_ONLY' }],
    scheduling: { automaticRestart: true, onHostMaintenance: 'MIGRATE', preemptible: false },
    selfLink: `${API}/zones/${zone}/instances/${name}`,
    serviceAccounts: [{ email: 'devbox-vm@airia-devbox.iam.gserviceaccount.com', scopes: [] }],
    status: input.status ?? 'RUNNING',
    tags: { fingerprint: 'dGFncw==', items: ['devbox'] },
    zone: `${API}/zones/${zone}`,
  };
}

export function describeJson(input: InstanceInput = {}): string {
  return JSON.stringify(gceInstance(input), null, 2);
}

export function listJson(...inputs: InstanceInput[]): string {
  return JSON.stringify(inputs.map(gceInstance), null, 2);
}

/** gcloud's own words for a box that is not there. */
export const NOT_FOUND_STDERR = `ERROR: (gcloud.compute.instances.describe) Could not fetch resource:
 - The resource 'projects/airia-devbox/zones/${ZONE}/instances/${BOX}' was not found
`;

/** gcloud's words when its sign-in expired overnight (the token below must never reach an error). */
export const REAUTH_STDERR = `ERROR: (gcloud.compute.instances.describe) There was a problem refreshing your current auth tokens: Reauthentication failed. cannot prompt during non-interactive execution.
Please run:

  $ gcloud auth login

to obtain new credentials. ya29.a0AfB_byC-secret-token-value`;

export function ok(stdout = '', stderr = ''): RunResult {
  return { exitCode: 0, stdout, stderr, timedOut: false };
}

export function fail(stderr: string, exitCode = 1, stdout = ''): RunResult {
  return { exitCode, stdout, stderr, timedOut: false };
}

export function timedOut(): RunResult {
  return { exitCode: null, stdout: '', stderr: '', timedOut: true };
}

export interface RunCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

/** An answer: a result, or an error the run rejects with (a command that cannot start). */
export type Answer = RunResult | Error;

/**
 * A fake `CommandRun`: each call is recorded as `command args…` in `lines` (and in full in `calls`) and answered by
 * `answer`, which sees the line; an unexpected line answers with exit 99, so a test fails loudly.
 */
export function fakeRun(answer: (line: string) => Answer | undefined) {
  const calls: RunCall[] = [];
  const run: CommandRun = async (command, args, options) => {
    calls.push({ command, args: [...args], timeoutMs: options.timeoutMs });
    const line = [command, ...args].join(' ');
    const result = answer(line) ?? fail(`unexpected: ${line}`, 99);
    if (result instanceof Error) throw result;
    return result;
  };
  return { run, calls, lines: () => calls.map((call) => [call.command, ...call.args].join(' ')) };
}

export const DESCRIBE = `gcloud compute instances describe ${BOX} --project airia-devbox --zone ${ZONE} --format=json`;
export const GET_ACCOUNT = 'gcloud config get-value account';
export const LIST =
  'gcloud compute instances list --project airia-devbox --filter labels.managed-by=devbox AND labels.owner=ihor-herasko --format=json';
export const UP = 'airia devbox up --no-wait';
export const STOP = 'airia devbox stop';
