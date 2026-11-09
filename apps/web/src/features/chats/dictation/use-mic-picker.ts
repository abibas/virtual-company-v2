import { useCallback, useRef, useState } from 'react';
import { listMics, loadMicChoice, type MicChoice, saveMicChoice } from './mics.ts';

/** The microphone picker's state: the inputs (listed again on demand) and the choice, remembered in this browser. */
export function useMicPicker() {
  const [mics, setMics] = useState<MicChoice[]>([]);
  const [mic, setMic] = useState<MicChoice | null>(() => loadMicChoice());
  const micRef = useRef(mic);
  micRef.current = mic;
  const refreshMics = useCallback(async () => setMics(await listMics().catch(() => [])), []);
  const chooseMic = useCallback((choice: MicChoice | null) => {
    setMic(choice);
    saveMicChoice(choice);
  }, []);
  return { mics, mic, micRef, refreshMics, chooseMic };
}
