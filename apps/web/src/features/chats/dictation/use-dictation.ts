import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../../../api/client.ts';
import { useApi } from '../../../api/context.ts';
import { ApiError, friendlyMessage } from '../../../api/errors.ts';
import { transcribeClip } from '../../../api/speech.ts';
import { listMics, type MicChoice, resolveMic } from './mics.ts';
import { PcmRecorder } from './recorder.ts';
import { useDictationKeys } from './use-dictation-keys.ts';
import { useMicPicker } from './use-mic-picker.ts';

/**
 * Dictation in the composer (docs/speech.md): the mic button, Alt+Shift+V (in the composer) or Esc (while recording)
 * start and stop it; the clip is transcribed on the server's computer and its text goes in at the cursor, never sent.
 * One composer records at a time.
 */

/** `starting`: the microphone is opening; `transcribing`: the server is hearing the clip. */
export type DictationState = 'idle' | 'starting' | 'recording' | 'transcribing';

/** The composer that holds the microphone now, if any. */
let owner: symbol | null = null;

const MESSAGES: Readonly<Record<string, string>> = {
  speech_unavailable: "Dictation is off: the server's computer has no whisper.cpp.",
  audio_too_large: 'A clip is at most two minutes long.',
};

const failureText = (error: unknown) =>
  error instanceof ApiError && MESSAGES[error.code]
    ? (MESSAGES[error.code] as string)
    : friendlyMessage(error);

/** Opens the chosen microphone, or the default one when the chosen one is not connected. */
async function startOnChosenMic(recorder: PcmRecorder, choice: MicChoice | null): Promise<void> {
  const deviceId = resolveMic(choice, await listMics().catch(() => []));
  try {
    await recorder.start(deviceId);
  } catch (error) {
    const gone = error instanceof DOMException && /Overconstrained|NotFound/.test(error.name);
    if (deviceId === undefined || !gone) throw error;
    await recorder.start();
  }
}

/** Stops the recorder and has the clip transcribed: its text, a message to show, or nothing (a click too short). */
async function hear(api: Api, recorder: PcmRecorder): Promise<{ text?: string; message?: string }> {
  const clip = await recorder.stop();
  if (clip === undefined || clip.ms < 400) return {};
  if (clip.empty || clip.blob.size < 1000) {
    const from = clip.device || 'the microphone';
    return {
      message: `No sound came through from ${from}. Wait a moment after starting, or pick another one.`,
    };
  }
  try {
    const heard = await transcribeClip(api, clip.blob);
    if (heard.text === '') return { message: 'Heard nothing. Try again a bit closer to the microphone.' };
    return { text: heard.text };
  } catch (failure) {
    return { message: failureText(failure) };
  }
}

/** A message that stays a few seconds. */
function useFleeting() {
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    if (message === undefined) return;
    const timer = setTimeout(() => setMessage(undefined), 8_000);
    return () => clearTimeout(timer);
  }, [message]);
  return [message, setMessage] as const;
}

export function useDictation(options: {
  /** The composer: where Alt+Shift+V counts. */
  readonly getRoot: () => HTMLElement | null;
  /** Puts the text in at the cursor. */
  readonly insert: (text: string) => void;
}) {
  const api = useApi();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const me = useRef(Symbol('dictation')).current;
  const recorderRef = useRef<PcmRecorder | undefined>(undefined);
  const stateRef = useRef<DictationState>('idle');
  const [state, setStateValue] = useState<DictationState>('idle');
  const [meter, setMeter] = useState({ level: 0, elapsedMs: 0 });
  const [error, setError] = useFleeting();
  const picker = useMicPicker();
  const supported = typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined;
  const setState = useCallback((next: DictationState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);

  const finish = useCallback(async () => {
    const recorder = recorderRef.current;
    if (stateRef.current !== 'recording' || recorder === undefined) return;
    setState('transcribing');
    if (owner === me) owner = null;
    const { text, message } = await hear(api, recorder);
    if (text !== undefined) optionsRef.current.insert(text);
    setError(message);
    recorderRef.current = undefined;
    setMeter({ level: 0, elapsedMs: 0 });
    setState('idle');
  }, [api, me, setError, setState]);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle' || !supported) return;
    if (owner !== null && owner !== me) return setError('Another message box is dictating: stop it first.');
    const recorder = new PcmRecorder({
      onLevel: (level, elapsedMs) => setMeter({ level, elapsedMs }),
      onLimit: () => void finish(),
    });
    recorderRef.current = recorder;
    setError(undefined);
    setState('starting');
    try {
      await startOnChosenMic(recorder, picker.micRef.current);
      owner = me;
      setState('recording');
      void picker.refreshMics();
    } catch {
      recorder.cancel();
      recorderRef.current = undefined;
      setState('idle');
      setError("The microphone didn't start. Allow it for this site in the address bar's site settings.");
    }
  }, [finish, me, picker.micRef, picker.refreshMics, setError, setState, supported]);

  const toggle = useCallback(async () => {
    if (stateRef.current === 'recording') await finish();
    else if (stateRef.current === 'idle') await start();
  }, [finish, start]);

  useDictationKeys({
    getRoot: () => optionsRef.current.getRoot(),
    toggle,
    recording: () => owner === me && stateRef.current === 'recording',
    elsewhere: () => owner !== null && owner !== me,
  });

  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      if (owner === me) owner = null;
    },
    [me],
  );

  return { supported, state, ...meter, error, toggle, ...picker };
}
