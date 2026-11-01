# JW Preset Applicator Pro

An After Effects panel for editors: apply animation presets that fit each clip, precompose, add adjustment layers, cut and sequence clips, remove vocals with AI, add beat markers, cut silence, and a lot more — without leaving After Effects.

Works with **After Effects CC 2018 and newer** on Windows.

## Features

- **Effect** – apply an `.ffx` preset to the selected layers, stretched to each clip, with a live intensity slider and a preview of the preset.
- **Tools** – solids, nulls, cameras and lights in one click; fit to comp; frame blending on every layer; paste an image from the clipboard; comp screenshots; un-precompose; explode text; cut to marker; sequence by markers; beat markers; auto cut silence; stretch keyframes; bounce and elastic; path to nulls.
- **Precomp / Adjust** – precompose each clip or all together, adjustment layers with a preset, label colours, cut flashes, split frames at joins, save a comp as its own project.
- **Quality** – send clips to Topaz Video AI in the background, quick exports, instant previews, smart scene detection.
- **Layers** – save layers (including everything inside precomps) to a library and insert them into any project.
- **Ease** – a curve editor with presets for keyframe easing.
- **Audio** – an AI vocal remover (runs locally, nothing is uploaded) and a sound-effects browser.
- **Home** – session timer, editing time over the last 7 days, project health check and one-click project tidy-up, disk-cache monitor.
- **Ctrl+Space** quick search for effects, presets, saved layers and curves.
- 20 colour themes.

## Install

Download `JW-Preset-Applicator-Pro-Setup.exe` from the [Releases](../../releases) page and run it. Then open After Effects and choose **Window › Extensions › JW Preset Applicator Pro**. To update or remove it later, run the setup again.

Windows may show "Windows protected your PC" because the installer isn't code-signed: click **More info › Run anyway**.

## Build it yourself

You need Windows and Node.js (the C# compiler that ships with Windows builds the installer).

```
node build/build.js release                                   # clean extension in dist/ + dist/payload.zip
powershell -ExecutionPolicy Bypass -File build/installer/build-installer.ps1   # dist/JW-Preset-Applicator-Pro-Setup.exe
```

`node build/build.js personal` installs a development copy straight into your Adobe CEP extensions folder. Optional local files (not in the repo): `build/personal.json` for your own defaults, `build/leak-patterns.txt` for words a release build must never contain.

Folder layout:

- `extension-staging/` – the panel (HTML/CSS/JS), the After Effects scripts (`jsx/`), the Ctrl+Space helper (`helper/`) and the vocal-remover engine script (`engine/`).
- `build/` – the build script and the Windows installer.
