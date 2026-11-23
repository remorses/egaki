---
'egaki': minor
---

Add `egaki voice change`, a speech-to-speech command. It re-speaks an existing recording with another voice and keeps the timing, emotion and delivery. ElevenLabs is the default provider (`eleven_multilingual_sts_v2` or `eleven_english_sts_v2`, with `--remove-background-noise`); Cartesia is available with `--provider cartesia`. Both use the keys saved with `egaki login`.

```bash
egaki voice change take.wav --voice <voice-id> -o take-new-voice.mp3
```
