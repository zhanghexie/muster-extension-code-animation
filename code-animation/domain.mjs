import path from 'node:path';
import { readFile } from 'node:fs/promises';

function text(value, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('字段为空或超长');
  return value.trim();
}
function relativeHtml(value) {
  const file = text(value, 1024).replaceAll('\\', '/');
  if (!/\.html?$/i.test(file) || /[:\\\x00-\x1f]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('请填写项目内的相对 HTML 路径');
  return file;
}
function positiveInt(value, fallback, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > max) throw new Error('渲染参数必须是有效正整数');
  return n;
}
function renderConfig(value, previous) {
  const base = previous && typeof previous === 'object' ? previous : {};
  const next = {
    duration: value?.duration === undefined ? Number(base.duration ?? 12) : Number(value.duration),
    fps: value?.fps === undefined ? Number(base.fps ?? 30) : Number(value.fps),
    width: value?.width === undefined ? Number(base.width ?? 1920) : Number(value.width),
    height: value?.height === undefined ? Number(base.height ?? 1080) : Number(value.height),
    audio: value?.audio === undefined ? (typeof base.audio === 'string' && base.audio.trim() ? base.audio.trim() : null) : (value.audio ? text(value.audio, 1024).replaceAll('\\', '/') : null),
    subtitles: value?.subtitles === undefined ? (typeof base.subtitles === 'string' ? base.subtitles : '中文字幕') : text(value.subtitles, 32)
  };
  if (!Number.isFinite(next.duration) || next.duration <= 0 || next.duration > 3600) throw new Error('时长必须在 0 到 3600 秒之间');
  next.duration = Math.round(next.duration * 1000) / 1000;
  next.fps = positiveInt(next.fps, 30, 120);
  next.width = positiveInt(next.width, 1920, 3840);
  next.height = positiveInt(next.height, 1080, 3840);
  if (next.width % 2 || next.height % 2) throw new Error('画布宽高必须是偶数');
  return next;
}
function renderUpdate(value, previous) {
  if (!value || typeof value !== 'object') throw new Error('渲染状态无效');
  const status = text(value.status, 32);
  if (!['idle', 'queued', 'preparing', 'rendering', 'finalizing', 'completed', 'failed', 'cancelled'].includes(status)) throw new Error('未知渲染状态');
  const progress = value.progress === undefined ? previous?.progress ?? 0 : Number(value.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('渲染进度无效');
  const update = { status, progress, updatedAt: Date.now() };
  for (const key of ['jobId', 'assetId', 'filename', 'error']) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') update[key] = text(value[key], key === 'error' ? 2000 : 255);
  }
  if (status === 'completed' && !(update.assetId || previous?.assetId)) throw new Error('完成的渲染必须关联媒体资产');
  return {...(previous || {}), ...update};
}
export function createDomainRuntime({ broker, identity, packageRoot }) {
  const root = path.join(packageRoot, 'skills', 'code-animation-prompts');
  const listeners = new Set();
  let catalog, queue = Promise.resolve();
  async function library(context) {
    const saved = await broker('data.read', ['library.json'], context);
    return saved?.content ? JSON.parse(saved.content) : { version: 0, picks: [], works: [] };
  }
  async function styles() {
    return catalog ??= JSON.parse(await readFile(path.join(root,'references','catalog.json'), 'utf8'));
  }
  async function style(id) {
    const row = (await styles()).entries.find(row => row.id === String(id).trim().toUpperCase());
    if (!row) throw new Error('未知风格编号：'+id);
    return row;
  }
  async function apply(name,args,context) {
    const state = await library(context);
    if (name === 'picks.set') {
      const {id} = await style(args.id);
      const picks = new Set(state.picks);
      if (args.selected) picks.add(id); else picks.delete(id);
      state.picks = [...picks];
    } else {
      const id = text(args.id, 64);
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error('无效作品 ID');
      const previous = state.works.find(w => w.id === id);
      if (args.expected !== undefined && args.expected !== previous?.revision) throw new Error('作品已更新，请重新打开');
      if (!previous && !['work.save','work.attach'].includes(name)) throw new Error('找不到作品');
      const work = {...(previous || {id, styles:[], kind:'draft', favorite:false})};
      if (name === 'work.save') {
        if (previous && args.expected === undefined) throw new Error('请提供当前作品版本');
        work.title = text(args.title);
        if (!Array.isArray(args.styles)) throw new Error('风格清单无效');
        work.styles = [...new Set((await Promise.all(args.styles.map(style))).map(s=>s.id))];
        work.render = renderConfig(args.render, previous?.render);
        if (args.entryPath !== undefined) work.entryPath = relativeHtml(args.entryPath);
      } else if (name === 'work.star') {
        work.favorite = args.favorite === true;
      } else if (name === 'work.attach') {
        if (previous && args.expected === undefined) throw new Error('请提供当前作品版本');
        const filename = text(args.filename,255);
        const kind = /\.html?$/i.test(filename) ? 'html' : /\.(mp4|webm)$/i.test(filename) ? 'video' : '';
        if (!kind || !/^[a-f0-9-]{36}$/i.test(args.assetId)) throw new Error('文件类型或资产 ID 无效');
        await broker('media.retain',[args.assetId],context);
        Object.assign(work,{title:previous?.title||text(args.title),kind,filename,assetId:args.assetId});
        delete work.relativePath; delete work.taskRef;
      } else if (name === 'work.register') {
        const target = context.taskRef || context.sessionId;
        if (!target) throw new Error('需要从创作任务登记成品');
        if (work.assetId || (work.taskRef && work.taskRef !== target)) throw new Error('作品已关联其他来源，请保留原作并新建作品');
        Object.assign(work,{kind:'task',relativePath:relativeHtml(args.relativePath),taskRef:target});
        work.entryPath = work.relativePath;
        work.render = renderConfig(args.render, previous?.render);
        delete work.assetId; delete work.filename;
      } else if (name === 'work.validation') {
        if (!previous) throw new Error('找不到作品');
        const status = text(args.status, 32);
        if (!['unknown', 'checking', 'passed', 'failed'].includes(status)) throw new Error('未知验证状态');
        const frames = Array.isArray(args.frames) ? args.frames.slice(0, 8).map(value => Number(value)).filter(Number.isFinite) : [];
        const errors = Array.isArray(args.errors) ? args.errors.slice(0, 12).map(value => text(value, 500)) : [];
        work.validation = { status, frames, errors, checkedAt: Date.now() };
      } else if (name === 'work.render') {
        if (!previous) throw new Error('找不到作品');
        work.renderJob = renderUpdate(args, previous.renderJob);
      } else if (name !== 'work.remove') throw new Error('未知领域命令');
      state.works = state.works.filter(row=>row.id!==id);
      if (name !== 'work.remove') {
        work.updated = Date.now();work.revision = (previous?.revision||0)+1;
        state.works.unshift(work);
      }
    }
    state.version++;
    await broker('data.write',['library.json',JSON.stringify(state)],context);
    for(const listener of listeners) listener({...identity,type:'state.changed',actor:context.actor,requestId:context.requestId,version:state.version,payload:{}});
    return {ok:true,version:state.version,result:{}};
  }
  return {
    async getSnapshot(context) {
      await queue;
      const {version,picks,works}=await library(context);
      return {version,count:(await styles()).entries.length,installed:true,state:{picks,works:works.map(({id,title,kind,styles,revision,entryPath,relativePath,render,validation,renderJob})=>({id,title,kind,styles,revision,entryPath,relativePath,render,validation,renderJob}))},capturedAt:new Date().toISOString()};
    },
    async query(name,args,context) {
      if(name==='library'){await queue;return library(context);}
      if(name==='catalog'){const c=await styles();return {installed:true,skillRoot:root,series:c.series,entries:c.entries.map(e=>({...e,hasStill:!!e.image}))};}
      if(name==='prompt'){const e=await style(args.id);return {...e,markdown:await readFile(path.join(root,e.file),'utf8')};}
      throw new Error('未知查询');
    },
    execute(name,args,context){const task=queue.then(()=>apply(name,args,context));queue=task.catch(()=>{});return task;},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
  };
}
