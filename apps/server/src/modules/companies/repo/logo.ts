import { type CompanyLogo, companyLogos, type TenantDb } from '@mwc/db';

/**
 * The company's logo row (`company_logos`, one per company), through the tenant layer. Every read but `file` leaves
 * the bytes out, so a company or a list never loads an image.
 */

/** What is known of a logo without its bytes. */
export type LogoInfo = Pick<CompanyLogo, 'contentType' | 'size' | 'sha256' | 'updatedAt'>;

/** A logo to store: the bytes, the type they show, their size and SHA-256, and who set it. */
export type LogoValues = Pick<
  CompanyLogo,
  'contentType' | 'bytes' | 'size' | 'sha256' | 'updatedByPrincipalId'
>;

const infoColumns = {
  contentType: companyLogos.contentType,
  size: companyLogos.size,
  sha256: companyLogos.sha256,
  updatedAt: companyLogos.updatedAt,
};

export const logoRows = {
  /** The logo without its bytes, or undefined when the company has none. */
  async info(t: TenantDb): Promise<LogoInfo | undefined> {
    const [row] = await t.selectFields(companyLogos, infoColumns);
    return row;
  },

  /** The logo with its bytes, or undefined when the company has none. */
  async file(t: TenantDb): Promise<CompanyLogo | undefined> {
    const [row] = await t.select(companyLogos);
    return row;
  },

  /** Stores the logo, replacing the one there was; returns it without its bytes. */
  async save(t: TenantDb, values: LogoValues): Promise<LogoInfo> {
    const [row] = await t
      .insert(companyLogos, values)
      .onConflictDoUpdate({ target: companyLogos.companyId, set: { ...values, updatedAt: new Date() } })
      .returning(infoColumns);
    return row as LogoInfo;
  },

  /** Removes the logo; returns the SHA-256 it had, or undefined when there was none. */
  async remove(t: TenantDb): Promise<string | undefined> {
    const [row] = await t.delete(companyLogos).returning({ sha256: companyLogos.sha256 });
    return row?.sha256;
  },
};
