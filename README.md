# 架子鼓

在浏览器里用电脑键盘，或者用手指敲屏幕，演奏一套原声架子鼓。页面是静态的，可以放到 GitHub Pages 上免费访问。

## 怎么演奏

打开页面，等「正在加载鼓的音色…」消失就可以敲。

- **电脑**：按鼓面上标出的键。可以同时按住几个键，声音会叠在一起，前一下不会被切断。按住不放时，会按系统的连发速度连击。
- **手机和平板**：请横过来握。手指点在鼓上就会响，多根手指可以同时敲不同的鼓。按下的瞬间出声，没有点击延迟。

建议两只手分开：左手放在 `A` `S` `D` 一带（踩镲、军鼓，向上够 `Q` 打吊镲），右手放在 `J` `K` `L` 一带（三只嗵鼓，向上够 `O` 打叮叮镲），空格用拇指打底鼓。

## 键位

| 键 | 鼓 | English | 哪只手 |
| --- | --- | --- | --- |
| A | 闭镲 | Closed hi-hat | 左手 |
| S | 军鼓 | Snare | 左手 |
| D | 开镲 | Open hi-hat | 左手 |
| Q | 吊镲 | Crash | 左手向上 |
| 空格 | 底鼓 | Kick | 拇指 |
| J | 高音嗵鼓 | Hi tom | 右手 |
| K | 中音嗵鼓 | Mid tom | 右手 |
| L | 落地嗵鼓 | Floor tom | 右手 |
| O | 叮叮镲 | Ride | 右手向上 |

鼓面上也写着同样的键。页面里的「关于」可以再看一遍这张表。

## 录音、播放、节拍器和音量

- **录音**：点一下开始，再点一下结束。按钮上会显示已经录了多久。再录一次会换掉上一段。
- **播放**：按你敲的时间和顺序把刚才那段放出来，鼓面也会跟着亮。播放时你还可以接着敲，这些新敲的不会写进正在播放的那段。
- **清空**：删掉当前录音。
- **节拍**：打开节拍器。第一拍稍重一点，旁边有四拍的指示。拖动 **BPM** 改速度，范围是 40 到 220。节拍器的嘀声不会被录进去。
- **音量**：同时调节鼓和节拍器。音量和 BPM 会记在这台浏览器里。

## 手机横屏

整套鼓按横屏来排。竖着拿手机时，会盖住琴面，提示你转成横向。

点 **进入全屏并横屏** 之后，页面会先进入全屏，再尝试 `screen.orientation.lock('landscape')`。支持的浏览器会自己转到横屏。iPhone 自带的 Safari 通常不允许网页锁定方向，这时按提示关掉方向锁，手动把手机横过来即可。工具栏上的 **全屏** 也会做同样的尝试。

横屏以后鼓铺满画面，每面鼓都按手指能按住的大小来排。触摸用的是 `pointerdown` / `pointerenter`，不是带延迟的 `click`。一根手指按住再滑到另一面鼓，也会敲响那一面。页面会阻止滚动、双指缩放、双击放大和选中文字，避免演奏时页面乱跑。

## 音色和许可

鼓的声音是真实采样，不是合成器。来源是 **Virtuosity Drums**（Versilian Studios 与 Karoryfer Samples），许可证为 **CC0 1.0**，属于公有领域，可以自由使用、修改和再分发，没有额外的授权问题。

本仓库用的是 mid 麦克风、中等力度的敲击，转成了单声道 44.1 kHz WAV，并切到鼓槌落下的瞬间，文件开头不留空白。页面会向浏览器要最小的音频缓冲，采样在打开时就解码进内存，所以按键后马上出声。每面鼓有两条采样轮流播放，连击不会那么死板。原库没有单独的中音嗵鼓，这里的中音嗵鼓是高音嗵鼓降低四个半音得来的。

详细文件对照见 [samples/CREDITS.md](samples/CREDITS.md)。

- 上游：<https://github.com/sfzinstruments/virtuosity_drums>
- CC0：<https://creativecommons.org/publicdomain/zero/1.0/deed.zh>

界面中文使用 Noto Sans CJK SC 的子集，字体许可证是 [SIL Open Font License](fonts/OFL.txt)。

## 在自己电脑上打开

采样通过 `fetch` 加载。直接双击 `index.html`（`file://`）时，浏览器会拦住这些请求，鼓就没有声音。请在仓库目录开一个静态服务器：

```bash
python3 -m http.server 8787
```

然后打开 <http://localhost:8787/> 。

## 部署到 GitHub Pages

仓库里的 [`.github/workflows/pages.yml`](.github/workflows/pages.yml) 会在代码推送到 `main` 时，把页面部署到 GitHub Pages。使用前要在仓库设置里把 Pages 的来源选成 GitHub Actions。

1. 打开这个 GitHub 仓库。
2. 进入 **Settings**（设置）→ 左侧 **Pages**。
3. 在 **Build and deployment**（构建和部署）里，把 **Source**（来源）选成 **GitHub Actions**。不要选 “Deploy from a branch”。
4. 把包含这个工作流的提交合并进默认分支 `main`。
5. 打开 **Actions**，确认 “Deploy GitHub Pages” 成功。
6. 回到 **Settings → Pages**，页面顶部会给出网址，一般是 `https://brighthuang84.github.io/drum-kit/`。以设置页上写的为准。

如果 Source 已经是 GitHub Actions，就不用再改别的开关，合并到 `main` 之后会自动部署。

工作流文件必须在默认分支上，GitHub 才会运行它。只存在于尚未合并的分支里时，不会发布页面。

第一次部署时，如果仓库是私有的，Actions 可能停在等待批准（Waiting for review）。打开那次运行，或到 **Settings → Environments → github-pages** 里批准。公开仓库通常不用这一步。

免费的 GitHub Pages 面向公开仓库。私有仓库要看账号是否包含 Pages。

## 重新生成采样

`tools/prepare_samples.py` 会重新下载上游 CC0 采样并写出 `samples/*.wav`。需要本机有 Python 3 和 ffmpeg。下载的原始文件放在 `samples/_src/`，这个目录不会提交。
