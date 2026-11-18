'use strict';
const Motion = (() => {
  let seed = 901;
  function rand(){seed = (Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
  const tau = Math.PI*2;
  const particles = Array.from({length:3200},()=>[rand(),rand(),rand(),rand(),rand()]);
  const stars = Array.from({length:280},()=>[rand(),rand(),rand(),rand()]);
  const wordMasks=new Map();
  function letters(word){
    if(wordMasks.has(word)) return wordMasks.get(word);
    const c=document.createElement('canvas'); c.width=400;c.height=160;
    const g=c.getContext('2d',{willReadFrequently:true});
    if(!g){const fallback=[[0,0]];wordMasks.set(word,fallback);return fallback;}
    g.font='bold '+Math.min(132,370/Array.from(word).length)+'px "Microsoft YaHei","PingFang SC",sans-serif';
    g.textAlign='center';g.textBaseline='middle';g.fillText(word,200,84);
    const data=g.getImageData(0,0,400,160).data,pts=[];
    for(let y=0;y<160;y+=2)for(let x=0;x<400;x+=2)if(data[(y*400+x)*4+3]>120)pts.push([(x-200)/162,(y-80)/162]);
    if(!pts.length)pts.push([0,0]);
    if(wordMasks.size>12)wordMasks.clear();wordMasks.set(word,pts);return pts;
  }
  function shape(which,p,wordPts,t){
    const [a,b,c,d,e]=p,theta=a*tau;
    if(which===0){
      const radius=b<.36?.97+.045*c:Math.sqrt(b)*(.90+.09*Math.sin(13*theta+4*c));
      const x=Math.pow(Math.sin(theta),3), y=-(13*Math.cos(theta)-5*Math.cos(2*theta)-2*Math.cos(3*theta)-Math.cos(4*theta))/16;
      return [x*radius*.61+.035*Math.sin(theta)*Math.sin(4*b+t*.5),y*radius*.6+.026*Math.cos(theta*3+5*b)-.035];
    }
    if(which===1){
      const edges=[[-.6,-.02,0,-.57],[0,-.57,.6,-.02],[-.48,-.09,-.48,.42],[-.48,.42,.49,.42],[.49,.42,.49,-.09],[-.13,.42,-.13,.06],[-.13,.06,.13,.06],[.13,.06,.13,.42],[-.34,-.04,-.2,-.04]];
      const [x,y,u,v]=edges[Math.floor(a*edges.length)];
      return [x+(u-x)*b+(c-.5)*.055,y+(v-y)*b+(d-.5)*.055];
    }
    return wordPts[Math.floor(a*wordPts.length)];
  }
  function backdrop(g,w,h,rgb,t){
    g.fillStyle='#090c12';g.fillRect(0,0,w,h);
    const wash=g.createRadialGradient(w*.49,h*.50,0,w*.49,h*.50,Math.max(h*.85,w*.49));
    wash.addColorStop(0,'rgba('+rgb+',.125)');wash.addColorStop(.65,'rgba('+rgb+',.023)');wash.addColorStop(1,'transparent');
    g.fillStyle=wash;g.fillRect(0,0,w,h);
    for(const [x,y,z,s] of stars){g.globalAlpha=.16+.42*z;g.fillStyle=z>.8?'#f8f3dc':'rgb('+rgb+')';const size=.5+s*h/290;g.fillRect(((x+t*.0009*(1+z))%1)*w,y*h,size,size);}
    g.globalAlpha=1;
  }
  function particleArt(g,w,h,t,rgb,word,thumb){
    backdrop(g,w,h,rgb,t);
    const pts=letters(word),scale=Math.min(w*.49,h*.76),cx=w*.50,cy=h*.47;
    for(let band=0;band<9;band++){
      g.beginPath();
      for(let k=0;k<=150;k++){const x=k/150;const y=.64+.12*Math.sin(x*5.7+t*.12+band*.048)+.038*Math.sin(x*11.3+band*.15);
        if(k===0)g.moveTo(0,y*h);else g.lineTo(x*w,y*h);}
      g.strokeStyle='rgba('+rgb+','+(.032+band*.005)+')';g.lineWidth=.6;g.stroke();
    }
    const stage=Math.min(2,Math.floor(t/4)),u=Math.min(1,Math.max(0,(t%4-2.8)/1.2)),ease=u*u*(3-2*u);
    const scatter=Math.sin(ease*Math.PI);
    g.fillStyle='rgb('+rgb+')';
    for(let i=0;i<particles.length;i+=thumb?2:1){
      const p=particles[i], src=shape(stage,p,pts,t), dst=u?shape((stage+1)%3,p,pts,t):src;
      const x=cx+scale*(src[0]+(dst[0]-src[0])*ease+(p[2]-.5)*scatter*1.45+.005*Math.sin(t+p[1]*50));
      const y=cy+scale*(src[1]+(dst[1]-src[1])*ease+(p[3]-.5)*scatter*1.05+.005*Math.cos(t+p[1]*40));
      const size=Math.max(.65,(.76+1.7*p[4]**3)*h/335);
      g.fillStyle=i%7===0?'#fff3ca':'rgb('+rgb+')';g.globalAlpha=.42+.58*p[3];
      g.fillRect(x,y,size,size);
      if(i%97===0){g.globalAlpha=.20;g.fillRect(x-size*2,y+size*.35,size*5,size*.44);g.fillRect(x+size*.35,y-size*2,size*.44,size*5);}
    }g.globalAlpha=1;
  }
  function silk(g,w,h,t,rgb){
    backdrop(g,w,h,rgb,t);
    for(let i=0;i<120;i++){const a=i/120;g.beginPath();
      for(let k=0;k<=145;k++){const x=k/145, y=.5+.24*Math.sin(x*6.1+t*.41+a*3.3)+.13*Math.sin(x*9.3-t*.25+a*4.8)+(a-.5)*.49;
        if(k===0)g.moveTo(0,y*h);else g.lineTo(x*w,y*h);}
      g.strokeStyle='rgba('+rgb+','+(.13+.54*Math.pow(Math.sin(a*Math.PI),2))+')';g.lineWidth=Math.max(.55,h/470);g.stroke();}
  }
  function rain(g,w,h,t,rgb){
    backdrop(g,w,h,rgb,t);
    const size=Math.max(8,h*.043),cols=Math.ceil(w/(size*1.24)),glyph='光映時空流月雲花春雨夜夢影風山川海星森';
    g.textAlign='center';g.font='500 '+size+'px "Microsoft YaHei",sans-serif';
    for(let col=0;col<cols;col++){const p=particles[col],lead=((t*(.06+p[1]*.06)+p[0])%1)*1.9-.22;
      for(let j=0;j<15;j++){g.fillStyle=j===0?'#e9f8ff':'rgb('+rgb+')';g.globalAlpha=(1-j/15)*(.45+.5*p[2]);g.fillText(glyph[(col*7+j*3+Math.floor(t*2))%glyph.length],col*size*1.24,(lead-j*.052)*h);}}
    g.globalAlpha=1;
  }
  function parseColor(value){
    const source=String(value||'#8edbf6').trim();
    const hex=source.match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
    if(hex){
      const raw=hex[1].length===3?hex[1].split('').map(ch=>ch+ch).join(''):hex[1];
      return [0,2,4].map(offset=>parseInt(raw.slice(offset,offset+2),16)).join(',');
    }
    const rgb=source.match(/rgba?\s*\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
    return rgb?[rgb[1],rgb[2],rgb[3]].map(value=>Math.max(0,Math.min(255,Number(value)||0))).join(','):'142,219,246';
  }
  function canvasSize(canvas,thumb){
    const box=canvas.getBoundingClientRect?.()||{};
    const cssWidth=Number(box.width)||Number(canvas.clientWidth)||Number(canvas.width)||320;
    const cssHeight=Number(box.height)||Number(canvas.clientHeight)||Number(canvas.height)||160;
    const ratio=thumb?1:Math.min(globalThis.devicePixelRatio||1,1.5);
    return [Math.max(1,Math.round(cssWidth*ratio)),Math.max(1,Math.round(cssHeight*ratio))];
  }
  function draw(canvas,id,t,color,word,thumb=false){
    const [w,h]=canvasSize(canvas,thumb);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const g=canvas.getContext('2d');if(!g)return;
    const rgb=parseColor(color);
    if(id==='B3')particleArt(g,w,h,t,rgb,word,thumb);
    else{if(id==='B1')silk(g,w,h,t,rgb);else rain(g,w,h,t,rgb);
      if(t>=8){g.globalAlpha=Math.min(1,(t-8)*1.8);g.fillStyle='#f8fbf4';g.textAlign='center';g.textBaseline='middle';g.font='bold '+Math.round(h*.26)+'px "Microsoft YaHei",sans-serif';g.fillText(word,w/2,h*.5);g.globalAlpha=1;g.textBaseline='alphabetic';}}
  }
  function previewMode(id,motif){
    const value=String(motif||'').toLowerCase();
    if(id==='B1'||value==='wave'||value==='paper')return 'B1';
    if(id==='B3'||value==='particle'||value==='network'||value==='geometry')return 'B3';
    return 'A1';
  }
  function drawPreview(canvas,options={}){
    const id=String(options.id||'A1').toUpperCase();
    const mode=previewMode(id,options.motif);
    draw(canvas,mode,Number(options.time)||0,options.color||'#8edbf6',options.word||id,true);
  }
  return {draw,drawPreview,previewMode,parseColor};
})();
