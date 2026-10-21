# Kathai கதை — English ⇄ Jaffna Tamil voice translator

A mobile-first web app. Tap **English** or **தமிழ்**, speak, and the phone says the translation out loud in the other language. It also shows the translation as text, what it heard, and (for Tamil) an English-letter pronunciation guide.

## How it works

1. The mic records your speech (MediaRecorder). It stops by itself after a short pause (0.9 s by default, adjustable), or when you tap again. The connection to Google is opened while you are still talking.
2. The recording goes to **Gemini** (`gemini-3.8-flash`, minimal thinking) in one streamed call that both transcribes and translates. The prompt carries a Jaffna dialect guide (ஓம், கதை, -ங்கோ endings, இஞ்ச, கெதியா …) so the Tamil sounds like Jaffna, not Chennai or textbook Tamil.
3. As soon as the translation text arrives (before the rest of the reply), it goes to **Gemini TTS** (`gemini-3.8-flash-tts`) with a "Jaffna Tamil accent" style. Speech is streamed and starts playing with the first piece of audio.
4. Each bubble shows timings: seconds from the end of recording to the text, and to the first sound.

If streaming fails before anything arrives, each call falls back to a single plain request.

There is no server. The page calls the Gemini API directly from the browser with **your own API key**, which is stored only in that browser's local storage.

## Use it

- Open the hosted page on your phone, tap ⚙ Settings, paste a Gemini API key from <https://aistudio.google.com/apikey>.
- Tip: in Google Cloud console, restrict the key to "HTTP referrers" for the page's address, so a leaked key is useless elsewhere.
- Add to Home Screen for a full-screen app.
- `?demo` in the URL runs a fake translator (no key, canned answers, a beep) for trying the UI.

## Develop

```sh
npm start        # serves on http://localhost:8080 (mic works on localhost)
npm test         # adapter tests with a fake fetch
```

Phones only allow the mic on **https** pages (or localhost), so test on a phone through the hosted copy or an https tunnel.

## Code map

| File | Job |
| --- | --- |
| `js/languages.js` | One table of language facts: names, voices, TTS style, dialect guide |
| `js/gemini.js` | Gemini adapter: `translateSpeech()` and `synthesize()` |
| `js/fake-provider.js` | Same interface with canned answers (`?demo`) |
| `js/recorder.js` | Mic capture and pause detection |
| `js/audio.js` | Speaker playback (whole clips and streamed pieces), mobile audio unlock |
| `js/wav.js` | PCM/WAV/base64 helpers |
| `js/sse.js` | Reads streamed replies; spots the finished translation in a partial reply |
| `js/app.js` | UI wiring |

Swapping Gemini for another provider means writing one new file with the same two functions.
