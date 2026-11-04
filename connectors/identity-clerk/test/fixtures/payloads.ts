import { T0 } from './backend.ts';

/**
 * Clerk webhook payloads (snake_case JSON, as Clerk's dashboard shows them), trimmed to the fields the
 * connector reads plus a few it ignores.
 */

export function envelope(type: string, data: unknown, timestamp: number | null = T0 + 5) {
  return {
    type,
    object: 'event',
    data,
    ...(timestamp === null ? {} : { timestamp }),
    instance_id: 'ins_test',
    event_attributes: { http_request: { client_ip: '', user_agent: '' } },
  };
}

export function userJson(overrides: Record<string, unknown> = {}) {
  return {
    object: 'user',
    id: 'user_1',
    first_name: 'Ann',
    last_name: null,
    username: null,
    image_url: 'https://img.clerk.com/ann',
    has_image: true,
    primary_email_address_id: 'idn_1',
    email_addresses: [{ object: 'email_address', id: 'idn_1', email_address: 'Ann@X.Test', linked_to: [] }],
    public_metadata: {},
    private_metadata: {},
    created_at: T0 - 1000,
    updated_at: T0,
    ...overrides,
  };
}

export function orgJson(overrides: Record<string, unknown> = {}) {
  return {
    object: 'organization',
    id: 'org_1',
    name: 'Acme',
    slug: 'acme',
    has_image: false,
    max_allowed_memberships: 5,
    admin_delete_enabled: true,
    public_metadata: {},
    private_metadata: { mwc_company_id: 'c1' },
    created_at: T0 - 1000,
    updated_at: T0,
    ...overrides,
  };
}

export function membershipJson(overrides: Record<string, unknown> = {}) {
  return {
    object: 'organization_membership',
    id: 'orgmem_1',
    role: 'org:member',
    permissions: [],
    public_metadata: {},
    private_metadata: { mwc_invitation_id: 'inv-1' },
    created_at: T0 - 1000,
    updated_at: T0,
    organization: orgJson(),
    public_user_data: {
      user_id: 'user_2',
      identifier: 'two@x.test',
      first_name: null,
      last_name: null,
      image_url: '',
      has_image: false,
    },
    ...overrides,
  };
}

export function invitationJson(overrides: Record<string, unknown> = {}) {
  return {
    object: 'organization_invitation',
    id: 'orginv_1',
    email_address: 'Two@X.Test',
    role: 'org:member',
    role_name: 'Member',
    organization_id: 'org_1',
    status: 'accepted',
    public_metadata: {},
    private_metadata: { mwc_invitation_id: 'inv-1', mwc_company_id: 'c1' },
    url: null,
    created_at: T0 - 1000,
    updated_at: T0,
    expires_at: T0 + 14 * 86_400_000,
    ...overrides,
  };
}
