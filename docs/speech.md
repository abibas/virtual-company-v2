# Dictation

The chat composer has a microphone button (S5.2). A person speaks, and the text goes in at the cursor of the message
box, ready to edit; nothing is sent until they press Send. Transcription runs on the computer the API server runs on,
with whisper.cpp: no cloud service, no credential, no account.

## How it works

1. **Recording, in the browser.** The button (or Alt+Shift+V with the focus in the composer) opens the microphone. The
   page collects raw samples from the Web Audio graph rather than MediaRecorder, whose encoder stops when a Bluetooth
   headset such as AirPods switches profile and sample rate as the microphone opens; the graph resamples and the samples
   keep coming. While it listens the button shows a level meter and the time (m:ss). A second click or Esc stops; a clip
   stops by itself at two minutes. The small arrow beside the button picks the microphone; the choice is remembered in
   that browser (by id, and by name when the id changed), and the default one is used while the chosen one is not
   connected. The clip becomes a 16 kHz mono 16-bit WAV (`apps/web/src/features/chats/dictation/`).
2. **Transcribing, on the server's computer.** The page posts the clip to `POST /api/me/speech/transcribe` (a signed-in
   person, with a session or a personal API key; `audio/wav`, at most two minutes and 8 MB). The server
   (`apps/server/src/platform/processes/speech/`) checks the WAV, skips a clip with under 300 ms of voice (Whisper
   invents words on silence: the answer is empty text), and hands the rest to whisper.cpp:
   - a warm `whisper-server` on `127.0.0.1:MWC_WHISPER_PORT` (9957), started on the first clip so the model loads once,
     kept while it lives, started again on a later clip when it died, and stopped with the API (a small shell around it
     also stops it when the API is killed);
   - `whisper-cli` on a temporary file when the server cannot start or fails a clip (a failed start is retried after a
     minute). The temporary folder is private and removed after each clip.
   Noise tokens (`[BLANK_AUDIO]`, `(music)`) are dropped. The answer is `{ text, words }`, each word with its start and end
   in milliseconds (whisper.cpp's DTW alignment for the models it has a preset for).
3. **Inserting.** The text goes in at the cursor, with a space before or after it where its neighbours need one.

The audio is never logged, stored or sent anywhere else: the server reads the clip into memory, writes it only to
whisper-cli's temporary folder when the warm server is not used, and clears its copy once it answered. The text is not
logged either.

## When it is on

`GET /api/config` says `speech: true` when this server transcribes; the composer shows the button only then.

| Variable               | Default    | What                                                                                     |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `MWC_WHISPER`          | `auto`     | `auto`: on when whisper.cpp and a model are found, outside production and tests; `off`: never |
| `MWC_WHISPER_MODEL`    | (found)    | the model file (`~/` is the home folder); unset, the first known place that has one       |
| `MWC_WHISPER_LANGUAGE` | `auto`     | the language spoken (`en`, `uk`, ...), or `auto` to detect it per clip                     |
| `MWC_WHISPER_PROMPT`   | (none)     | words Whisper should spell your way (names, products)                                     |
| `MWC_WHISPER_PORT`     | `9957`     | the warm server's port, on 127.0.0.1 only (docs/ports.md)                                 |

The binaries are looked for on the PATH, then in `/opt/homebrew/bin` and `/usr/local/bin` (`brew install whisper-cpp`
installs both); either one is enough. Without `MWC_WHISPER_MODEL`, the model is `ggml-large-v3-turbo-q5_0.bin` from
`~/Library/Application Support/Airia Bug Report/models/`, else from `~/.cache/whisper/`. Looking
starts no process; the server's log says once at startup what it uses, or why dictation is off. With `off`, or without
whisper.cpp or a model, the route answers 503 `speech_unavailable`.

## Refusals

| Status | Code                     | When                                                        |
| ------ | ------------------------ | ----------------------------------------------------------- |
| 401    | `unauthenticated`        | no credential, or one that is not valid                     |
| 403    | `user_not_linked`        | a session of a person this server has not linked yet        |
| 413    | `audio_too_large`        | larger than 8 MB, or longer than two minutes                |
| 415    | `unsupported_media_type` | the body is not `audio/wav`                                 |
| 422    | `invalid_audio`          | not a 16 kHz mono 16-bit PCM WAV                            |
| 502    | `speech_failed`          | whisper.cpp could not transcribe the clip                   |
| 503    | `speech_unavailable`     | dictation is off on this server                             |

Not in this step: a talk mode, reading replies aloud, and transcribing anywhere other than the server's computer.
