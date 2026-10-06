# 鼓采样来源 / Sample credits

这些鼓采样来自 **Virtuosity Drums**，由 Versilian Studios 与 Karoryfer Samples 录制并发布。

- 上游项目：<https://github.com/sfzinstruments/virtuosity_drums>
- 许可证：**CC0 1.0 Universal**（公有领域贡献）
- 许可证全文：<https://creativecommons.org/publicdomain/zero/1.0/deed.zh>
- 上游仓库中的法律文本：<https://github.com/sfzinstruments/virtuosity_drums/blob/master/LICENSE>

CC0 允许任何人复制、修改、发行和使用这些采样，包括商业用途，无需再取得许可。

## 本仓库里的处理

使用的是 mid 麦克风、中等力度的单次敲击，并转成单声道、44.1 kHz、16-bit WAV：切到鼓槌瞬态前约 0.2 毫秒（只留极短的淡入，避免剪切爆音），按鼓的长短裁尾并做淡出，峰值归一到大约 -1 dBFS。每面鼓保留两条采样，播放时轮流使用。

| 文件 | 上游采样 |
| --- | --- |
| `kick-1.wav` `kick-2.wav` | `Samples/mid/kick/mid_kick_snon_vl3_rr1.flac` `..._rr2.flac`（军鼓响弦打开） |
| `snare-1.wav` `snare-2.wav` | `Samples/mid/snare/mid_snare_center_vl18.flac` `..._vl22.flac` |
| `hh-closed-1.wav` `hh-closed-2.wav` | `Samples/mid/hh/mid_hh_closed_vl3_rr1.flac` `..._rr2.flac` |
| `hh-open-1.wav` `hh-open-2.wav` | `Samples/mid/hh/mid_hh_open_vl2_rr1.flac` `..._rr2.flac` |
| `crash-1.wav` `crash-2.wav` | `Samples/mid/crash/mid_crash_crash_vl2_rr1.flac` `..._rr2.flac` |
| `ride-1.wav` `ride-2.wav` | `Samples/mid/ride/mid_ride_ride_vl2_rr1.flac` `..._rr2.flac` |
| `tom-high-1.wav` `tom-high-2.wav` | `Samples/mid/htom/mid_htom_center_vl8.flac` `..._vl12.flac` |
| `tom-floor-1.wav` `tom-floor-2.wav` | `Samples/mid/ltom/mid_ltom_center_vl6.flac` `..._vl10.flac` |
| `tom-mid-1.wav` `tom-mid-2.wav` | 同一条高音嗵鼓采样，降低四个半音。原库没有单独的中音嗵鼓。 |

重新生成：在仓库根目录运行 `python3 tools/prepare_samples.py`（需要 Python 3 和 ffmpeg）。
