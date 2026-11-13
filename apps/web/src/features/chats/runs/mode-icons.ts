import type { PermissionMode } from '@mwc/shared/enums';
import { FilePen, Hand, ListChecks, type LucideIcon, ShieldOff, Sparkles } from 'lucide-react';

/**
 * Each permission mode's icon on the composer's Mode pill (2026-11-13): asking first is a raised hand, accepting edits a
 * pen on a file, planning a checklist, auto a sparkle, and never asking an open shield. Codex's three take the same
 * pictures as their Claude Code kin.
 */
export const MODE_ICON: Readonly<Record<PermissionMode, LucideIcon>> = {
  manual: Hand,
  acceptEdits: FilePen,
  plan: ListChecks,
  auto: Sparkles,
  bypassPermissions: ShieldOff,
  ask: Hand,
  full: ShieldOff,
};
