'use strict';
const $=id=>document.getElementById(id);
function el(tag,cls='',value=''){const node=document.createElement(tag);node.className=cls;if(value)node.textContent=value;return node;}
function button(label,fn,cls=''){const b=el('button',cls,label);b.type='button';b.onclick=async event=>{try{await fn(event);}catch(error){notify(error.message||String(error));}};return b;}
let CATALOG, entries, lookup, ranked;
const STILLS=Object.create(null);
const PREVIEWS=Object.create(null);
// Preview metadata is kept separate from the source/object-URL cache.  The
// manifest loader only records the small type marker here; generated images
// continue to use PREVIEWS unchanged.
const PREVIEW_TYPES=Object.create(null);
const PREVIEW_MOTIONS=Object.create(null);
const PREVIEW_ROOT='../skills/code-animation-prompts/assets/generated-previews/';
const PREVIEW_CACHE_LIMIT=32;
const previewCache=new Map();
const seriesNames={AG:'代码样片',M:'动态',K:'卡通',Z:'中国风',H:'版式',L:'Lemo',V:'mg-styles',X:'code-video',R:'视觉参考',O:'奥斯卡'};
const featured=['B3','Z5','R1','C1','H1','A3','B1','R5','K3','M1','B2','A1','O1','A2'];
let picks=new Set();
const demos={B3:'#ffba64',B1:'#8edbf6',A1:'#cdb5f6'};
let series='',medium='',workFilter='',works=[],raf=0,statusTimer,returnFocus,previewGeneration=0;
let libraryVersion=-1;
const MOTION_PREVIEW_DURATION=1.8;
const MOTION_PREVIEW_SIZE=[320,160];
const MOTION_PALETTE={AG:'#8edbf6',M:'#cdb5f6',K:'#f79ab1',Z:'#e6b36d',H:'#90b8e9',L:'#ef9b63',V:'#b963ed',X:'#57d6cf',R:'#e2b576',O:'#d28b4c'};
const motionPlayers=new Map();
let motionPreviewRaf=0,motionPreviewLast=0,motionPreviewObserver;
async function refresh(){
  const state=await ma.agent.domain.query('library');
  if(state.version<=libraryVersion)return;
  libraryVersion=state.version;picks=new Set(state.picks);works=state.works;
  renderStyles();renderWorks();
}
async function command(name,args){const result=await ma.agent.domain.command(name,args);if(result?.ok===false)throw Error(result.message||result.error||'操作未完成');await refresh();}
function notify(msg){($('dialog').open?$('dialogBody'):document.body).append($('status'));$('status').textContent=msg;$('status').hidden=false;clearTimeout(statusTimer);statusTimer=setTimeout(()=>$('status').hidden=true,2400);}
function cleanPreview(){previewGeneration++;cancelAnimationFrame(raf);}
function modal(title,sub){document.body.append($('status'));cleanPreview();if(!$('dialog').open)returnFocus=document.activeElement;$('dialogTitle').textContent=title;$('eyebrow').textContent=sub;$('dialogBody').replaceChildren();if(!$('dialog').open)$('dialog').showModal();$('dialog').scrollTop=0;$('dialog').querySelector('.dialogCard')?.scrollTo?.(0,0);return $('dialogBody');}
function closeModal(){if($('dialog').open)$('dialog').close();}
$('close').onclick=closeModal;$('dialog').addEventListener('close',()=>{document.body.append($('status'));cleanPreview();$('dialogBody').replaceChildren();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});});
$('dialog').onclick=e=>{if(e.target===$('dialog'))closeModal();};
function chips(parent,items,active,select){const container=$(parent);container.replaceChildren();for(const [key,label,count] of items){const b=button(label,()=>select(key),key===active?'active':'');b.setAttribute('aria-pressed',String(key===active));if(count!==undefined)b.append(' ',el('i','',String(count)));container.append(b);}}
async function togglePick(id){await command('picks.set',{id,selected:!picks.has(id)});}
function safePreviewSource(value){
  if(typeof value==='object'&&value)value=value.src||value.path||value.file||value.url;
  if(typeof value!=='string'||!value.trim())return '';
  const source=value.trim().replaceAll('\\','/');
  if(/^(?:[a-z]+:|\\\\|\/)/i.test(source)||source.split('/').some(part=>!part||part==='.'||part==='..'))return '';
  if(source.startsWith('generated-previews/'))return '../skills/code-animation-prompts/assets/'+source;
  if(source.startsWith('assets/generated-previews/'))return '../skills/code-animation-prompts/'+source;
  return PREVIEW_ROOT+source;
}
function previewCachePut(key,url){
  const previous=previewCache.get(key);
  if(previous?.url===url)return;
  if(previous?.url&&previous.url!==key)URL.revokeObjectURL?.(previous.url);
  previewCache.set(key,{url});
  while(previewCache.size>PREVIEW_CACHE_LIMIT){
    const first=previewCache.entries().next().value;
    if(!first)break;
    previewCache.delete(first[0]);
    if(first[1]?.url&&first[1].url!==first[0])URL.revokeObjectURL?.(first[1].url);
  }
}
function loadPreview(source){
  if(!source)return Promise.reject(new Error('预览素材路径为空'));
  const cached=previewCache.get(source);
  if(cached?.url)return Promise.resolve(cached.url);
  if(cached?.pending)return cached.pending;
  if(typeof fetch!=='function'||typeof URL?.createObjectURL!=='function')return Promise.resolve(source);
  const pending=(async()=>{
    const response=await fetch(source,{cache:'no-store'});
    if(!response.ok)throw new Error('无法读取预览素材');
    const blob=await response.blob();
    // Development package hosts may serve unknown extensions as octet-stream;
    // give SVG previews an image MIME before creating the object URL.
    const imageBlob=/\.svg(?:$|[?#])/i.test(source)&&(!blob.type||blob.type==='application/octet-stream')
      ?new Blob([blob],{type:'image/svg+xml'})
      :blob;
    const url=URL.createObjectURL(imageBlob);
    previewCachePut(source,url);
    return url;
  })();
  previewCache.set(source,{pending});
  return pending.catch(error=>{if(previewCache.get(source)?.pending===pending)previewCache.delete(source);throw error;});
}
function showPreview(img,source,fallback){
  if(!source){if(fallback)img.src=fallback;return;}
  // Keep the still visible while a no-store extension resource is fetched. The
  // object URL then makes repeat opens and shortlist/detail transitions local.
  img.src=fallback||source;
  loadPreview(source).then(url=>{if(img.isConnected)img.src=url;}).catch(()=>{if(img.isConnected&&fallback)img.src=fallback;});
}
function previewTypeValue(entry){
  const value=entry?.previewType??entry?.type??entry?.kind??entry?.preview?.type;
  if(entry?.motion===true||entry?.previewMotion===true)return 'motion';
  if(typeof value==='string'&&value.trim().toLowerCase()==='motion')return 'motion';
  return typeof value==='string'&&value.trim()?value.trim().toLowerCase():'static';
}
function hasMotionPreview(style){
  if(!style||typeof style.id!=='string')return false;
  const id=style.id.toUpperCase();
  return PREVIEW_TYPES[id]==='motion'||PREVIEW_MOTIONS[id]===true||Boolean(PREVIEW_MOTIONS[id])||previewTypeValue(style)==='motion';
}
function motionPreviewColor(style){
  const known=MOTION_PALETTE[String(style?.series||'').toUpperCase()];
  if(known)return known;
  const id=String(style?.id||'A1');let hash=0;for(const char of id)hash=(hash*31+char.charCodeAt(0))>>>0;
  return ['#8edbf6','#ffba64','#cdb5f6','#bafa91','#f79ab1','#57d6cf'][hash%6];
}
function motionPreviewWord(style){
  const value=style?.tags?.find(Boolean)||style?.name||style?.id||'动映';
  return String(value).replace(/\s+/g,'').slice(0,4)||String(style?.id||'动映');
}
function motionReduced(){
  try{return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);}catch{return false;}
}
function drawMotionPreview(player,time){
  const style=player.style,canvas=player.canvas;
  const motion=typeof Motion!=='undefined'?Motion:globalThis.Motion;if(!motion)return;
  const options={id:style.id,time,motif:player.motif,color:player.color,word:player.word};
  if(typeof motion.drawPreview==='function')motion.drawPreview(canvas,options);
  else if(typeof motion.draw==='function')motion.draw(canvas,style.id,time,player.color,player.word,true);
  canvas.dataset.motionTime=String(Number(time.toFixed(3)));
}
function generatedPreviewCanvas(style,detail=false){
  const canvas=el('canvas',detail?'preview generated-preview':'generated-preview');
  canvas.width=320;canvas.height=160;canvas.dataset.generatedPreview='true';
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',style.name+' 生成预览');
  const motion=typeof Motion!=='undefined'?Motion:globalThis.Motion;
  motion?.drawPreview?.(canvas,{id:style.id,time:0,motif:style.motif,color:motionPreviewColor(style),word:motionPreviewWord(style)});
  return canvas;
}
function startMotionPreviewLoop(){
  if(motionPreviewRaf||motionReduced()||typeof requestAnimationFrame!=='function')return;
  motionPreviewLast=typeof performance?.now==='function'?performance.now():Date.now();
  const frame=now=>{
    motionPreviewRaf=0;
    let active=0;
    const current=Number(now)||Date.now();
    const delta=Math.min(.12,Math.max(0,(current-motionPreviewLast)/1000));motionPreviewLast=current;
    for(const [canvas,player] of motionPlayers){
      if(!canvas.isConnected){motionPlayers.delete(canvas);motionPreviewObserver?.unobserve(canvas);continue;}
      if(!player.active||motionReduced())continue;
      active+=1;player.time=(player.time+delta)%MOTION_PREVIEW_DURATION;drawMotionPreview(player,player.time);
    }
    if(active)motionPreviewRaf=requestAnimationFrame(frame);
  };
  motionPreviewRaf=requestAnimationFrame(frame);
}
function replayMotionPreview(canvas){
  const player=motionPlayers.get(canvas);if(!player)return;
  player.time=0;player.active=true;drawMotionPreview(player,0);startMotionPreviewLoop();
}
function mountMotionPreview(canvas,style,detail=false){
  canvas.width=MOTION_PREVIEW_SIZE[0];canvas.height=MOTION_PREVIEW_SIZE[1];
  canvas.dataset.motionPreview='true';canvas.dataset.motionDuration=String(MOTION_PREVIEW_DURATION);
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',style.name+' 动效预览');
  const metadata=PREVIEW_MOTIONS[String(style.id).toUpperCase()];
  const player={canvas,style,detail,motif:metadata?.motif||style.motif,color:motionPreviewColor(style),word:motionPreviewWord(style),time:0,active:true};
  motionPlayers.set(canvas,player);drawMotionPreview(player,0);
  if(!motionReduced()&&typeof IntersectionObserver==='function'){
    motionPreviewObserver??=new IntersectionObserver(records=>{for(const record of records){const current=motionPlayers.get(record.target);if(current)current.active=record.isIntersecting;}});
    motionPreviewObserver.observe(canvas);
  }
  startMotionPreviewLoop();
  return player;
}
function motionCanvas(style,detail=false){
  const canvas=el('canvas',detail?'preview motion-preview':'motion-preview');
  mountMotionPreview(canvas,style,detail);return canvas;
}
async function loadPreviewManifest(){
  const manifestUrl=PREVIEW_ROOT+'manifest.json';
  try{
    if(typeof fetch!=='function')return;
    const response=await fetch(manifestUrl,{cache:'no-store'});
    if(!response.ok)return;
    const manifest=await response.json();
    const raw=Array.isArray(manifest?.entries)?manifest.entries:Object.entries(manifest?.entries||{}).map(([id,value])=>({id,...(value||{})}));
    for(const entry of raw){
      if(!entry||typeof entry.id!=='string')continue;
      const id=entry.id.trim().toUpperCase();
      const source=safePreviewSource(entry.src||entry.file||entry.path);
      if(!/^[A-Z][A-Z0-9]*$/.test(id))continue;
      PREVIEW_TYPES[id]=previewTypeValue(entry);
      if(PREVIEW_TYPES[id]==='motion')PREVIEW_MOTIONS[id]=entry;
      if(source)PREVIEWS[id]=source;
    }
  }catch(error){ console.warn('[code-animation] preview manifest unavailable',error); }
}
function still(s){const c=el('div','cover');const source=STILLS[s.id]||PREVIEWS[s.id];if(hasMotionPreview(s)&&!STILLS[s.id])c.append(motionCanvas(s));
  else if(source){const im=el('img');im.alt=s.name+(STILLS[s.id]?'参考图':'预览图');im.loading='lazy';im.decoding='async';if(!STILLS[s.id]&&PREVIEWS[s.id])im.onerror=()=>{if(im.dataset.previewFallback)return;im.dataset.previewFallback='1';im.replaceWith(generatedPreviewCanvas(s));};im.src=source;c.append(im);}
  else if(PREVIEWS[s.id])c.append(generatedPreviewCanvas(s));
  else{c.classList.add('text');c.append(el('span','',s.description||s.fit||s.name),el('small','type light','文字参考'));}return c;}
function info(id,title,subtitle){const box=el('div','info'),row=el('div','cardTitle');if(id)row.append(el('small','code',id));row.append(el('strong','',title));box.append(row,el('p','',subtitle));return box;}
function styleTile(s){
  const card=el('article','tile'+(picks.has(s.id)?' selected':'')),open=button('',()=>styleDetail(s),'tileOpen');card.dataset.style=s.id;open.setAttribute('aria-label','查看 '+s.id+' '+s.name);
  const cover=still(s);if(demos[s.id])cover.append(el('span','type','▶ 样片'));else if(hasMotionPreview(s)&&!STILLS[s.id])cover.append(el('span','type','▶ 1.8 秒动效'));else if(PREVIEWS[s.id]&&!STILLS[s.id])cover.append(el('span','type',PREVIEW_TYPES[s.id]==='image'?'生图预览':'生成预览'));open.append(cover,info(s.id,s.name,s.fit||s.description));
  const check=button(picks.has(s.id)?'✓':'＋',()=>togglePick(s.id),'check');check.setAttribute('aria-label',(picks.has(s.id)?'取消选择 ':'选择 ')+s.id);check.setAttribute('aria-pressed',String(picks.has(s.id)));card.append(open,check);return card;
}
function renderStyles(){
  chips('series',[['','全部系列',entries.length],...CATALOG.series.map(s=>[s.id,seriesNames[s.id],s.count])],series,k=>{series=k;renderStyles();});
  chips('media',[['','全部素材'],['still','原始静帧'],['generated','生成预览'],['text','文字参考'],['motion','可播样片'],['picked','只看已选']],medium,k=>{medium=k;renderStyles();});
  const terms=$('search').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows=ranked.filter(s=>(!series||s.series===series)&&(!medium||(medium==='still'?!!STILLS[s.id]:medium==='generated'?!!PREVIEWS[s.id]:medium==='text'?!STILLS[s.id]:medium==='motion'?(!!demos[s.id]||hasMotionPreview(s)):picks.has(s.id)))&&terms.every(t=>[s.id,s.name,s.category,s.fit,s.description,...s.tags,seriesNames[s.series]].join(' ').toLowerCase().includes(t)));
  $('matches').textContent=rows.length+' / '+entries.length;$('pickCount').textContent=picks.size;
  const grid=$('stylesGrid');
  const focusedButton=document.activeElement?.closest('#stylesGrid .tile button');
  const focusedId=focusedButton?.closest('.tile')?.dataset.style;
  grid.replaceChildren();
  if(!rows.length){grid.append(empty('没有匹配的风格','可以换个关键词，或清除当前筛选。',[button('清除筛选',()=>{series=medium='';$('search').value='';renderStyles();})]));return;}
  const fragment=document.createDocumentFragment();
  let replacement;
  for(const style of rows){
    const tile=styleTile(style);
    if(style.id===focusedId)replacement=tile.querySelector(focusedButton.classList.contains('check')?'.check':'.tileOpen');
    fragment.append(tile);
  }
  grid.append(fragment);
  replacement?.focus({preventScroll:true});
}
function empty(title,desc,actions){const b=el('div','empty');b.append(el('h3','',title),el('p','',desc),...actions);return b;}
function actionRow(...buttons){const r=el('div','dialogActions');r.append(...buttons);return r;}
function sample(canvas,id,word='家',color=demos[id]){let t=1,last=performance.now(),playing=true;const controls=el('div','dialogActions');const play=button('暂停',()=>{playing=!playing;play.textContent=playing?'暂停':'播放';});
 const seek=el('input');seek.type='range';seek.min=0;seek.max=12;seek.step=.02;seek.setAttribute('aria-label','播放进度');seek.oninput=()=>{t=Number(seek.value);playing=false;play.textContent='播放';};controls.append(play,seek);canvas.after(controls);
 function frame(now){if(!canvas.isConnected)return;if(playing&&!document.hidden)t=(t+Math.min(.12,(now-last)/1000))%12;last=now;seek.value=t;Motion.draw(canvas,id,t,color,word);raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);}
async function fullPrompt(ids){const rows=await Promise.all(ids.map(id=>ma.agent.domain.query('prompt',{id})));return rows.map(r=>r.markdown).join('\n\n——\n\n');}
async function copyText(text){text=await text;try{await navigator.clipboard.writeText(text);notify('已复制提示词');}catch{const body=modal('复制提示词','手动复制');const field=el('textarea');field.value=text;field.style.cssText='width:100%;height:45vh';body.append(field);field.focus();field.select();}}
function styleDetail(s){const body=modal(s.name,s.id+'  /  '+seriesNames[s.series]);
 const motion=hasMotionPreview(s)&&!STILLS[s.id];
 let motionView;
 if(motion){motionView=motionCanvas(s,true);body.append(motionView);}
 else if(STILLS[s.id]||PREVIEWS[s.id]){const img=el('img','bigImage');img.alt=s.name;if(PREVIEWS[s.id])img.onerror=()=>{if(img.dataset.previewFallback)return;img.dataset.previewFallback='1';img.replaceWith(generatedPreviewCanvas(s,true));};showPreview(img,PREVIEWS[s.id],STILLS[s.id]);body.append(img);}
 body.append(el('p','',s.description),el('p','labels',[s.fit,...s.tags].filter(Boolean).join('　·　')));
 const row=actionRow(button(picks.has(s.id)?'移出清单':'加入清单',async()=>{await togglePick(s.id);styleDetail(s);}),button('复制提示词',()=>copyText(fullPrompt([s.id]))),button('以此风格建作品',()=>workForm(null,[s.id]),'action'));body.append(row);
 if(demos[s.id])row.prepend(button('▶ 播放演示',()=>{const c=el('canvas','preview');body.querySelector('img')?.replaceWith(c);sample(c,s.id);row.firstElementChild.remove();}));
 if(motion&&motionView)row.prepend(button('↻ 重播 1.8 秒',()=>replayMotionPreview(motionView)));
 const d=el('details');d.append(el('summary','','查看完整提示词'),el('pre','','加载中…'));d.ontoggle=async()=>{if(!d.open)return;try{d.lastChild.textContent=await fullPrompt([s.id]);}catch(e){d.lastChild.textContent=e.message;}};body.append(d);}
function shortlist(){const body=modal('已选清单','风格对照 · '+picks.size+' 项');if(!picks.size){body.append(empty('还没有选中风格','点击风格卡右上角的加号即可加入清单。',[button('去挑选',closeModal)]));return;}
 const actions=actionRow(button('新建作品',()=>workForm(null,[...picks]),'action'),button('复制所选提示词',()=>copyText(fullPrompt([...picks]))));body.append(actions);
 const grid=el('div','compare');for(const id of picks){const s=lookup.get(id),card=el('div','compareItem');card.append(still(s),info(id,s.name,s.fit),button('移出',async()=>{await togglePick(id);shortlist();}));grid.append(card);}body.append(grid);}
$('search').oninput=renderStyles;$('shortlist').onclick=shortlist;

const kindNames={draft:'待制作',html:'HTML',video:'视频',task:'项目作品'};
const renderTabs=new Map();
const renderStatusNames={idle:'未渲染',queued:'排队中',preparing:'准备中',rendering:'渲染中',finalizing:'编码中',completed:'已完成',failed:'失败',cancelled:'已取消'};
function nowWork(title,styles,kind='draft'){return {id:crypto.randomUUID(),title,styles:[...styles],kind,updated:Date.now(),favorite:false};}
function formatDate(n){return new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(n);}
function workCover(w){
 const b=el('div','cover');
 if(['task','html','video'].includes(w.kind)){
   const host=el('div','workPoster',kindNames[w.kind]);
   b.append(host);coverJobs.set(host,w);observer.observe(host);
 }
 else if(w.poster){const img=el('img');img.src=w.poster;img.alt=w.title+'封面';b.append(img);}
  else if(w.kind==='draft'&&(STILLS[w.styles[0]]||PREVIEWS[w.styles[0]])){const img=el('img');img.src=STILLS[w.styles[0]]||PREVIEWS[w.styles[0]];img.alt='关联风格参考图';b.append(img);}
 else b.append(el('div','workPoster',w.kind==='html'?'〈 HTML 〉':w.kind==='video'?'▷ 视频':'待制作'));
  b.append(el('span','type',w.kind==='draft'&&(STILLS[w.styles[0]]||PREVIEWS[w.styles[0]])?'待制作 · 风格参考':kindNames[w.kind]));return b;
}
function renderWorks(){
 observer.disconnect();
 $('workTotal').textContent=works.length;
 chips('workFilters',[['','全部作品'],['favorite','已收藏'],['draft','待制作'],['ready','可预览']],workFilter,k=>{workFilter=k;renderWorks();});
 const q=$('workSearch').value.trim().toLowerCase();
 const list=works.filter(w=>(!workFilter||(workFilter==='favorite'?w.favorite:workFilter==='draft'?w.kind==='draft':w.kind!=='draft'))&&[w.title,w.filename,...w.styles.map(id=>id+' '+(lookup.get(id)?.name||''))].join(' ').toLowerCase().includes(q)).sort((a,b)=>$('order').value==='title'?a.title.localeCompare(b.title,'zh-CN'):b.updated-a.updated);
 const grid=$('workGrid');grid.replaceChildren();
 if(!list.length){grid.append(works.length?empty('没有匹配的作品','换个名称、风格或筛选条件。',[button('重置筛选',()=>{workFilter='';$('workSearch').value='';renderWorks();})]):empty('建立你的作品库','导入已有动画，或把挑中的风格保存成待制作作品。',[button('导入 HTML / 视频',()=>pickFile(null),'action'),button('去挑选风格',()=>setPage('styles'))]));return;}
 for(const w of list){const card=el('article','workCard'),open=button('',()=>workDetail(w.id),'workOpen');open.setAttribute('aria-label','打开作品 '+w.title);
 open.append(workCover(w),info('',w.title,(w.styles.join(' + ')||kindNames[w.kind])+'　·　'+formatDate(w.updated)));
 const star=button(w.favorite?'★':'☆',async()=>{await command('work.star',{id:w.id,favorite:!w.favorite});},'favorite');star.setAttribute('aria-label',(w.favorite?'取消收藏 ':'收藏 ')+w.title);star.setAttribute('aria-pressed',String(!!w.favorite));card.append(open,star);grid.append(card);}
}
async function previewWork(w){
 if(w.kind!=='task')throw Error('只有项目作品可以在内置浏览器中预览');
 const result=await ma.tasks.preview(w.taskRef,w.relativePath);
 if(result?.tabId)renderTabs.set(w.id,result.tabId);
 return result;
}
async function renderTool(w,action,extra={}){
 if(w.kind!=='task'||!w.taskRef||!w.relativePath)throw Error('请先登记项目 HTML 成品');
 let tabId=renderTabs.get(w.id);
 if(!tabId){const opened=await previewWork(w);tabId=opened?.tabId||renderTabs.get(w.id);}
 if(!tabId)throw Error('内置浏览器标签未就绪，请先预览作品');
 return ma.tasks.render({action,tabId,width:w.render?.width,height:w.render?.height,durationMs:Math.round((w.render?.duration||12)*1000),fps:w.render?.fps||30,...extra});
}
async function validateWork(w){
 await command('work.validation',{id:w.id,status:'checking',frames:[],errors:[],expected:w.revision});
 try{
  const frames=[0,Math.max(0,(w.render?.duration||12)/2),Math.max(0,(w.render?.duration||12)-0.001)];
  const result=await renderTool(w,'validate',{times:frames.map(time=>Math.round(time*1000))});
  if(result?.validation?.frames?.some(frame=>frame.consistent===false))throw Error('关键帧重复渲染结果不一致');
  await command('work.validation',{id:w.id,status:'passed',frames,errors:[]});
  notify('关键帧验证通过');
 }catch(error){
  await command('work.validation',{id:w.id,status:'failed',frames:[],errors:[error.message||String(error)]}).catch(()=>{});
  throw error;
 }
}
async function renderWork(w){
 if(w.validation?.status!=='passed')throw Error('请先完成关键帧验证，再渲染 WebM');
 const started=await renderTool(w,'start');let render=started?.render;
 if(!render?.id)throw Error('宿主没有返回渲染任务');
 await command('work.render',{id:w.id,status:'queued',progress:0,jobId:render.id,expected:w.revision});
 for(let i=0;i<600;i++){
  if(['completed','failed','cancelled'].includes(render.status))break;
  await new Promise(resolve=>setTimeout(resolve,150));
  const status=await ma.tasks.render({action:'status',renderId:render.id});render=status?.render||render;
  const current=works.find(item=>item.id===w.id)||w;
  await command('work.render',{id:w.id,status:render.status==='preparing'?'queued':render.status,progress:render.totalFrames?Math.min(1,(render.frameCount||0)/render.totalFrames):0,jobId:render.id,error:render.error,expected:current.revision}).catch(()=>{});
 }
 if(render.status!=='completed')throw Error(render.error||'渲染未完成');
 const artifact=render.artifact;if(!artifact?.path)throw Error('渲染完成但没有返回 WebM 产物');
 const asset=await ma.media.import(artifact.path,'render.webm','video/webm');
 const current=works.find(item=>item.id===w.id)||w;
 await command('work.render',{id:w.id,status:'completed',progress:1,jobId:render.id,assetId:asset.assetId,filename:'render.webm',expected:current.revision});
 notify('WebM 渲染完成');
}
function workForm(w,ids){
 const body=modal(w?'编辑作品资料':'新建作品','我的作品');const form=el('form','form');
 const title=el('input');title.type='text';title.required=true;title.maxLength=90;title.value=w?.title||'';title.placeholder='给作品起个名字';title.id='workName';
 const titleLabel=el('label','','作品名称');titleLabel.htmlFor=title.id;
 const field=el('input');field.type='text';field.id='relatedStyles';field.value=ids.join('、');field.placeholder='例如 B3、C1';const label=el('label','','关联风格编号');label.htmlFor=field.id;
  const render=w?.render||{};
  const duration=el('input');duration.type='number';duration.min='0.1';duration.max='3600';duration.step='0.1';duration.value=String(render.duration??12);duration.id='work-duration';
  const fps=el('select');[['24','24 fps'],['30','30 fps'],['60','60 fps']].forEach(([value,label])=>fps.add(new Option(label,value)));fps.value=String(render.fps??30);fps.id='work-fps';
  const width=el('input');width.type='number';width.min='2';width.max='3840';width.step='2';width.value=String(render.width??1920);width.id='work-width';
  const height=el('input');height.type='number';height.min='2';height.max='3840';height.step='2';height.value=String(render.height??1080);height.id='work-height';
  const renderGrid=el('div','renderGrid');
  for(const [labelText,input] of [['时长（秒）',duration],['帧率',fps],['宽度',width],['高度',height]]){const wrap=el('label','renderField');wrap.append(el('span','',labelText),input);renderGrid.append(wrap);}
  const renderHint=el('p','labels','动画项目会使用这些参数做关键帧检查和 WebM 渲染。');
  const submit=el('button','action',w?'保存资料':'建立作品');submit.type='button';submit.onclick=()=>form.requestSubmit();form.append(titleLabel,title,label,field,renderHint,renderGrid,submit);
 form.onsubmit=async e=>{e.preventDefault();const styles=[...new Set(field.value.trim().toUpperCase().split(/[、，,\s+]+/).filter(Boolean))];const missing=styles.find(id=>!lookup.has(id));if(missing){field.setCustomValidity('未找到风格 '+missing);field.reportValidity();return;}if(!title.value.trim()){title.setCustomValidity('请输入作品名');title.reportValidity();return;}submit.disabled=true;
 try{const item=w?{...w,title:title.value.trim(),styles,updated:Date.now()}:nowWork(title.value.trim(),styles);const render={duration:Number(duration.value),fps:Number(fps.value),width:Number(width.value),height:Number(height.value),subtitles:'中文字幕',audio:null};await command('work.save',{id:item.id,title:item.title,styles:item.styles,render,...(w?{expected:w.revision}:{})});setPage('works');workDetail(item.id);}catch(e){submit.disabled=false;msg(body,e);}};
 title.oninput=()=>title.setCustomValidity('');field.oninput=()=>field.setCustomValidity('');body.append(form);title.focus();}
function msg(parent,error){parent.append(el('p','labels','操作失败：'+(error?.message||error)));}
async function workDetail(id){
 const w=works.find(record=>record.id===id);if(!w)return;
 const body=modal(w.title,'我的作品  /  '+kindNames[w.kind]);const gen=previewGeneration;
 if(w.kind==='draft')body.append(empty('待制作','这件作品已保存风格清单。制作完成后，把 HTML 或视频关联到这里。',[]));
 if(w.kind==='task'){const img=el('img','bigImage');img.alt='项目作品预览';body.append(img);thumbnailTask(img,w);}
 if(w.kind==='video'){try{const asset=await ma.media.url(w.assetId);if(gen!==previewGeneration)return;const video=el('video','preview');video.controls=true;video.src=asset.url;body.append(video);}catch(e){msg(body,e);}}
 if(w.kind==='html')body.append(el('p','labels','单文件 HTML 可在工作台的浏览器中打开。'));
 body.append(el('p','labels',[w.filename,w.styles.map(id=>id+' '+lookup.get(id)?.name).join('　/　')].filter(Boolean).join('　·　')||'尚未关联风格'));
 if(w.render)body.append(el('p','labels',`渲染：${w.render.width}×${w.render.height} · ${w.render.fps} fps · ${w.render.duration}s　｜　验证：${w.validation?({unknown:'未验证',checking:'检查中',passed:'已通过',failed:'失败'}[w.validation.status]||w.validation.status):'未验证'}　｜　导出：${renderStatusNames[w.renderJob?.status||'idle']||'未渲染'}${w.renderJob?.progress!==undefined?' '+Math.round(w.renderJob.progress*100)+'%':''}`));
 const actions=actionRow(button('编辑资料',()=>workForm(w,w.styles)),button(w.kind==='draft'?'关联作品文件':'替换作品文件',()=>pickFile(w.id)),button(w.favorite?'取消收藏':'收藏',async()=>{await command('work.star',{id:w.id,favorite:!w.favorite});workDetail(w.id);}));
 if(w.styles.length)actions.append(button('复制关联提示词',()=>copyText(fullPrompt(w.styles))));
 if(w.kind==='task')actions.prepend(button('预览作品',()=>previewWork(w),'action'),button('验证关键帧',async()=>{await validateWork(w);workDetail(w.id);}),button('渲染 WebM',async()=>{await renderWork(w);workDetail(w.id);}),button('继续制作',()=>ma.tasks.open(w.taskRef)));
 if(w.kind==='draft')actions.prepend(button('新建制作任务',()=>taskForm(w),'action'));
 if(w.kind==='html')actions.prepend(button('预览 HTML',()=>exportAsset(w,true),'action'));
 if(w.assetId)actions.append(button('导出文件',()=>exportAsset(w,false)));
 actions.append(button('从作品库移除',async()=>{
   const yes=await ma.ui.confirm({title:'移除「'+w.title+'」？',detail:'移除作品记录和导入副本，磁盘上的原文件保留。',confirmLabel:'移除',danger:true});
   if(!yes)return;await command('work.remove',{id:w.id,expected:w.revision});closeModal();if(w.assetId)await ma.media.release(w.assetId);
 }));body.append(actions);
}
$('importWork').onclick=()=>pickFile(null);$('newWork').onclick=()=>workForm(null,[]);$('workSearch').oninput=renderWorks;$('order').onchange=renderWorks;
function setPage(target){
  const isWork=target==='works';
  $('stylesPage').hidden=isWork;
  $('worksPage').hidden=!isWork;
  for(const [id,active] of [['stylesNav',!isWork],['worksNav',isWork]]){
    const tab=$(id);
    tab.classList.toggle('active',active);
    if(active)tab.setAttribute('aria-current','page');
    else tab.removeAttribute('aria-current');
  }
  if(isWork)renderWorks();
}
$('stylesNav').onclick=()=>setPage('styles');$('worksNav').onclick=()=>setPage('works');
const coverJobs=new WeakMap();
const observer=new IntersectionObserver(entries=>{
 for(const {target,isIntersecting} of entries)if(isIntersecting){observer.unobserve(target);const w=coverJobs.get(target);loadCover(target,w).catch(error=>{target.title=error.message;});}
});
const thumbnails = new Map();
async function loadCover(target,w){
 if(w.kind==='video'){const asset=await ma.media.url(w.assetId);if(!target.isConnected)return;
   const video=el('video');video.preload='metadata';video.muted=true;video.src=asset.url;target.replaceChildren(video);return;}
 const img=el('img');img.alt=w.title+'封面';target.replaceChildren(img);
 await thumbnailTask(img,w);
}
async function thumbnailTask(img, work) {
  const key = JSON.stringify([work.id,work.assetId,work.taskRef,work.relativePath,work.revision]);
  try {
    if (!thumbnails.has(key)) {
      if(thumbnails.size>40) thumbnails.delete(thumbnails.keys().next().value);
      const capture = work.kind==='task' ? ma.tasks.thumbnail(work.taskRef,work.relativePath) : (async()=>{
        const asset=await ma.media.url(work.assetId);
        if(asset.size>1024*1024)throw Error('HTML 较大，请打开原作预览');
        const response=await fetch(asset.url);if(!response.ok)throw Error('无法读取 HTML');
        return ma.exports.thumbnailHtml(await response.text());
      })();
      thumbnails.set(key,capture);
    }
    const result=await thumbnails.get(key);
    if(img.isConnected) img.src=result.dataUrl;
  } catch(error) { thumbnails.delete(key);img.alt='暂无封面';img.title=error.message; }
}
async function pickFile(id) {
  const target = works.find(w=>w.id===id);
  const [file] = await ma.files.pick();
  if(!file)return;
  const filename=file.split(/[\\/]/).pop();
  const suffix=filename.split('.').pop().toLowerCase();
  const mime={html:'application/octet-stream',htm:'application/octet-stream',mp4:'video/mp4',webm:'video/webm'}[suffix];
  if(!mime)throw new Error('请选择单文件 HTML、MP4 或 WebM');
  const workId=id||crypto.randomUUID();
  let asset;
  try {
    asset=await ma.media.import(file,'animation.'+suffix,mime);
    await command('work.attach',{id:workId,title:filename.replace(/\.[^.]+$/,'').slice(0,120)||'动画',filename,assetId:asset.assetId,...(target?{expected:target.revision}:{})});
  } catch(error) {
    if(asset?.assetId)await ma.media.release(asset.assetId).catch(()=>{});
    throw error;
  }
  if(target?.assetId)await ma.media.release(target.assetId);
  workFilter='';$('workSearch').value='';setPage('works');await workDetail(workId);
}
async function exportAsset(w,preview) {
  const name='animation.'+w.filename.split('.').pop().toLowerCase();
  const {exportId}=await ma.exports.create([{name,assetId:w.assetId}],w.title);
  if(preview)await ma.exports.preview(exportId,name);
  else await ma.exports.reveal(exportId);
}
function taskForm(work) {
  const body=modal('新建制作任务',work.title);
  const form=el('div','form');
  function input(label,value,choices) {
    const c=el(choices?'select':'input');if(!choices)c.type='text';
    for(const option of choices||[])c.add(new Option(option,option));
    c.value=value;c.id='task-'+form.children.length;
    const l=el('label','',label);l.htmlFor=c.id;form.append(l,c);return c;
  }
  const theme=input('主题',work.title);
  const duration=input('时长（秒）','12');duration.type='number';duration.min='1';duration.max='3600';
  const aspect=input('画幅','16:9',['16:9','9:16','1:1']);
  const fps=input('帧率','30',['24','30','60']);
  const audio=input('声音','无声',['无声','稍后提供音频']);
  const subs=input('字幕','中文字幕',['中文字幕','无字幕']);
  const extra=input('补充要求','');const title=input('任务名称',work.title);
  form.append(button('打开新建任务',async()=>{
    if(!theme.value.trim()||!title.value.trim()||!duration.value||!duration.reportValidity())throw new Error('请填写主题、名称及有效时长');
    const sizes={'16:9':'1920×1080','9:16':'1080×1920','1:1':'1080×1080'};
    const selected=work.styles.map(id=>id+' '+lookup.get(id).name).join('、');
    const draft=['/skill:code-animation-prompts 制作代码动画：'+theme.value.trim(),selected?'参考风格：'+selected:'请按主题选取参考风格。',
      duration.value+' 秒，'+aspect.value+'（'+sizes[aspect.value]+'），'+fps.value+' fps，'+subs.value+'，'+audio.value+'。',
      extra.value.trim(),'交付可编辑 HTML 和关键帧，具备渲染依赖时导出 MP4。',
      '完成后调用本扩展 work.register；作品 ID '+work.id+'，relativePath 填当前任务内实际生成的相对 HTML 路径。'].filter(Boolean).join('\n');
    await ma.tasks.create(title.value.trim(),draft);closeModal();
  },'action'));body.append(form);
}
async function start() {
  await ma.ready;
  CATALOG=await ma.agent.domain.query('catalog');entries=CATALOG.entries;
  await loadPreviewManifest();
  lookup=new Map(entries.map(s=>[s.id,s]));
  ranked=[...featured.map(id=>lookup.get(id)).filter(Boolean),...entries.filter(s=>!featured.includes(s.id))];
  for(const s of entries){
    if(s.hasStill&&s.image)STILLS[s.id]='../skills/code-animation-prompts/'+s.image;
    if(s.previewType||s.motion===true||s.previewMotion===true){
      const type=previewTypeValue(s);PREVIEW_TYPES[s.id]=type;if(type==='motion')PREVIEW_MOTIONS[s.id]=s;
    }
    const source=safePreviewSource(s.preview||s.previewPath||s.previewSrc||s.previewImage);
    if(source)PREVIEWS[s.id]=source;
  }
  ma.on('state.changed',()=>refresh().catch(e=>notify(e.message)));
  setPage('styles');await refresh();
}
$('importWork').onclick=()=>pickFile(null).catch(e=>notify(e.message));
start().catch(e=>$('stylesGrid').replaceChildren(empty('扩展加载失败',e.message,[button('重试',()=>location.reload())])));

