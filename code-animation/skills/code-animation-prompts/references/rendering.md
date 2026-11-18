# 工作台代码动画渲染协议

代码动画的实时预览和最终导出是两个阶段。预览在工作台右侧的内置浏览器中完成；最终导出交给工作台 extension-only 的 `host.tasks.render`（扩展必须声明 `hostTools` 权限）。内置浏览器的实时录屏只用于观察或留证，不能当作确定性最终渲染。

## 页面合同

入口 HTML 必须暴露一个只由时间驱动的接口：

```js
window.renderAt = async function (t) {
  // t 是从 0 开始的秒数；这里应准备好该时刻的完整画面。
  draw(t);
};
```

`renderAt` 必须在返回前完成图片、字体、视频帧和其他异步资源的准备。页面带 `?export=1` 时不得启动 `requestAnimationFrame`、计时器或其他自播放循环；渲染服务只通过 `renderAt(frame / fps)` 推进时间。每次调用都要从 `t`、固定配置和固定 `seed` 重算位置、透明度、粒子、相机和字幕，不能读取系统时钟、未播种的随机数或上一帧的可变状态。

入口还要带一个 `render-contract` JSON 元数据块。它是预检、渲染任务和验收报告的共同输入：

```html
<script id="render-contract" type="application/json">
{
  "duration": 12,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "seed": "launch-v3",
  "keyframes": [0, 6, 11.966666667],
  "assets": ["assets/logo.svg", "assets/hero.webp"]
}
</script>
```

`duration`、`fps`、`width`、`height` 必须是正数，`fps` 和尺寸必须是整数；`seed` 不能为空；`keyframes` 至少包含开头、中段和结尾，按严格递增顺序排列，且落在 `0..duration` 内。`assets` 是项目相对路径数组，不能出现盘符、绝对路径或 `..`。资源清单为空时仍需保留 `assets: []`。

## 项目资源

任务目录可以包含多文件：`index.html`、`assets/`、字体、JSON 数据、着色器和其他脚本都随项目保存。入口只引用相对路径，大小较大的图片、音频或视频保留为项目文件或宿主媒体资产，不把内容展开成 Base64 塞进 HTML。渲染服务在加载入口时以项目根为资源根；任一清单资源不存在、返回错误或在 `renderAt` 返回前仍未完成加载，都应使任务失败。

预览和最终任务都使用同一份项目文件。通过 `ma.tasks.preview(taskRef, relativePath)` 打开任务作品，或通过 `ma.exports.preview(exportId, fileName)` 打开导出的多文件资源；不要复制一份临时 HTML 让预览和最终导出使用不同版本。项目记录只保存项目相对入口和任务引用，不能保存本机绝对路径。

## 预检和关键帧

在打开浏览器前运行随技能附带的 Node 预检器：

```bash
node "<技能目录>/scripts/check_render.mjs" ./project/index.html
node "<技能目录>/scripts/check_render.mjs" ./project/index.html --project-root ./project --json
```

预检器检查 `render-contract`、`renderAt`、关键帧顺序、固定种子、资源存在性和最小的可见绘制输出；它不能替代浏览器像素验收。发现只有段落或标题而没有画布、SVG、图片、视频或几何绘制时直接失败。

页面在内置浏览器打开后，按合同中的每个关键帧执行两次 `renderAt(t)`，对画布、SVG 或其他视觉输出计算像素摘要并比较两次结果。摘要不同就报告对应的 `t`、调用序号和页面错误，先修复确定性再进入全片渲染。逐个查看开头、中段和结尾截图，确认字幕之外有可辨识的几何、图像、视频、粒子、光照或镜头运动；文字内容本身不算视觉交付。

## 最终渲染服务

预览通过后，确保内置浏览器标签加载的是带 `?export=1` 的入口，再把入口相对路径、资源清单、尺寸、帧率、时长、种子和关键帧交给 `host.tasks.render`。`validate` 只做入口能力预检，`preview` 生成单个采样帧，`start` 提交完整任务，`status` 查询进度，`cancel` 取消任务。服务在工作台的浏览器页面中加载项目，按下式逐帧请求画面：

扩展面板或 Agent 使用 SDK 时，对应入口是 `ma.tasks.validate(request)` 和 `ma.tasks.render(request)`：

```js
await ma.tasks.validate({ tabId, width: 1920, height: 1080 });
await ma.tasks.render({ action: 'preview', tabId, width: 1920, height: 1080, times: [6000] });
const started = await ma.tasks.render({
  action: 'start', tabId, width: 1920, height: 1080,
  times: [0, 6000, 11966],
  fps: 30
});
await ma.tasks.render({ action: 'status', renderId: started.renderId });
```

`preview` 和 `start` 都会返回任务 ID；不要把返回任务 ID 当作完成回执，必须读取 `status`。

```text
for frame = 0 .. ceil(duration × fps) - 1:
    await page.renderAt(frame / fps)  # 页面接口的单位是秒
    capture the page pixels at the declared viewport
```

`host.tasks.render` 的 `times` 传输值使用毫秒，服务必须在调用页面前转换为 `timeMs / 1000`；页面永远只接收秒。没有显式 `times` 时，可用 `durationMs` + `fps` 由服务生成递增时间点。`validate` 传入 `times` 时会逐个关键帧调用两次并比较采样结果，未传时只做 `renderAt` 能力预检。Node 侧使用 WebCodecs `VideoEncoder` 编码 VP8，再用 WebM 复用器写出 `video/webm`。服务返回实际帧数、尺寸、时长和宿主产物引用；不能把 PNG/JPEG 序列改名成 WebM，也不能用一次截图、实时录屏或文本脚本冒充完成。输出路径由宿主产物管理器返回，任务只接收该回执，不自行拼接本机路径。

最终渲染与内置浏览器的实时录屏有明确区别：实时录屏可能受合成节流、页面可见性和用户操作影响，适合快速观察；确定性渲染服务逐帧调用 `renderAt`，在任务参数固定时应得到可复现的关键帧和 WebM。隐藏页面不能通过“自动切到前台”掩盖失败；预览阶段应先让用户显示页面，最终服务则报告页面不可渲染的能力错误。

## 状态和失败回执

渲染任务至少暴露以下状态：

```text
preparing → rendering → finalizing → completed
                         ├──────────→ failed
                         └──────────→ cancelled
```

`completed` 必须同时提供 WebM 产物引用、`mimeType: "video/webm"`、宽高、实际时长和实际帧数。关键帧像素摘要属于验收记录，不得在没有实际比较时虚构为服务回执字段。`failed` 和 `cancelled` 必须提供稳定的任务 ID、当前阶段、已完成帧数、失败的帧号或关键帧时间（若已知）、错误消息和可操作的下一步；当前宿主回执通过 `failure` 返回这些字段，资源预检和页面 console 摘要由调用方另行附加。不能只返回“渲染失败”。资源缺失、`renderAt` 未定义、异步资源超时、WebCodecs 不可用、编码器错误和输出写入失败都要分别标明。失败报告不得包含凭据、宿主私有路径或整页正文。

停止、关闭页面或工作区换代时，任务进入 `cancelled`，不留下一个看似成功的半成品。重试应使用新的任务 ID，并再次读取项目文件和 `render-contract`；旧任务的迟到回执不能覆盖新任务。

## 交付验收

- Node 预检通过，入口和 `assets` 中的每个项目文件都存在。
- 内置浏览器预览使用工作区当前项目，关键帧两次像素摘要一致，页面没有未处理的资源或脚本错误。
- 开头、中段、结尾截图都能看到除文字以外的可见画面变化；只有标题、段落或字幕的页面不合格。
- 最终服务状态为 `completed`，回执的尺寸、时长、帧数与请求相符，产物 MIME 为 `video/webm`，并能在工作台内置浏览器中加载播放。
- 失败时保留可读报告；没有 `completed` 回执就不登记视频成品，也不向用户声称已完成。

音频、远程网络资源和需要真实用户手势的交互不属于本合同的隐式能力。若任务需要它们，必须在任务说明和失败边界中明确声明，并由宿主返回实际支持或拒绝结果。
