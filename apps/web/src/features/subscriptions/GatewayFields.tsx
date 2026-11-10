import { GATEWAY_HEADERS, GATEWAY_PROVIDERS, type GatewayProvider } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import { ChevronRight, Plus, X } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { SECRET_INPUT, TextField } from '../../components/forms/Field.tsx';
import { Input } from '../../components/forms/Input.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';
import { IconTile } from '../../components/ui/IconTile.tsx';
import { PROVIDER_STYLES } from './Providers.tsx';

/**
 * A gateway's own parts of the gateway form and cards: whose API it speaks (Claude Code's or Codex's, asked first), its
 * address with the addresses to try for each, and its headers.
 */

/** A gateway on this Mac's port 8300 (a memory gateway serves both), as each harness reaches it. */
const CLAUDE_ADDRESS = 'http://127.0.0.1:8300';
const CODEX_CHATGPT_ADDRESS = 'http://127.0.0.1:8300/backend-api/codex';
const CODEX_KEY_ADDRESS = 'http://127.0.0.1:8300/v1';

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="font-mono text-ink-2">{children}</code>
);

interface GatewayStyle {
  /** "For Claude Code", "For Codex". */
  readonly label: string;
  /** A new gateway's starting name. */
  readonly name: string;
  /** The profiles that take it. */
  readonly profile: ProfileProvider;
  readonly placeholder: string;
  readonly hint: ReactNode;
}

/** How each gateway provider shows, and the addresses to try. */
export const GATEWAY_STYLES: Readonly<Record<GatewayProvider, GatewayStyle>> = {
  anthropic: {
    label: 'For Claude Code',
    name: 'Claude Code gateway',
    profile: 'claude',
    placeholder: CLAUDE_ADDRESS,
    hint: (
      <>
        Claude Code sends its requests here. A gateway on this Mac’s port 8300: <Code>{CLAUDE_ADDRESS}</Code>.
      </>
    ),
  },
  openai: {
    label: 'For Codex',
    name: 'Codex gateway',
    profile: 'openai',
    placeholder: CODEX_CHATGPT_ADDRESS,
    hint: (
      <>
        Codex sends its requests here. On port 8300, with a ChatGPT sign-in{' '}
        <Code>{CODEX_CHATGPT_ADDRESS}</Code>, with an OpenAI API key <Code>{CODEX_KEY_ADDRESS}</Code>.
      </>
    ),
  },
};

/** The name of the profiles that take a gateway of `provider` ("Claude", "OpenAI"). */
export const gatewayProfilesName = (provider: GatewayProvider): string =>
  PROVIDER_STYLES[GATEWAY_STYLES[provider].profile].name;

/** A gateway's provider as a small badge in its profiles' tone ("For Codex"). */
export function GatewayProviderBadge({ provider }: { readonly provider: GatewayProvider }) {
  const { tone, icon } = PROVIDER_STYLES[GATEWAY_STYLES[provider].profile];
  return (
    <Badge tone={tone} icon={icon} size="sm">
      {GATEWAY_STYLES[provider].label}
    </Badge>
  );
}

/** The gateway form's first step: for Claude Code or for Codex, as two big choices. */
export function GatewayProviderChoice({
  onChoose,
}: {
  readonly onChoose: (provider: GatewayProvider) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1.5 text-sm font-semibold text-ink-2">Which harness is it for?</legend>
      {GATEWAY_PROVIDERS.map((provider) => {
        const style = GATEWAY_STYLES[provider];
        const profile = PROVIDER_STYLES[style.profile];
        return (
          <button
            key={provider}
            type="button"
            onClick={() => onChoose(provider)}
            className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-line-2 hover:bg-surface-2"
          >
            <IconTile icon={profile.icon} tone={profile.tone} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block text-md font-bold text-ink">{style.label}</span>
              <span className="block text-xs text-dim">{profile.name} profiles can include it.</span>
            </span>
            <ChevronRight
              size={18}
              aria-hidden="true"
              className="shrink-0 text-faint group-hover:text-ink-2"
            />
          </button>
        );
      })}
    </fieldset>
  );
}

/** The chosen provider above the form, with Change to choose again. */
export function GatewayProviderLine({
  provider,
  onChange,
}: {
  readonly provider: GatewayProvider;
  readonly onChange: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <GatewayProviderBadge provider={provider} />
      <Button size="sm" tone="quiet" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

/** The gateway's address, with the addresses to try for its provider. */
export function GatewayAddress({
  provider,
  value,
  onChange,
}: {
  readonly provider: GatewayProvider;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const style = GATEWAY_STYLES[provider];
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
      placeholder={style.placeholder}
      hint={style.hint}
    />
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
