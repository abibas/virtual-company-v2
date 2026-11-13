import {
  type AtlassianRights,
  CONFLUENCE_SPACE_PATTERN,
  type ConfluenceAccess,
  GITHUB_REPO_PATTERN,
  type GitHubRights,
  JIRA_PROJECT_PATTERN,
  type JiraAccess,
  type ToolRights,
} from '@mwc/shared/credentials';
import { ChipsInput } from '../../components/forms/ChipsInput.tsx';
import { ChoiceField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { Switch } from '../../components/forms/Switch.tsx';

/** Where a right reaches: all, or the names listed (none yet: nowhere). */
type Scope = 'all' | string[];

interface ScopeProps {
  readonly label: string;
  /** The switch's label: "All repositories". */
  readonly all: string;
  readonly scope: Scope;
  readonly onChange: (scope: Scope) => void;
  readonly pattern: RegExp;
  readonly normalize?: (entry: string) => string;
  readonly placeholder: string;
  readonly disabled: boolean;
}

/** A scope: the All switch, else the names as chips. */
function ScopeControl({
  label,
  all,
  scope,
  onChange,
  pattern,
  normalize,
  placeholder,
  disabled,
}: ScopeProps) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Switch
        label={all}
        checked={scope === 'all'}
        disabled={disabled}
        onChange={(on) => onChange(on ? 'all' : [])}
      />
      {scope !== 'all' && (
        <ChipsInput
          label={label}
          values={scope}
          onChange={onChange}
          valid={(entry) => pattern.test(entry)}
          normalize={normalize}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  );
}

interface RightsProps<R> {
  readonly rights: R;
  readonly onChange: (rights: R) => void;
  readonly disabled: boolean;
}

/** GitHub's rights: the repositories it reaches, and whether it pushes branches and opens pull requests. */
function GitHubRightsFields({ rights, onChange, disabled }: RightsProps<GitHubRights>) {
  const set = (change: Partial<GitHubRights>) => onChange({ ...rights, ...change });
  return (
    <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <ChoiceField label="Repositories">
        <ScopeControl
          label="Repositories"
          all="All repositories"
          scope={rights.repos}
          onChange={(repos) => set({ repos })}
          pattern={GITHUB_REPO_PATTERN}
          placeholder="owner/name, owner/*"
          disabled={disabled}
        />
      </ChoiceField>
      <ChoiceField label="Rights">
        <Switch
          label="Push branches"
          checked={rights.push}
          disabled={disabled}
          onChange={(push) => set({ push })}
        />
        <Switch
          label="Pull requests"
          checked={rights.pullRequests}
          disabled={disabled}
          onChange={(pullRequests) => set({ pullRequests })}
        />
      </ChoiceField>
    </div>
  );
}

const JIRA_LEVELS: readonly SegmentOption<JiraAccess>[] = [
  { value: 'off', label: 'Off' },
  { value: 'read', label: 'Read' },
  { value: 'changes', label: 'Changes' },
];

const CONFLUENCE_LEVELS: readonly SegmentOption<ConfluenceAccess>[] = [
  { value: 'off', label: 'Off' },
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
];

/** One Atlassian product (`product`): its level, and where it reaches unless it is off. */
function ProductRights<L extends string>({
  product,
  levels,
  level,
  onLevel,
  ...scope
}: ScopeProps & {
  readonly product: string;
  readonly levels: readonly SegmentOption<L>[];
  readonly level: L;
  readonly onLevel: (level: L) => void;
}) {
  return (
    <ChoiceField label={product}>
      <SegmentedControl
        label={product}
        size="sm"
        options={levels}
        value={level}
        onChange={onLevel}
        disabled={scope.disabled}
      />
      {level !== 'off' && <ScopeControl {...scope} />}
    </ChoiceField>
  );
}

/** Atlassian's rights: Jira's level in its projects, Confluence's in its spaces. */
function AtlassianRightsFields({ rights, onChange, disabled }: RightsProps<AtlassianRights>) {
  const set = (change: Partial<AtlassianRights>) => onChange({ ...rights, ...change });
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <ProductRights
        product="Jira"
        label="Jira projects"
        levels={JIRA_LEVELS}
        level={rights.jira}
        onLevel={(jira) => set({ jira })}
        all="All projects"
        scope={rights.jiraProjects}
        onChange={(jiraProjects) => set({ jiraProjects })}
        pattern={JIRA_PROJECT_PATTERN}
        normalize={(entry) => entry.trim().toUpperCase()}
        placeholder="AP"
        disabled={disabled}
      />
      <ProductRights
        product="Confluence"
        label="Confluence spaces"
        levels={CONFLUENCE_LEVELS}
        level={rights.confluence}
        onLevel={(confluence) => set({ confluence })}
        all="All spaces"
        scope={rights.confluenceSpaces}
        onChange={(confluenceSpaces) => set({ confluenceSpaces })}
        pattern={CONFLUENCE_SPACE_PATTERN}
        placeholder="ENG"
        disabled={disabled}
      />
    </div>
  );
}

/**
 * A tool part's rights as compact controls (S7.1b): GitHub's repositories (All, or chips) with Push branches and Pull
 * requests; Atlassian's Jira (Off, Read, Changes) and Confluence (Off, Read, Write), each with its projects or spaces.
 * Each change hands back the whole set.
 */
export function ToolRightsFields({
  rights,
  onChange,
  disabled = false,
}: {
  readonly rights: ToolRights;
  readonly onChange: (rights: ToolRights) => void;
  readonly disabled?: boolean;
}) {
  return 'repos' in rights ? (
    <GitHubRightsFields rights={rights} onChange={onChange} disabled={disabled} />
  ) : (
    <AtlassianRightsFields rights={rights} onChange={onChange} disabled={disabled} />
  );
}
