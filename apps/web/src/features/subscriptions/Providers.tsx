import type { ProfilePart } from '@mwc/shared/credentials';
import type { IconComponent } from '../../components/ui/icon.ts';
import {
  AtlassianMark,
  ClaudeMark,
  GitHubMark,
  OpenAIMark,
  SlackMark,
} from '../../components/ui/ProviderLogo.tsx';

/** A profile's parts as the pages show them (generic profiles since 2026-11-13): each part's name and logo. */
export const PART_STYLES: Readonly<
  Record<ProfilePart, { readonly name: string; readonly icon: IconComponent }>
> = {
  claude: { name: 'Claude', icon: ClaudeMark },
  openai: { name: 'OpenAI', icon: OpenAIMark },
  github: { name: 'GitHub', icon: GitHubMark },
  atlassian: { name: 'Atlassian', icon: AtlassianMark },
  slack: { name: 'Slack', icon: SlackMark },
};
