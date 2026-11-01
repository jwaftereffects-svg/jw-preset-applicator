"""JW Preset Applicator Pro - vocal remover worker.

Splits a song into vocals and instrumental with Meta's Demucs (htdemucs), on this PC.
Run by vocals.js with the engine's own Python:

    python vocals.py request.json

request.json: {"input", "start", "duration", "outDir", "quality": "fast"|"best", "ffmpeg", "models", "site", "gpuSite"?}
Prints one JSON line per update: {"progress": 0-100, "message": "..."}; the last line is
{"done": true, "files": {...}} or {"error": "..."}.
"""
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

RATE = 44100


def say(**kw):
    print(json.dumps(kw), flush=True)


def main():
    t0 = time.time()
    req = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    # runs isolated (-I -S): only the engine's own packages are visible
    import site
    if req.get("gpuSite"):  # CUDA build of PyTorch, found before the CPU one
        site.addsitedir(req["gpuSite"])
    site.addsitedir(req["site"])
    out = Path(req["outDir"])
    out.mkdir(parents=True, exist_ok=True)
    os.environ["TORCH_HOME"] = req["models"]  # model is cached here: never downloads

    say(progress=2, message="Reading the audio…")
    cmd = [req["ffmpeg"], "-hide_banner", "-loglevel", "error", "-nostdin"]
    if req.get("start"):
        cmd += ["-ss", "%.6f" % float(req["start"])]
    if req.get("duration"):
        cmd += ["-t", "%.6f" % float(req["duration"])]
    cmd += ["-i", req["input"], "-vn", "-ac", "2", "-ar", str(RATE), "-f", "f32le", "-"]
    p = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0:
        raise RuntimeError("Couldn't read the audio: " + p.stderr.decode("utf8", "replace").strip()[-300:])

    import numpy as np
    wav = np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, 2)
    if not len(wav):
        raise RuntimeError("This clip has no audio.")
    if len(wav) > RATE * 60 * 30:
        raise RuntimeError("Use a clip under 30 minutes.")

    say(progress=6, message="Loading the AI model…")
    import torch
    torch.set_num_threads(max(1, os.cpu_count() or 4))
    from demucs.htdemucs import HTDemucs
    torch.serialization.add_safe_globals([HTDemucs])  # only this model class may load
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    import demucs.apply as dapply

    model = get_model("htdemucs")
    model.eval()
    device = "cpu"
    try:
        if torch.cuda.is_available():
            torch.zeros(1, device="cuda")  # make sure the card really works
            device = "cuda"
    except Exception:
        device = "cpu"
    where = "on the graphics card" if device == "cuda" else "on the CPU"
    best = req.get("quality") == "best"
    shifts, overlap = (1, 0.25) if best else (0, 0.1)

    # progress: demucs walks the song in chunks through tqdm; count them
    segment = float(getattr(model, "segment", 7.8))
    chunks = max(1, math.ceil(len(wav) / ((1 - overlap) * segment * RATE))) * max(1, shifts)
    done = [0]

    class Tick:
        def __init__(self, items, **kw):
            self.items = items

        def __iter__(self):
            for it in self.items:
                yield it
                done[0] += 1
                say(progress=10 + 82 * min(0.99, done[0] / chunks), message="Separating vocals " + where + "…")

    dapply.tqdm.tqdm = Tick
    say(progress=10, message="Separating vocals " + where + "…")

    mix = torch.from_numpy(wav.T.copy())
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std()
    if std.item() < 1e-8:  # silence
        vocals = np.zeros_like(wav)
    else:
        with torch.inference_mode():
            res = apply_model(model, ((mix - mean) / std)[None].to(device), device=device,
                              shifts=shifts, split=True, overlap=overlap, progress=True, num_workers=0)[0]
        vocals = (res[model.sources.index("vocals")].cpu() * std + mean).T.numpy()
    instrumental = wav - vocals  # whatever isn't voice, so the two add back up to the original

    say(progress=94, message="Saving…")
    import soundfile as sf
    peak = max(float(np.abs(vocals).max()), float(np.abs(instrumental).max()), 1e-8)
    gain = min(1.0, 0.98 / peak)  # never clip
    files = {}
    for name, audio in (("vocals", vocals), ("instrumental", instrumental)):
        if not np.isfinite(audio).all():
            raise RuntimeError("The model returned invalid audio.")
        tmp, final = out / (name + ".tmp.wav"), out / (name + ".wav")
        sf.write(str(tmp), audio * gain, RATE, subtype="PCM_24")
        os.replace(tmp, final)
        files[name] = str(final)
    (out / "done.json").write_text(json.dumps({"files": files, "seconds": len(wav) / RATE, "gain": gain}), encoding="utf8")
    say(progress=100, done=True, files=files, device=device, elapsed=round(time.time() - t0, 1))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        say(error=str(e) or e.__class__.__name__)
        sys.exit(1)
