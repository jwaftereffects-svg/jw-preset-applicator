# JW Preset Applicator Pro

An After Effects panel for editors: apply animation presets that fit each clip, precompose, add adjustment layers, cut and sequence clips, remove vocals with AI, make word-by-word auto captions, add beat markers, cut silence, and a lot more — without leaving After Effects.

Works with **After Effects CC 2018 and newer** on Windows.

## Features

- **Effect** – apply an `.ffx` preset to the selected layers, stretched to each clip, with a live intensity slider and a preview of the preset.
- **Tools** – solids, nulls, cameras and lights in one click; fit to comp; frame blending on every layer; paste an image from the clipboard; comp screenshots; un-precompose; explode text; cut to marker; sequence by markers; beat markers; auto cut silence; stretch keyframes; bounce and elastic; path to nulls.
- **Precomp / Adjust** – precompose each clip or all together, adjustment layers with a preset, label colours, cut flashes, split frames at joins, save a comp as its own project.
- **Quality** – send clips to Topaz Video AI in the background, quick exports, instant previews, smart scene detection.
- **Layers** – save layers (including everything inside precomps) to a library and insert them into any project.
- **Ease** – a curve editor with presets for keyframe easing.
- **Audio** – an AI vocal remover and a sound-effects browser, plus **Auto Captions**:
  - local speech detection with word-level timing (faster-whisper large-v3 + WhisperX, nothing is uploaded),
  - drag the pin onto a layer in the timeline to pick its audio (precomps are rendered automatically),
  - review and correct words or the whole transcript, then realign,
  - caption styles: Animated (your own captured text animation), Pop-up, Widescreen,
  - a **style editor**: start from any style, change font, size, colours, outline, caps, spacing, blend mode, drop shadow, word-by-word build and height, and save your own styles.
- **Home** – session timer, editing time over the last 7 days, project health check and one-click project tidy-up, disk-cache monitor.
- **Ctrl+Space** quick search for effects, presets, saved layers and curves.
- 20 colour themes.

## Install

Download `JW-Preset-Applicator-Pro-Setup.exe` from the [Releases](../../releases) page and run it. Then open After Effects and choose **Window › Extensions › JW Preset Applicator Pro**. To update or remove it later, run the setup again.

With **Auto captions** switched on (the default), setup also installs the local speech engine: a one-time download of about 4 GB from the official Python package sites. The first time you detect speech, the speech model (about 3 GB) downloads too, with progress shown in the panel. Auto captions used to be a separate panel called Sentence Studio; setup removes that panel and reuses its speech engine.

Windows may show "Windows protected your PC" because the installer isn't code-signed: click **More info › Run anyway**.

## Build it yourself

You need Windows and Node.js (the C# compiler that ships with Windows builds the installer).

```
node build/build.js release                                   # clean extension in dist/ + dist/payload.zip
powershell -ExecutionPolicy Bypass -File build/installer/build-installer.ps1   # dist/JW-Preset-Applicator-Pro-Setup.exe
```

`node build/build.js personal` installs a development copy straight into your Adobe CEP extensions folder. Optional local files (not in the repo):

- `build/personal.json` – your own defaults for the personal build.
- `build/leak-patterns.txt` – words a release build must never contain.
- `build/captions-assets.json` – where the installer finds the auto-caption files that aren't in the repo: `python` (portable CPython 3.11 folder), `nltk` (NLTK data), `template` (default `animation-template.aep`), `font` (TikTok Sans .ttf) and `ofl` (its license). Without this file the installer is built without the auto-captions option.

Folder layout:

- `extension-staging/` – the panel (HTML/CSS/JS), the After Effects scripts (`jsx/`), the Ctrl+Space helper (`helper/`) and the engine scripts (`engine/`: vocal remover, speech worker, timeline pin overlay).
- `build/` – the build script and the Windows installer; `build/captions/engine-setup/` sets up the speech engine during install.
