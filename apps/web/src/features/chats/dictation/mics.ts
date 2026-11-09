/**
 * The microphone picker's side (docs/speech.md): the audio inputs, and the one chosen, remembered in this browser. The
 * choice is kept by id and label: ids change when the browser's site data is cleared, so a label match finds it again.
 */

export interface MicChoice {
  readonly deviceId: string;
  readonly label: string;
}

const KEY = 'mwc.dictation.mic';

/** The audio inputs; their labels are empty until the page may use the microphone. */
export async function listMics(): Promise<MicChoice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** The microphone chosen in this browser, or null for the default one. */
export function loadMicChoice(): MicChoice | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<MicChoice> | null;
    return saved && typeof saved.deviceId === 'string'
      ? { deviceId: saved.deviceId, label: typeof saved.label === 'string' ? saved.label : '' }
      : null;
  } catch {
    return null;
  }
}

export function saveMicChoice(choice: MicChoice | null): void {
  try {
    if (choice) window.localStorage.setItem(KEY, JSON.stringify(choice));
    else window.localStorage.removeItem(KEY);
  } catch {
    // No storage (a private window): the choice lasts for this page only.
  }
}

/** The chosen microphone's id among the inputs now (by id, else by label), or undefined for the default one. */
export function resolveMic(choice: MicChoice | null, inputs: readonly MicChoice[]): string | undefined {
  if (!choice) return undefined;
  const found =
    inputs.find((input) => input.deviceId === choice.deviceId) ??
    inputs.find((input) => choice.label !== '' && input.label === choice.label);
  return found?.deviceId;
}
