---
name: code-animation-prompts
description: 按所选风格制作可编辑的代码动画并将完成的 HTML 登记到工作区作品库。
---
# 代码动画

通过 `references/catalog.json` 或 `node scripts/styles.mjs show B3` 查风格，每个编号的提示词在 `prompts/<编号>.md`。196 张参考图在 `stills/`，其余条目只有文字。素材整理者俯仰观照，封装来源 https://github.com/XiaoyeCodes/code-animation-prompts，原始许可见 `credits/`。静帧用于参考，三段交互样片由扩展实现。

提示词文件保留了来源项目的创作语境；其中出现的外部运行时、浏览器或编码器建议只当作视觉参考，不能照搬为工作台执行步骤。实现时统一服从本技能的宿主协议、内置浏览器和确定性渲染服务。

读取请求指定的风格，按主题、时长、画幅、帧率与字幕选择制作动画。模板见 `assets/starter/index.html`，完整渲染协议见 `references/rendering.md`。文案、配色和时间参数集中配置，随机数使用固定种子或由帧时间计算。先运行 `node scripts/check_render.mjs <项目内 HTML> --project-root <任务目录>`，再用工作台内置浏览器检查开头、中段和结尾关键帧。

## 工作台交付协议

1. 把 `index.html` 与它引用的全部资源放进当前创作任务的项目目录。入口和资源只能使用项目相对路径；不要把绝对路径、凭据或大段 Base64 写进作品。
2. 页面必须暴露 `window.renderAt(t)`（`t` 为秒），并在 `?export=1` 时关闭自播放循环。每一帧都从 `t` 和固定配置重新计算，不能依赖上一帧、系统时钟或未播种的随机数。页面必须包含 `render-contract` 元数据，列出 `duration`、`fps`、`width`、`height`、`seed`、`keyframes` 和项目资源。
3. 通过 `ma.tasks.preview(taskRef, relativePath)` 或 `ma.exports.preview(exportId, fileName)` 在工作台右侧内置浏览器打开页面。内置浏览器用于实时预览、资源检查和关键帧人工验收；不要启动另一个浏览器替代工作台页面。
4. 预览通过后，把入口、资源清单、视口和关键帧交给 `host.tasks.render`。先调用 `validate`，再用 `preview` 采样关键帧，最后用 `start` 提交完整时间点（或 `durationMs` + `fps`）；用 `status` 查询、用 `cancel` 取消。该服务按 `renderAt(frame / fps)` 逐帧驱动页面，在 Node/WebCodecs 中编码 VP8 并封装 WebM；最终渲染不是实时录屏，也不能用一次截图或浏览器录屏任务冒充。
5. 任务状态必须走完 `preparing → rendering → finalizing → completed`。只有 `completed` 且回执包含可访问的 `video/webm` 产物、实际帧数和尺寸时才算渲染完成；`failed` 或 `cancelled` 必须保留失败原因、阶段、关键帧时间和资源检查结果。
6. 交付前对至少三个关键帧（开头、中段、结尾）各采样两次并比较像素摘要，确认同一个 `t` 可重复得到同一画面；逐帧查看截图，确认画面有几何、图像、视频或其他可见运动，不接受只有标题和段落的文字稿。

完成后用扩展领域命令 `work.register` 提交请求中的作品 ID 和项目相对 HTML 入口路径；后续修改沿用该作品 ID。视频或其他导入文件先通过宿主媒体资产接口保留，再登记对应作品。只有实际生成并验收的产物才登记。
