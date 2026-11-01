"""Sentence Studio speech engine setup (run by Sentence Studio Setup.exe with the included Python).

Creates a private Python runtime with the local CPU speech engine (faster-whisper + WhisperX),
FFmpeg and the timeline-hover helpers inside --state. Prints "@@ <percent> <message>" lines for the
installer's progress bar; everything else goes to <state>/setup-log.txt.
No accounts, telemetry or uploads. Speech models download on the first detection.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
ENGINE_VERSION = b'python3.11.17-cpu-v2'


def step(pct, message):
    print('@@ %d %s' % (pct, message), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != 'win32':
        raise RuntimeError('This installer is for Windows x64.')
    state = args.state.resolve()
    state.mkdir(parents=True, exist_ok=True)
    log = open(state / 'setup-log.txt', 'a', encoding='utf-8')

    def run(*cmd):
        log.write('\n> ' + ' '.join(str(x) for x in cmd) + '\n')
        log.flush()
        subprocess.run([str(x) for x in cmd], check=True, stdout=log, stderr=subprocess.STDOUT, creationflags=0x08000000)

    requirements = (ROOT / 'requirements.txt').read_bytes() + (ROOT / 'hover-requirements.txt').read_bytes()
    fingerprint = hashlib.sha256(requirements + ENGINE_VERSION).hexdigest()
    marker = state / 'engine-ready.json'
    python = state / 'runtime/Scripts/python.exe'
    ffmpeg = state / 'bin/ffmpeg.exe'
    check = 'import torch; from faster_whisper import WhisperModel; from whisperx.alignment import align; import winrt.windows.media.ocr'

    if marker.exists() and python.exists() and ffmpeg.exists():
        try:
            if json.loads(marker.read_text()).get('fingerprint') == fingerprint:
                step(90, 'Checking the existing speech engine')
                run(python, '-c', check)
                step(100, 'Speech engine ready')
                return
        except (ValueError, subprocess.CalledProcessError):
            pass

    step(5, 'Preparing the included Python')
    portable = state / 'python-3.11.17'
    shutil.copytree(ROOT / 'python', portable, dirs_exist_ok=True)
    if not python.exists():
        run(portable / 'python.exe', '-m', 'venv', state / 'runtime')
    step(12, 'Updating the package installer')
    run(python, '-m', 'pip', 'install', '--upgrade', 'pip')
    step(18, 'Downloading PyTorch (the biggest part, can take a while)')
    run(python, '-m', 'pip', 'install', 'torch==2.8.0', 'torchaudio==2.8.0', 'torchvision==0.23.0', '--index-url', 'https://download.pytorch.org/whl/cpu')
    step(55, 'Downloading the speech engine')
    run(python, '-m', 'pip', 'install', '-r', ROOT / 'requirements.txt')
    step(80, 'Installing the timeline picker helpers')
    run(python, '-m', 'pip', 'install', '-r', ROOT / 'hover-requirements.txt')
    step(86, 'Setting up FFmpeg')
    binary = subprocess.check_output([str(python), '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], text=True, creationflags=0x08000000).strip()
    ffmpeg.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, ffmpeg)
    step(90, 'Adding word-alignment language data')
    bundled = ROOT / 'nltk_data'
    if bundled.is_dir():
        shutil.copytree(bundled, state / 'nltk_data', dirs_exist_ok=True)
    step(94, 'Checking the speech engine')
    run(python, '-c', check)
    run(ffmpeg, '-hide_banner', '-version')
    marker.write_text(json.dumps({'fingerprint': fingerprint}), encoding='utf8')
    step(100, 'Speech engine ready')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as e:
        print('ERROR A setup step failed (%s). Details are in setup-log.txt.' % Path(str(e.cmd[0])).name, flush=True)
        sys.exit(1)
    except Exception as e:
        print('ERROR ' + str(e), flush=True)
        sys.exit(1)
