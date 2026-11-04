import { IdentityProviderError } from '../errors.ts';

/** What a fake token says: `fake:<subject>[;org=<externalId>][;pending]`. */
export interface FakeToken {
  readonly subject: string;
  readonly org?: string;
  readonly pending: boolean;
}

/** Reads a fake token; anything else rejects as `unauthorized`, like a bad or foreign token would. */
export function parseFakeToken(token: string): FakeToken {
  if (!token.startsWith('fake:')) throw new IdentityProviderError('unauthorized', 'fake: not a fake token');
  const [subject = '', ...parts] = token.slice('fake:'.length).split(';');
  let org: string | undefined;
  let pending = false;
  for (const part of parts) {
    if (part === 'pending') pending = true;
    else if (part.startsWith('org=') && part.length > 4) org = part.slice(4);
    else throw new IdentityProviderError('unauthorized', `fake: unknown token part "${part}"`);
  }
  return { subject, pending, ...(org === undefined ? {} : { org }) };
}
