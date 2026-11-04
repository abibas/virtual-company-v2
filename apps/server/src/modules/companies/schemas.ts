import { z } from '@hono/zod-openapi';
import { CompanyStatus, MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { NAME_MAX, SLUG_PATTERN } from './rules.ts';

const Name = z.string().trim().min(1).max(NAME_MAX).openapi({ example: 'Most Wanted' });
const Slug = z
  .string()
  .regex(SLUG_PATTERN, 'lower-case letters, digits and dashes, 1 to 63 characters, no dash at either end')
  .openapi({ example: 'most-wanted' });

export const CompanyParamsSchema = z.object({
  companyId: z
    .string()
    .openapi({ param: { name: 'companyId', in: 'path' }, example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' }),
});

/** A company as the API shows it. `identityOrgId` is the provider's organization, null while provisioning. */
export const CompanySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    status: CompanyStatus,
    identityOrgId: z.string().nullable(),
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('Company');

/** One of my companies, with my role and membership status there (the same companies `GET /api/me` lists). */
export const CompanySummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    status: CompanyStatus,
    role: MembershipRole,
    membershipStatus: MembershipStatus,
  })
  .openapi('CompanySummary');

export const CompanyListSchema = z
  .object({ companies: z.array(CompanySummarySchema) })
  .openapi('CompanyList');

/** A slug left out is derived from the name, with a suffix when that one is taken; a chosen slug that is taken is a 409. */
export const CreateCompanySchema = z.object({ name: Name, slug: Slug.optional() }).openapi('CreateCompany');

export const UpdateCompanySchema = z
  .object({ name: Name.optional(), slug: Slug.optional() })
  .refine((body) => body.name !== undefined || body.slug !== undefined, 'Give a name, a slug or both')
  .openapi('UpdateCompany');

/** The company's name, typed again: a deletion goes ahead only when it matches. */
export const DeleteCompanySchema = z
  .object({
    confirmName: z
      .string()
      .max(NAME_MAX * 2)
      .openapi({ example: 'Most Wanted' }),
  })
  .openapi('DeleteCompany');

export type CompanyView = z.infer<typeof CompanySchema>;
export type CompanySummary = z.infer<typeof CompanySummarySchema>;
export type CreateCompany = z.infer<typeof CreateCompanySchema>;
export type UpdateCompany = z.infer<typeof UpdateCompanySchema>;
