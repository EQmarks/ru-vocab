# 单词朗读音频（内置 mp3）

## 为什么不用浏览器 TTS

原来的实现用 `speechSynthesis`：手机浏览器依赖系统装的俄语语音包，
iPhone / 安卓很多机器没装，或者被自动播放策略拦截，结果就是「点喇叭没声音」。
现在改成**内置音频**：不依赖系统语音、不依赖网络（首次播放后）。

## 结构

- `public/audio/u01.mp3` … `u12.mp3`：每个单元 60 个词连在一起朗读（约 50 秒，300KB 左右）
- `public/audio/index.json`：每个词的 `start`（秒）和 `dur`
- `public/js/audio.js`：用 `<audio src="u01.mp3#t=12.3">` 从词的位置开始播；
  不支持 `#t` 的浏览器会在 metadata 到了之后补一次 `currentTime`。
- `public/sw.js`：单独一个 `rv-audio-v1` 缓存，首次播放时下载整个单元（约 300KB）并缓存；
  之后支持 Range，可离线从任意词开始播。

## 重新生成

词库改动后需要重跑：

    pip install edge-tts
    npm run audio

默认语音 `ru-RU-SvetlanaNeural`、语速 `-8%`；可以在 `scripts/build_audio.py` 里改。
生成约 3.6MB，全部提交进仓库，部署时随站点一起发。

## 注意

- 修改音频后要升 `public/sw.js` 的 `VERSION`（音频缓存本身不随版本清空）。
- 线上首次打开某个单元首次点词会有约 300KB 下载；之后离线可听。
