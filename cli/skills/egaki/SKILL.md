---
name: egaki
description: >
  AI image and video generation CLI. Use this skill to install egaki, configure
  auth, run help commands, and generate images or videos with provider keys or
  an Egaki subscription.
---

# egaki

Generate AI images and videos from the terminal.
Use this for text-to-image, image editing, mask-based edits, text-to-video,
image-to-video, audio stem separation, and model discovery.

## Install

```bash
pnpm add -g egaki
```

## Always check help first

Run the full help output before using commands:

```bash
egaki --help
```

Do not truncate help output with `head`.

For subcommand details: `egaki <command> --help` (e.g. `egaki image --help`, `egaki video --help`, `egaki login --help`)

## Auth options

You can authenticate in two ways:

1. Egaki subscription key (recommended — all models, one key)
2. Provider API keys (Google, OpenAI, Fal, Replicate) via `egaki login`

If using Egaki subscription, set it up first with `egaki subscribe`, then store
the key with `egaki login --provider egaki --key egaki_...`.

## Login behavior for remote agents

When login requires a URL flow, run login in the background and send the login URL
to the user so they can complete auth interactively.

## Model selection

The `--model` / `-m` flag is **optional** on both `egaki image` and `egaki video`.

- **Interactive (TTY):** omitting `--model` shows a picker with popular models
- **Non-interactive (piped/scripted):** omitting `--model` uses a sensible default

Agents should always pass `-m` explicitly to avoid the interactive picker.

### Preferred image models

When the user does not specify a model, prefer these in order:

1. **`gpt-image-1`** (or `gpt-image-2` / `chatgpt-image-latest` if available)
2. **`grok-imagine-image`** (xAI Grok)
3. **`nano-banana-pro-preview`**

Always try the first available model. Fall back to the next if auth is missing
for the preferred one.

### Preferred video models

When the user does not specify a video model, prefer:

1. **`grok-imagine-video-1.5`** (xAI Grok)

## Example commands

```bash
# configure key interactively
egaki login

# show login status
egaki login --show

# subscribe to Egaki for all supported models
egaki subscribe

# check subscription usage
egaki usage

# generate an image (interactive model picker if TTY)
egaki image "a watercolor fox reading a map" -o fox.png

# select a model explicitly
egaki image "isometric floating city, soft colors" -m imagen-4.0-generate-001 -o city.png

# edit an existing image (local file or URL)
egaki image "add a red scarf and make it winter" --input portrait.jpg -o portrait-winter.png
egaki image "turn this into a manga panel" --input https://example.com/photo.jpg -o manga.png

# inpainting with a mask
egaki image "replace the sky with a dramatic sunset" --input scene.png --mask mask.png -o scene-sunset.png

# generate a video — use a 5 minute timeout, video generation is slow
egaki video "a paper boat drifting on a calm lake at sunrise" -o boat.mp4

# generate a video with a specific model
egaki video "timelapse of a stormy sea, cinematic" -m google/veo-3.1-fast-generate-001 --duration 6 -o storm.mp4

# cheap video model
egaki video "a cat walking on a rooftop at night" -m klingai/kling-v2.5-turbo-t2v --duration 5 -o cat.mp4

# image-to-video (model must support i2v)
egaki video "slowly animate the clouds" --input photo.jpg -m klingai/kling-v2.6-i2v -o animated.mp4

# discover all models (image + video)
egaki models

# filter by type
egaki models --type video
egaki models --type image
```

## Audio stem separation (demucs)

Separate audio into individual stems using Meta's **Demucs** model via fal.ai.
Requires a fal.ai API key (`egaki login --provider fal`).

The default model `htdemucs_6s` splits into 6 stems: **vocals, drums, bass,
guitar, piano, other**. By default only vocals and other (background) are
extracted.

```bash
# Extract vocals and background (default)
egaki demucs song.mp3

# Extract only vocals
egaki demucs song.mp3 --stems vocals

# All 6 stems as WAV
egaki demucs song.mp3 --stems vocals,drums,bass,other,guitar,piano --output-format wav

# Save to a directory
egaki demucs song.mp3 -o stems/

# Higher quality (slower, more random shifts)
egaki demucs song.mp3 --shifts 5

# Read from stdin (e.g. ffmpeg pipe)
ffmpeg -i video.mp4 -f mp3 - | egaki demucs --stdin -o stems/
```

Output files are named `{input}-{stem}.{format}` (e.g. `song-vocals.mp3`,
`song-other.mp3`).

**Model variants:** `htdemucs_6s` (default, 6 stems), `htdemucs` (4 stems),
`htdemucs_ft` (fine-tuned 4 stems), `hdemucs_mmi` (4 stems), `mdx` (4 stems,
MDX architecture), `mdx_extra` (4 stems, MDX), `mdx_q` (4 stems, quantized),
`mdx_extra_q` (4 stems, quantized). Guitar and piano stems are only available
with `htdemucs_6s`.

## Voice cloning

Clone a voice from any audio. Returns a voice ID for use with `egaki speech --voice <id>`.

Two providers:
- **Cartesia** (default): fast, free, best with short clean clips (5-10s)
- **ElevenLabs**: accepts longer audio (1-3 min), has `--remove-background-noise`

### Preparing the audio

Raw recordings, YouTube clips, podcasts, and interviews almost always have
background music, room noise, or multiple speakers. Feeding dirty audio to the
clone API produces a muddy, inaccurate voice. Always clean it up first.

**Step 1: Isolate vocals with demucs.**
Strip everything except the target speaker's voice. This removes background
music, ambient noise, sound effects, and other speakers.

```bash
egaki demucs recording.mp3 --stems vocals
# outputs: recording-vocals.mp3
```

For higher quality separation (slower), add `--shifts 5`.

**Step 2: Transcribe to find the best segment.**
Run transcription to get word-level timestamps. Look for a segment where the
speaker says a **complete phrase or sentence** clearly, with no hesitations,
filler words ("um", "uh"), crosstalk, or long pauses.

```bash
egaki transcribe recording-vocals.mp3
```

Review the `wordTimestamps` array in the JSON output. Pick a window that is:
- **Cartesia**: 5-10 seconds (max 10s). One clean sentence is ideal.
- **ElevenLabs**: 30s-3 min. Multiple sentences give better results.

The segment should start and end mid-speech, not on silence. The clone mimics
the energy and pacing of the source, so pick a segment that matches the tone
you want (calm narration, energetic presentation, conversational, etc.).

**Step 3: Trim with ffmpeg.**
Use the timestamps from step 2 to cut the exact segment. The `-c copy` flag
avoids re-encoding so there's no quality loss.

```bash
# Cartesia: trim a 10s clip (timestamps from transcription)
ffmpeg -i recording-vocals.mp3 -ss 12.5 -to 22.0 -c copy clip.mp3

# ElevenLabs: trim a longer segment
ffmpeg -i recording-vocals.mp3 -ss 5.0 -to 65.0 -c copy clip-long.mp3
```

### Cloning

```bash
# Cartesia (default, fast, free)
egaki voice clone clip.mp3 --name "Speaker Name"

# ElevenLabs (longer clips, optional noise removal)
egaki voice clone clip-long.mp3 --name "Speaker Name" --provider elevenlabs

# ElevenLabs with AI noise removal (if source still has some noise)
egaki voice clone clip.mp3 --name "Speaker Name" --provider elevenlabs --remove-background-noise

# Specify language for non-English Cartesia clones (ignored by ElevenLabs)
egaki voice clone clip.mp3 --name "Narrador" --language es
```

The command prints the voice ID on success. Save it.

### Using the cloned voice

```bash
egaki speech "Any text you want spoken in the cloned voice." --voice <voice-id> -m sonic-3.5
```

The voice ID works with any Cartesia TTS model (`sonic-3`, `sonic-3.5`) or
ElevenLabs model (`eleven_v3`, `eleven_flash_v2_5`) depending on which
provider you cloned with. Cartesia voice IDs only work with Cartesia models
and vice versa.

### Full pipeline example

```bash
# 1. Download audio (e.g. from YouTube)
yt-dlp -x --audio-format mp3 -o source.mp3 'https://youtube.com/watch?v=...'

# 2. Isolate vocals
egaki demucs source.mp3 --stems vocals

# 3. Transcribe to find timestamps
egaki transcribe source-vocals.mp3

# 4. Trim to a clean 10s segment (adjust -ss and -to from timestamps)
ffmpeg -i source-vocals.mp3 -ss 0 -to 10 -c copy clip.mp3

# 5. Clone
egaki voice clone clip.mp3 --name "Narrator"
# Voice ID: abc123-def456-...

# 6. Generate speech
egaki speech "Your text here." --voice abc123-def456-... -m sonic-3.5 -o output.wav
```

## Video generation note for agents

Video generation can be very slow — some models take 1–3 minutes per request.
Always use a command timeout of **at least 5 minutes** when invoking `egaki video`
from automation or agent workflows.
