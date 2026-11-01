"""Local speech recognition + phoneme alignment. Emits JSON progress lines."""
import argparse
import gc
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback

def emit(stage, message, progress=None):
    print(json.dumps({"stage": stage, "message": message, "progress": progress}), flush=True)


def folder_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


class DownloadWatcher:
    """Reports a download's progress by watching its folder grow (works with any huggingface/torch version).
    Silent unless something is actually downloading."""
    def __init__(self, folder, label, total=0, lo=0, hi=0, stage="download"):
        import threading
        self.folder, self.label, self.total, self.lo, self.hi, self.stage = Path(folder), label, total, lo, hi, stage
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def __enter__(self):
        self.start_size = folder_size(self.folder)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop_event.set()
        self.thread.join(timeout=2)

    def run(self):
        import time
        last_size, last_time, speed = self.start_size, time.monotonic(), 0.0
        while not self.stop_event.wait(1.0):
            size = folder_size(self.folder)
            now = time.monotonic()
            got = size - self.start_size
            if got <= 0:
                continue
            rate = (size - last_size) / max(.001, now - last_time)
            speed = rate if speed == 0 else speed * .7 + rate * .3
            last_size, last_time = size, now
            if self.total:
                frac = min(1.0, got / self.total)
                left = (self.total - got) / speed if speed > 1e4 else 0
                eta = (" · about %d min left" % max(1, round(left / 60))) if left > 60 else (" · under a minute left" if left else "")
                text = "%s (one time only): %.2f / %.1f GB · %.1f MB/s%s" % (self.label, got / 1e9, self.total / 1e9, speed / 1e6, eta)
                emit(self.stage, text, self.lo + (self.hi - self.lo) * frac)
            else:
                emit(self.stage, "%s (one time only): %d MB · %.1f MB/s" % (self.label, got / 1e6, speed / 1e6), self.lo)


def model_complete(path):
    """A model folder only counts if its weights are really there. An interrupted download leaves the small
    files (config, tokenizer) without model.bin, and huggingface still reports that folder as present."""
    try:
        weights = Path(path) / "model.bin"
        return (Path(path) / "config.json").is_file() and weights.is_file() and weights.stat().st_size > 1e6
    except OSError:
        return False


def model_repo(model_name):
    try:
        from faster_whisper.utils import _MODELS
        return _MODELS.get(model_name, model_name)
    except Exception:
        return model_name if "/" in model_name else "Systran/faster-whisper-" + model_name


def refetch_weights(model_name, root, path):
    """Downloads model.bin again. On Windows (no symlinks) huggingface keeps an existing copy even with
    force_download, so the damaged copy is removed first."""
    from huggingface_hub import hf_hub_download
    try:
        os.remove(Path(path) / "model.bin")
    except OSError:
        pass
    hf_hub_download(model_repo(model_name), "model.bin", cache_dir=str(root), force_download=True)


def ensure_whisper_model(model_name, root):
    """Returns a local folder for the speech model, downloading it (about 3 GB) with visible progress.
    An unfinished earlier download is resumed rather than mistaken for a finished one."""
    if os.path.isdir(model_name):
        return model_name
    from faster_whisper.utils import download_model
    try:
        local = download_model(model_name, local_files_only=True, cache_dir=str(root))
        if model_complete(local):
            return local
    except Exception:
        pass  # not downloaded yet, or only partly
    repo = model_repo(model_name)
    total = 3.09e9 if "large" in model_name else 0
    try:
        from huggingface_hub import HfApi
        info = HfApi().model_info(repo, files_metadata=True, timeout=15)
        total = sum((s.size or 0) for s in info.siblings) or total
    except Exception:
        pass
    emit("download", "Downloading the speech model (one time only, about %.1f GB)…" % ((total or 3.1e9) / 1e9), 5)
    root.mkdir(parents=True, exist_ok=True)
    try:
        with DownloadWatcher(root, "Downloading the speech model", total, 5, 10):
            path = download_model(model_name, cache_dir=str(root))
            if not model_complete(path):
                # the folder exists but the weights are missing or cut short: fetch exactly that file
                refetch_weights(model_name, root, path)
    except Exception as exc:
        raise RuntimeError("Couldn't download the speech model (%s). Check the internet connection and that huggingface.co isn't blocked, "
                           "then press Detect speech again; finished parts are kept." % (str(exc).splitlines()[0][:160] if str(exc) else type(exc).__name__))
    if not model_complete(path):
        raise RuntimeError("The speech model download didn't finish. Press Detect speech again to resume it.")
    return path


def load_whisper_model(model_name, root, **kwargs):
    """Loads the speech model; if its weights file is damaged (e.g. a copy cut off by a crash or an
    antivirus scan), downloads that file again once and retries."""
    from faster_whisper import WhisperModel
    path = ensure_whisper_model(model_name, root)
    try:
        return WhisperModel(path, **kwargs)
    except Exception as first:
        if os.path.isdir(model_name):
            raise
        emit("download", "The speech model file looks damaged · downloading it again…", 5)
        try:
            with DownloadWatcher(root, "Re-downloading the speech model", 3.09e9 if "large" in model_name else 0, 5, 10):
                refetch_weights(model_name, root, path)
        except Exception as exc:
            raise RuntimeError("The speech model file is damaged and couldn't be downloaded again (%s). Check the internet connection, "
                               "then press Detect speech again." % (str(exc).splitlines()[0][:160] if str(exc) else type(exc).__name__))
        emit("recognize", "Loading speech model…", 10)
        return WhisperModel(path, **kwargs)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("request")
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text(encoding="utf-8-sig"))
    os.environ['NLTK_DATA'] = str(Path(request['state']) / 'nltk_data')
    output = Path(request["output"])
    work = output.parent
    work.mkdir(parents=True, exist_ok=True)
    wav = work / "speech.wav"
    cmd = [request["ffmpeg"], "-hide_banner", "-loglevel", "error", "-y"]
    trim = float(request.get("trimStart", 0))
    if trim > 0:
        cmd += ["-ss", str(trim)]
    cmd += ["-i", request["audio"]]
    if request.get("duration"):
        cmd += ["-t", str(float(request["duration"]))]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", str(wav)]
    emit("prepare", "Preparing audio…", 0)
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    import numpy as np
    import wave
    with wave.open(str(wav), "rb") as audio_file:
        audio = np.frombuffer(audio_file.readframes(audio_file.getnframes()), np.int16).astype(np.float32) / 32768
    duration = len(audio) / 16000
    emit("prepare", "Audio ready.", 5)
    language = request.get("language", "auto")
    if language == "auto":
        language = None
    transcript = request.get("transcript", "").strip()
    segments = []
    probability = None
    if transcript:
        # Correction can provide per-phrase audio windows, or a full exact transcript.
        segments = request.get("segments") or [{"start": 0.0, "end": duration, "text": transcript}]
        if not language:
            language = request.get("detectedLanguage")
        if not language:
            raise ValueError("Choose a language before aligning a manually supplied transcript.")
    else:
        from faster_whisper import WhisperModel
        model_name = request.get("model", "large-v3")
        state = Path(request["state"])
        ensure_whisper_model(model_name, state / "models")
        emit("recognize", "Loading speech model…", 10)
        # CPU int8 works without installing system CUDA. GPU acceleration is optional later.
        model = load_whisper_model(model_name, state / "models", device="cpu", compute_type="int8", cpu_threads=min(os.cpu_count() or 4, 12))
        generated, info = model.transcribe(str(wav), language=language, beam_size=5, vad_filter=True, condition_on_previous_text=True, initial_prompt=request.get("hints") or None, word_timestamps=True)
        language = info.language
        probability = info.language_probability
        for segment in generated:
            emit("recognize", "Detecting speech: %.1fs / %.1fs" % (segment.end, duration), 10+60*min(1, segment.end/max(duration, .001)))
            if segment.no_speech_prob > .8 and segment.avg_logprob < -1:
                continue
            segments.append({"start": segment.start, "end": segment.end, "text": segment.text.strip()})
        del model
        gc.collect()
    if not segments:
        raise ValueError("No speech found. Try clearer audio or supply the spoken transcript.")
    emit("align", "Loading word alignment…", 70)
    from whisperx.alignment import load_align_model, align
    align_dir = Path(request["state"]) / "alignment"
    align_dir.mkdir(parents=True, exist_ok=True)
    # the first time for each language this downloads a few hundred MB: show it instead of sitting at 70%
    with DownloadWatcher(align_dir, "Downloading the word-alignment model", 0, 70, 70, stage="align"):
        alignment, metadata = load_align_model(language_code=language, device="cpu", model_dir=str(align_dir))
    aligned = {"word_segments": []}
    emit("align", "Aligning word timings…", 80)
    for index, segment in enumerate(segments):
        part = align([segment], alignment, metadata, audio, "cpu", return_char_alignments=False, interpolate_method="ignore")
        aligned["word_segments"].extend(part["word_segments"])
        emit("align", "Aligned phrase %d / %d" % (index+1, len(segments)), 80+15*(index+1)/len(segments))
    words = []
    missing = []
    for i, word in enumerate(aligned["word_segments"]):
        item = {"word": word["word"].strip(), "start": word.get("start"), "end": word.get("end"), "score": word.get("score"), "review": False}
        if item["start"] is None or item["end"] is None or item["end"] <= item["start"]:
            item["review"] = True
            missing.append(i)
        elif item["score"] is not None and item["score"] < .65:
            item["review"] = True
        words.append(item)
    result = {"words": words, "language": language, "languageProbability": probability, "duration": duration, "segments": segments, "unaligned": missing, "engine": "faster-whisper large-v3 + WhisperX phoneme alignment", "transcript": " ".join(x["text"] for x in segments)}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    emit("done", "Aligned %d words. Review highlighted words before creating captions." % len(words), 100)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit("error", str(exc))
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
