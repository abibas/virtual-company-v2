import {
  DEFAULT_GATEWAY_PATHS,
  GATEWAY_HEADERS,
  GATEWAY_PATH_MAX,
  GATEWAY_ROUTES,
  type GatewayPaths,
  type GatewayRoute,
  gatewayAddressOf,
} from '@mwc/shared/credentials';
import { ChevronRight, Plus, X } from 'lucide-react';
import { useRef } from 'react';
import { SECRET_INPUT, TextField } from '../../components/forms/Field.tsx';
import { Input } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';

/**
 * A gateway's own parts of the gateway form and cards. A gateway is universal: one address serves Claude Code and Codex,
 * each CLI at its own path under it (the server joins them, `gatewayAddressOf`), so the form asks the address, its
 * headers and, folded away, the paths.
 */

/** How each way a turn reaches a gateway is named on the page. */
export const GATEWAY_ROUTE_NAMES: Readonly<Record<GatewayRoute, string>> = {
  claude: 'Claude Code',
  codexChatgpt: 'Codex (ChatGPT)',
  codexApiKey: 'Codex (API key)',
};

/** A gateway on this Mac's port 8300, the address's example. */
const EXAMPLE_ADDRESS = 'http://127.0.0.1:8300';

/** The gateway's address: its root, each CLI's path being added for it. */
export function GatewayAddress({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <TextField
      label="Address"
      type="url"
      inputMode="url"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required
      autoComplete="off"
      spellCheck={false}
      placeholder={EXAMPLE_ADDRESS}
      hint={`Your gateway's root, e.g. ${EXAMPLE_ADDRESS}; each CLI's path is added for it.`}
    />
  );
}

/** What the paths fold holds: each route's path as typed, empty for its default. */
export type PathValues = Readonly<Record<GatewayRoute, string>>;

export const NO_PATHS: PathValues = { claude: '', codexChatgpt: '', codexApiKey: '' };

/** The paths the API takes: only those typed (an empty one keeps its default). */
export const pathsOf = (values: PathValues): GatewayPaths =>
  Object.fromEntries(
    GATEWAY_ROUTES.flatMap((route) => {
      const path = values[route].trim();
      return path === '' ? [] : [[route, path]];
    }),
  );

/** A route's default path as its placeholder. */
const placeholderOf = (route: GatewayRoute): string =>
  DEFAULT_GATEWAY_PATHS[route] === '' ? '/ (the address itself)' : DEFAULT_GATEWAY_PATHS[route];

/** "Advanced: paths", folded: each CLI's path under the address, its default as the placeholder. */
export function GatewayPathsFold({
  values,
  onChange,
}: {
  readonly values: PathValues;
  readonly onChange: (values: PathValues) => void;
}) {
  return (
    <details className="group rounded-xl border border-line px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-ink-2">
        <ChevronRight size={15} aria-hidden="true" className="shrink-0 transition group-open:rotate-90" />
        Advanced: paths
      </summary>
      <div className="mt-3 flex flex-col gap-3 pb-1">
        {GATEWAY_ROUTES.map((route) => (
          <TextField
            key={route}
            label={GATEWAY_ROUTE_NAMES[route]}
            value={values[route]}
            onChange={(event) => onChange({ ...values, [route]: event.target.value })}
            maxLength={GATEWAY_PATH_MAX}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholderOf(route)}
          />
        ))}
        <p className="text-xs text-dim">Leave one empty for its default; / is the address itself.</p>
      </div>
    </details>
  );
}

/** Where each CLI reaches a gateway, in small text: "Claude Code → http://127.0.0.1:8300". */
export function GatewayRoutes({ accountMeta }: { readonly accountMeta: Readonly<Record<string, unknown>> }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-dim">
      {GATEWAY_ROUTES.map((route) => {
        const address = gatewayAddressOf(accountMeta, route);
        return address === undefined ? null : (
          <li key={route} className="truncate">
            {GATEWAY_ROUTE_NAMES[route]} → <span className="font-mono text-ink-2">{address}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface HeaderRow {
  readonly id: number;
  readonly name: string;
  readonly value: string;
}

/** A gateway's headers: name and value rows (values as secrets), none to 20; an empty row is left out. */
export function HeaderRows({
  rows,
  onChange,
}: {
  readonly rows: readonly HeaderRow[];
  readonly onChange: (rows: readonly HeaderRow[]) => void;
}) {
  const nextId = useRef(rows.length);
  const set = (id: number, change: Partial<HeaderRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const add = () => onChange([...rows, { id: nextId.current++, name: '', value: '' }]);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-ink-2">Headers (optional)</legend>
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            aria-label={`Header ${index + 1} name`}
            value={row.name}
            placeholder="x-api-key"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => set(row.id, { name: event.target.value })}
          />
          <Input
            aria-label={`Header ${index + 1} value`}
            value={row.value}
            placeholder="Value"
            {...SECRET_INPUT}
            onChange={(event) => set(row.id, { value: event.target.value })}
          />
          <IconButton
            label={`Remove header ${index + 1}`}
            icon={X}
            size="sm"
            onClick={() => onChange(rows.filter((other) => other.id !== row.id))}
          />
        </div>
      ))}
      {rows.length < GATEWAY_HEADERS.max && (
        <Button size="sm" tone="quiet" icon={Plus} onClick={add} className="-ml-2 self-start">
          Add a header
        </Button>
      )}
      <p className="text-xs text-dim">The values are stored encrypted and never shown again.</p>
    </fieldset>
  );
}
