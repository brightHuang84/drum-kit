#!/usr/bin/env python3
"""Download CC0 Virtuosity Drums one-shots and write trimmed mono WAVs.

Source: https://github.com/sfzinstruments/virtuosity_drums
License: CC0 1.0 Universal (public domain dedication).

The mid tom is not a separate recording in this library. It is the high tom
pitch-shifted down four semitones, which CC0 allows.
"""

from __future__ import annotations

import array
import math
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "samples" / "_src"
OUT = ROOT / "samples"
BASES = (
    "https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/master/Samples/mid",
    "https://media.githubusercontent.com/sfzinstruments/virtuosity_drums/master/Samples/mid",
)
RATE = 44100

# name, relative flac path, max duration seconds, pitch semitones
JOBS = [
    ("kick-1", "kick/mid_kick_snon_vl3_rr1.flac", 0.62, 0),
    ("kick-2", "kick/mid_kick_snon_vl3_rr2.flac", 0.62, 0),
    ("snare-1", "snare/mid_snare_center_vl18.flac", 0.70, 0),
    ("snare-2", "snare/mid_snare_center_vl22.flac", 0.70, 0),
    ("hh-closed-1", "hh/mid_hh_closed_vl3_rr1.flac", 0.20, 0),
    ("hh-closed-2", "hh/mid_hh_closed_vl3_rr2.flac", 0.20, 0),
    ("hh-open-1", "hh/mid_hh_open_vl2_rr1.flac", 1.65, 0),
    ("hh-open-2", "hh/mid_hh_open_vl2_rr2.flac", 1.65, 0),
    ("crash-1", "crash/mid_crash_crash_vl2_rr1.flac", 2.50, 0),
    ("crash-2", "crash/mid_crash_crash_vl2_rr2.flac", 2.50, 0),
    ("ride-1", "ride/mid_ride_ride_vl2_rr1.flac", 2.05, 0),
    ("ride-2", "ride/mid_ride_ride_vl2_rr2.flac", 2.05, 0),
    ("tom-high-1", "htom/mid_htom_center_vl8.flac", 0.88, 0),
    ("tom-high-2", "htom/mid_htom_center_vl12.flac", 0.88, 0),
    ("tom-floor-1", "ltom/mid_ltom_center_vl6.flac", 1.15, 0),
    ("tom-floor-2", "ltom/mid_ltom_center_vl10.flac", 1.15, 0),
    ("tom-mid-1", "htom/mid_htom_center_vl8.flac", 1.10, -4),
    ("tom-mid-2", "htom/mid_htom_center_vl12.flac", 1.10, -4),
]


def download(rel: str) -> Path:
    SRC.mkdir(parents=True, exist_ok=True)
    dest = SRC / rel.replace("/", "__")
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    last = None
    for base in BASES:
        url = f"{base}/{rel}"
        try:
            print(f"GET {url}")
            urllib.request.urlretrieve(url, dest)
            if dest.stat().st_size < 1000:
                raise RuntimeError(f"too small: {dest.stat().st_size}")
            return dest
        except Exception as exc:  # noqa: BLE001
            last = exc
            print(f"  failed: {exc}", file=sys.stderr)
    raise RuntimeError(f"could not download {rel}: {last}")


def decode(path: Path, semitones: int) -> array.array:
    filters = []
    if semitones:
        ratio = 2 ** (semitones / 12)
        filters.append(f"asetrate={RATE}*{ratio:.8f}")
        filters.append(f"aresample={RATE}")
    cmd = ["ffmpeg", "-v", "error", "-i", str(path)]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += ["-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    raw = subprocess.check_output(cmd)
    samples = array.array("h")
    samples.frombytes(raw)
    return samples


def trim_normalize(samples: array.array, max_dur: float) -> array.array:
    if not samples:
        raise RuntimeError("empty audio")
    peak = max(abs(s) for s in samples) or 1
    threshold = max(int(peak * 0.05), 400)
    onset = 0
    for i, s in enumerate(samples):
        if abs(s) >= threshold:
            onset = i
            break
    preroll = int(0.002 * RATE)
    start = max(0, onset - preroll)
    end = min(len(samples), start + int(max_dur * RATE))
    chunk = array.array("h", samples[start:end])
    fade_in = min(len(chunk), int(0.0004 * RATE))
    for i in range(fade_in):
        chunk[i] = int(chunk[i] * (i / fade_in))
    fade_out = min(len(chunk), int(0.045 * RATE))
    for i in range(fade_out):
        idx = len(chunk) - fade_out + i
        chunk[idx] = int(chunk[idx] * (1 - i / max(1, fade_out)))
    peak = max(abs(s) for s in chunk) or 1
    target = int(32767 * (10 ** (-1 / 20)))  # -1 dBFS
    gain = target / peak
    out = array.array("h", (max(-32768, min(32767, int(s * gain))) for s in chunk))
    return out


def rms_db(samples: array.array) -> float:
    if not samples:
        return -99
    acc = 0.0
    for s in samples:
        acc += s * s
    rms = math.sqrt(acc / len(samples)) / 32768
    return 20 * math.log10(rms) if rms > 0 else -99


def write_wav(path: Path, samples: array.array) -> None:
    import wave

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(samples.tobytes())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, rel, dur, semis in JOBS:
        src = download(rel)
        audio = trim_normalize(decode(src, semis), dur)
        dest = OUT / f"{name}.wav"
        write_wav(dest, audio)
        print(
            f"{name:12} {len(audio)/RATE:5.2f}s  peak-norm  "
            f"rms {rms_db(audio):6.1f} dB  {dest.stat().st_size/1024:7.1f} KiB"
            + (f"  {semis:+d} st" if semis else "")
        )


if __name__ == "__main__":
    main()
