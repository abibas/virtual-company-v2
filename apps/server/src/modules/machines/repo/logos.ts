import { type MachineLogo, machineLogos, type TenantDb } from '@mwc/db';
import { eq } from 'drizzle-orm';

/**
 * The machines' logos (`machine_logos`, one per machine), through the company's tenant only. Every read but `file`
 * leaves the bytes out, so a list of machines never loads an image.
 */

/** What is known of a logo without its bytes. */
export type MachineLogoInfo = Pick<MachineLogo, 'contentType' | 'size' | 'sha256' | 'updatedAt'>;

/** A logo to store: the bytes, the type they show, their size and SHA-256, and who set it. */
export type MachineLogoValues = Pick<
  MachineLogo,
  'contentType' | 'bytes' | 'size' | 'sha256' | 'updatedByPrincipalId'
>;

const infoColumns = {
  contentType: machineLogos.contentType,
  size: machineLogos.size,
  sha256: machineLogos.sha256,
  updatedAt: machineLogos.updatedAt,
};

const ofMachine = (machineId: string) => eq(machineLogos.machineId, machineId);

export const machineLogoRows = {
  /** The machine's logo without its bytes, or undefined when it has none. */
  async info(t: TenantDb, machineId: string): Promise<MachineLogoInfo | undefined> {
    const [row] = await t.selectFields(machineLogos, infoColumns, ofMachine(machineId));
    return row;
  },

  /** Every logo's SHA-256 in the company, by machine. */
  async hashes(t: TenantDb): Promise<Map<string, string>> {
    const rows = await t.selectFields(machineLogos, {
      machineId: machineLogos.machineId,
      sha256: machineLogos.sha256,
    });
    return new Map(rows.map((row) => [row.machineId, row.sha256]));
  },

  /** The machine's logo with its bytes, or undefined when it has none. */
  async file(t: TenantDb, machineId: string): Promise<MachineLogo | undefined> {
    const [row] = await t.select(machineLogos, ofMachine(machineId));
    return row;
  },

  /** Stores the machine's logo, replacing the one there was; returns it without its bytes. */
  async save(t: TenantDb, machineId: string, values: MachineLogoValues): Promise<MachineLogoInfo> {
    const [row] = await t
      .insert(machineLogos, { machineId, ...values })
      .onConflictDoUpdate({
        target: [machineLogos.companyId, machineLogos.machineId],
        set: { ...values, updatedAt: new Date() },
      })
      .returning(infoColumns);
    return row as MachineLogoInfo;
  },

  /** Removes the machine's logo; returns the SHA-256 it had, or undefined when there was none. */
  async remove(t: TenantDb, machineId: string): Promise<string | undefined> {
    const [row] = await t
      .delete(machineLogos, ofMachine(machineId))
      .returning({ sha256: machineLogos.sha256 });
    return row?.sha256;
  },
};
