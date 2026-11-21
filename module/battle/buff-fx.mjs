// Buff and debuff animations (David, 2026-11-21; approved mockup v16). When a battlefield skill's buff or debuff lands
// on a unit, one short animation plays for each stat it changes (nothing stays on the stand afterwards):
//  attack up red, defense up brown, command up gold, morale up blue spirit-fire, movement up white; every debuff closes
//  in with a red ring and its calligraphy seal cracks and breaks; can't act: chains and dizzy stars.
// The drawing is the mockup's own canvas code, drawn each frame into two small canvases (under and over the stand)
// shown on the battle map. Art: JB2A (Patreon) and Eskie Effects (Patreon) frame sheets kept as private art in
// modules/qin-3k-characters/art/fx/buff-*.webp (never in this repository); a missing sheet is skipped.
import { atSpeed } from "./battle-speed.mjs";
import { fxTopLayer, fxGroundLayer } from "./unique-fx.mjs";

const FX_DIR = "modules/qin-3k-characters/art/fx/";
const FXM = {"atk1": {"n": 23, "w": 200, "h": 200, "c": 10, "fps": 15}, "partO": {"n": 23, "w": 200, "h": 200, "c": 10, "fps": 15}, "pulR": {"n": 12, "w": 200, "h": 200, "c": 10, "fps": 15}, "pulG": {"n": 12, "w": 200, "h": 200, "c": 10, "fps": 15}, "icoShieldG": {"n": 91, "w": 200, "h": 200, "c": 10, "fps": 15}, "defG": {"n": 23, "w": 200, "h": 200, "c": 10, "fps": 15}, "cmdL": {"n": 45, "w": 200, "h": 200, "c": 10, "fps": 15}, "pulY": {"n": 12, "w": 200, "h": 200, "c": 10, "fps": 15}, "cmd1": {"n": 23, "w": 200, "h": 200, "c": 10, "fps": 15}, "mov": {"n": 15, "w": 200, "h": 200, "c": 10, "fps": 15}, "dust": {"n": 18, "w": 200, "h": 200, "c": 10, "fps": 15}, "icoCrack": {"n": 91, "w": 200, "h": 200, "c": 10, "fps": 15}, "fireRing": {"n": 75, "w": 200, "h": 200, "c": 10, "fps": 15}, "fireB": {"n": 90, "w": 200, "h": 200, "c": 10, "fps": 15}, "smokeK": {"n": 18, "w": 200, "h": 200, "c": 10, "fps": 15}, "chains": {"n": 125, "w": 200, "h": 200, "c": 10, "fps": 15}, "dizzy": {"n": 30, "w": 200, "h": 200, "c": 10, "fps": 15}};
const FX = {};
let loading = null;
function loadArt() {
  if (loading) return loading;
  loading = Promise.all(Object.keys(FXM).map(n => new Promise(res => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => { FX[n] = im; res(); }; im.onerror = () => res(); im.src = FX_DIR + "buff-" + n + ".webp";
  })));
  return loading;
}
globalThis.Hooks?.once?.("canvasReady", () => loadArt());

// mockup units: the stand is 120 px, S = 140; the canvas is drawn at that scale and shown at the token's size
const S = 140, BOX = 520, C = BOX / 2;
function fr(n, t, loop) { const m = FXM[n]; let f = Math.floor(t * m.fps); if (loop) f = ((f % m.n) + m.n) % m.n; else if (f < 0 || f >= m.n) return -1; return f; }
function sprite(g, n, f, x, y, W, { a = 1, flip = false, flipX = false, dark = false, add = true, rot = 0, filter = null, glowF = false } = {}) {
  const im = FX[n]; if (!im || f < 0 || a <= 0) return; const m = FXM[n];
  g.save(); if (filter) g.filter = filter; g.translate(x, y); if (rot) g.rotate(rot); if (flip) g.scale(1, -1); if (flipX) g.scale(-1, 1);
  g.globalAlpha = a; if (add && !dark && (!filter || glowF)) g.globalCompositeOperation = "lighter"; if (dark) g.filter = "brightness(0.75) saturate(0.85)";
  g.drawImage(im, (f % m.c) * m.w, Math.floor(f / m.c) * m.h, m.w, m.h, -W / 2, -W / 2, W, W); g.restore();
}
const fr2=(n,q,sp=1)=>fr(n,q*sp); const rev=(n,q,sp=1)=>{const m=FXM[n],f=Math.floor(q*m.fps*sp);return f<0||f>=m.n?-1:m.n-1-f;};
const env=(q,a,b,c)=>q<0?0:q<a?q/a:q<b?1:q<c?(c-q)/(c-b):0; // fade in to a, hold to b, out by c
// a calligraphy seal: a square red (or coloured) chop with one character, stamped above the stand
let SEALX=0;
function seal(g,x,y,q,ch,col){x+=SEALX;const a=env(q,0.12,0.75,1.15);if(a<=0)return;const s=1+0.35*Math.max(0,1-q/0.18);g.save();g.translate(x,y-S*0.62-q*10);g.scale(s,s);g.globalAlpha=a;
 g.fillStyle=col;g.shadowColor='rgba(0,0,0,.5)';g.shadowBlur=6;g.beginPath();g.roundRect(-17,-17,34,34,4);g.fill();g.shadowBlur=0;
 g.strokeStyle='rgba(255,240,215,.9)';g.lineWidth=1.6;g.strokeRect(-14,-14,28,28);g.fillStyle='#fff6e6';g.font='600 22px "KaiTi","STKaiti","Kaiti SC","Noto Serif CJK SC","SimSun",serif';g.textAlign='center';g.textBaseline='middle';g.fillText(ch,0,1);g.restore();}

// a debuff's seal: stamped in a dull colour, a crack runs down it, then it splits and the halves fall away
const ZIG=[[2,-19],[-3,-9],[4,-1],[-2,7],[3,19]];
function brokenSeal(g,x,y,q,ch,col,hold=false){if(q<0)return;x+=SEALX;const end=hold?2.0:1.35;if(q>end)return;
 const s=1+0.35*Math.max(0,1-q/0.18), sp=hold?0:Math.max(0,q-0.6), a=Math.min(1,q/0.12)*(q>end-0.35?(end-q)/0.35:1);
 const draw=()=>{g.fillStyle=col;g.beginPath();g.roundRect(-17,-17,34,34,4);g.fill();g.strokeStyle='rgba(230,220,210,.75)';g.lineWidth=1.6;g.strokeRect(-14,-14,28,28);
   g.fillStyle='#e9e2d6';g.font='600 22px "KaiTi","STKaiti","Kaiti SC","Noto Serif CJK SC","SimSun",serif';g.textAlign='center';g.textBaseline='middle';g.fillText(ch,0,1);};
 for(const side of hold?[0]:[-1,1]){g.save();g.translate(x+side*sp*40,y-S*0.62+sp*sp*110);g.rotate(side*sp*0.8);g.scale(s,s);g.globalAlpha=a;
   if(side){g.beginPath();if(side<0){g.moveTo(-30,-30);for(const p of ZIG)g.lineTo(...p);g.lineTo(-30,30);}else{g.moveTo(30,-30);for(const p of ZIG)g.lineTo(...p);g.lineTo(30,30);}g.closePath();g.clip();}
   draw();
   // the crack line, before it splits
   if(!hold&&q>0.4&&q<0.62){g.strokeStyle='rgba(20,0,0,.9)';g.lineWidth=2;g.beginPath();const k=Math.min(1,(q-0.4)/0.15);ZIG.forEach((p,i)=>{if(i/(ZIG.length-1)<=k)(i?g.lineTo(...p):g.moveTo(...p));});g.stroke();}
   g.restore();}}
// a dark pool of shadow that spreads out under the stand and fades
function shadowPool(g,x,y,q){const a=env(q,0.25,0.75,1.4);if(a<=0)return;const r=S*(0.35+0.4*Math.min(1,q/0.6));g.save();g.translate(x,y+S*0.12);g.scale(1,0.55);
 const R=g.createRadialGradient(0,0,4,0,0,r);R.addColorStop(0,'rgba(8,10,30,'+(.75*a).toFixed(2)+')');R.addColorStop(0.7,'rgba(8,10,30,'+(.4*a).toFixed(2)+')');R.addColorStop(1,'rgba(8,10,30,0)');g.fillStyle=R;g.beginPath();g.arc(0,0,r,0,7);g.fill();g.restore();}
function glow(g,x,y,q,col,r){const a=env(q,0.15,0.4,0.9);if(a<=0)return;g.save();g.globalCompositeOperation='lighter';const R=g.createRadialGradient(x,y,4,x,y,r);R.addColorStop(0,col.replace('A',(.45*a).toFixed(2)));R.addColorStop(1,col.replace('A','0'));g.fillStyle=R;g.beginPath();g.arc(x,y,r,0,7);g.fill();g.restore();}
function dim(g,x,y,q,r){const a=env(q,0.15,0.5,1.1);if(a<=0)return;g.save();const R=g.createRadialGradient(x,y,4,x,y,r);R.addColorStop(0,'rgba(10,0,15,'+(.35*a).toFixed(2)+')');R.addColorStop(1,'rgba(10,0,15,0)');g.fillStyle=R;g.beginPath();g.arc(x,y,r,0,7);g.fill();g.restore();}

const LOOKS={
 atkUp:{t1:'Attack up',t2:'red ring, swords; seal 攻',
  under:(g,x,y,t,q)=>{glow(g,x,y,q,'rgba(255,60,30,A)',S*0.8);sprite(g,'pulR',fr2('pulR',q-0.05,1.2),x,y,S*1.5,{a:.9});},
  over:(g,x,y,t,q)=>{sprite(g,'atk1',fr('atk1',q-0.1),x,y,S*1.25);sprite(g,'partO',fr('partO',q-0.15),x,y-10,S*1.1);seal(g,x,y,q-0.25,'攻','#b3261e');}},
 defUp:{t1:'Defense up',t2:'brown shield; seal 守',
  under:(g,x,y,t,q)=>{glow(g,x,y,q,'rgba(150,95,40,A)',S*0.8);sprite(g,'pulG',fr2('pulG',q,1.2),x,y,S*1.5,{a:1,filter:'sepia(1) saturate(3) hue-rotate(-18deg) brightness(0.72) contrast(1.3)'});},
  over:(g,x,y,t,q)=>{const a=env(q,0.12,0.5,0.9);if(a>0)sprite(g,'icoShieldG',fr2('icoShieldG',q,1.5),x,y,S*0.95*(1+0.2*Math.max(0,1-q/0.2)),{a:a*.85,filter:'sepia(1) saturate(3) hue-rotate(-18deg) brightness(0.72) contrast(1.3)'});sprite(g,'defG',fr('defG',q-0.15),x,y,S*1.25,{filter:'sepia(1) saturate(3) hue-rotate(-18deg) brightness(0.72) contrast(1.3)'});seal(g,x,y,q-0.25,'守','#6d5a3a');}},
 cmdUp:{t1:'Command up',t2:'gold ring, filigree; seal 令',
  under:(g,x,y,t,q)=>{glow(g,x,y,q,'rgba(255,200,60,A)',S*0.85);if(q>0&&q<1.3)sprite(g,'cmdL',fr('cmdL',q*0.6,true),x,y,S*1.45,{a:.6*env(q,0.2,0.6,1.3),rot:q*0.4});sprite(g,'pulY',fr2('pulY',q,1.2),x,y,S*1.6,{a:.8});},
  over:(g,x,y,t,q)=>{sprite(g,'cmd1',fr('cmd1',q-0.1),x,y,S*1.25);seal(g,x,y,q-0.25,'令','#a67c00');}},
 movUp:{t1:'Movement up',t2:'white ring, dust, wind; seal 疾',
  under:(g,x,y,t,q)=>{sprite(g,'pulY',fr2('pulY',q,1.2),x,y,S*1.5,{a:.85,filter:'grayscale(1) brightness(0.85)',glowF:true});if(q>0&&q<1.0)sprite(g,'mov',fr('mov',q,true),x-S*0.45,y,S*1.0,{a:.8*env(q,0.1,0.6,1)});sprite(g,'dust',fr('dust',q-0.05),x-S*0.2,y+S*0.3,S*0.9,{a:.9,add:false,rot:Math.PI});},
  over:(g,x,y,t,q)=>{seal(g,x,y,q-0.25,'疾','#5d6670');}},
 atkDn:{t1:'Attack down',t2:'red ring closes, swords sink',
  under:(g,x,y,t,q)=>{dim(g,x,y,q,S*0.8);sprite(g,'pulR',rev('pulR',q,1.2),x,y,S*1.5,{a:.7,dark:true});},
  over:(g,x,y,t,q)=>{brokenSeal(g,x,y,q-0.2,'攻','#6e1a14');sprite(g,'atk1',fr('atk1',q-0.1),x,y,S*1.25,{flip:true,dark:true});}},
 defDn:{t1:'Defense down',t2:'cracked shield splits apart',
  under:(g,x,y,t,q)=>{dim(g,x,y,q,S*0.8);sprite(g,'pulR',rev('pulR',q,1.2),x,y,S*1.5,{a:.7,dark:true});},
  over:(g,x,y,t,q)=>{brokenSeal(g,x,y,q-0.2,'守','#4a3d28');if(q<0||q>1.3)return;const m=FXM.icoCrack,f=Math.min(m.n-1,Math.floor(q*m.fps*1.5)),W=S*0.95;
    const split=Math.max(0,q-0.55), a=q<0.12?q/0.12:q>0.95?Math.max(0,(1.3-q)/0.35):1, shake=q<0.55&&q>0.3?Math.sin(q*90)*3:0;
    for(const side of [-1,1]){g.save();g.translate(x+shake+side*split*55,y+split*split*120);g.rotate(side*split*0.9);g.globalAlpha=a*.95;
      g.beginPath();if(side<0)g.rect(-W/2,-W/2,W/2+2,W);else g.rect(-2,-W/2,W/2+2,W);g.clip();
      g.drawImage(FX.icoCrack,(f%m.c)*m.w,Math.floor(f/m.c)*m.h,m.w,m.h,-W/2,-W/2,W,W);g.restore();}}},
 cmdDn:{t1:'Command down',t2:'red ring closes, filigree fades',
  under:(g,x,y,t,q)=>{dim(g,x,y,q,S*0.8);if(q>0&&q<1.3)sprite(g,'cmdL',fr('cmdL',q*0.6,true),x,y,S*1.45*(1-0.15*q),{a:.55*env(q,0.15,0.5,1.3),rot:-q*0.4,dark:true,add:false});sprite(g,'pulR',rev('pulR',q,1.2),x,y,S*1.5,{a:.75,dark:true});},
  over:(g,x,y,t,q)=>{brokenSeal(g,x,y,q-0.2,'令','#6b5010');sprite(g,'cmd1',fr('cmd1',q-0.1),x,y,S*1.25,{flip:true,dark:true});}},
 movDn:{t1:'Movement down',t2:'headwind, dust settles',
  under:(g,x,y,t,q)=>{dim(g,x,y,q,S*0.75);sprite(g,'pulR',rev('pulR',q,1.2),x,y,S*1.5,{a:.7,dark:true});if(q>0&&q<1.0)sprite(g,'mov',fr('mov',q,true),x+S*0.45,y,S*1.0,{a:.7*env(q,0.1,0.6,1),flipX:true,dark:true,add:false});sprite(g,'dust',fr2('dust',q-0.05,1.2),x,y+S*0.42,S*0.95,{a:.85*env(q,0.05,0.7,1.0),add:false,flip:true});},
  over:(g,x,y,t,q)=>{brokenSeal(g,x,y,q-0.2,'疾','#3e444a');}},
 morUp:{t1:'Morale up',t2:'spirit-fire flares; seal 氣',
  under:(g,x,y,t,q)=>{glow(g,x,y,q,'rgba(80,170,255,A)',S*0.85);const a=env(q,0.15,0.8,1.3);if(a>0)sprite(g,'fireRing',fr('fireRing',q,true),x,y,S*(1.05+0.25*Math.min(1,q/0.3)),{a:a});},
  over:(g,x,y,t,q)=>{const a=env(q,0.2,0.75,1.2);if(a>0){for(const [dx,d0] of [[-38,0],[0,0.12],[38,0.06]])sprite(g,'fireB',fr('fireB',q+d0,true),x+dx,y-28,S*0.7,{a:a*.9});}seal(g,x,y,q-0.3,'氣','#1f5fa8');}},
 morDn:{t1:'Morale down',t2:'the flame gutters out',shiver:true,
  under:(g,x,y,t,q)=>{dim(g,x,y,q,S*0.8);sprite(g,'pulR',rev('pulR',q,1.2),x,y,S*1.5,{a:.7,dark:true});const a=env(q,0.1,0.35,0.75);if(a>0)sprite(g,'fireRing',fr('fireRing',q,true),x,y,S*(1.25-0.6*Math.min(1,q/0.75)),{a:a*.9});
    sprite(g,'smokeK',fr2('smokeK',q-0.6,1.0),x,y-20,S*1.0,{a:.7*env(q-0.6,0.1,0.5,1.0),add:false,rot:-Math.PI/2});},
  over:(g,x,y,t,q)=>{brokenSeal(g,x,y,q-0.2,'氣','#173c6b');}},
 stun:{t1:"Can't act",t2:'chains, then dizzy stars',
  under:(g,x,y,t,q)=>{sprite(g,'pulR',rev('pulR',q,1.2),x,y,S*1.5,{a:.7,dark:true});const m=FXM.chains;if(q>0&&q<2.2)sprite(g,'chains',Math.min(m.n-1,Math.floor(q*m.fps*1.6)),x,y,S*1.3,{a:env(q,0.1,1.7,2.2),add:false});},
  over:(g,x,y,t,q)=>{brokenSeal(g,x,y,q-0.2,'止','#3a3a3a',true);if(q>0.3&&q<2.2)sprite(g,'dizzy',fr('dizzy',q-0.3,true),x,y-S*0.38,S*0.75,{a:env(q-0.3,0.2,1.4,1.9)});}}
};

/** The looks, in the order their seals line up. */
export const BUFF_LOOKS = ["atkUp", "defUp", "cmdUp", "morUp", "movUp", "atkDn", "defDn", "cmdDn", "morDn", "movDn", "stun"];
const ORDER = Object.fromEntries(BUFF_LOOKS.map((k, i) => [k, i]));
const LAST = { stun: 2.3, morDn: 1.7 }; // how long each look runs (seconds of its own time)

/**
 * Play the looks on a unit's token. shiver(px) moves the stand sideways (morale down) and is reset to 0 at the end.
 * Returns a promise that settles when it ends.
 */
export async function playBuffLooks(token, looks, { shiver = null } = {}) {
  looks = [...new Set(looks)].filter(k => LOOKS[k]).sort((a, b) => ORDER[a] - ORDER[b]);
  if (!looks.length || !token || token.destroyed) return;
  await loadArt();
  const mk = () => { const cv = document.createElement("canvas"); cv.width = cv.height = BOX; return cv; };
  const cu = mk(), co = mk(), gu = cu.getContext("2d"), go = co.getContext("2d");
  const tu = PIXI.Texture.from(cu), to = PIXI.Texture.from(co);
  const su = new PIXI.Sprite(tu), so = new PIXI.Sprite(to);
  for (const sp of [su, so]) sp.anchor.set(0.5);
  const ground = fxGroundLayer(), top = fxTopLayer();
  ground.addChild(su); top.addChild(so);
  const end = Math.max(...looks.map(k => LAST[k] ?? 1.5));
  const shivers = looks.some(k => LOOKS[k].shiver);
  let t = 0;
  return new Promise(resolve => {
    const tick = () => {
      if (token.destroyed) return stop();
      t += (canvas.app?.ticker?.deltaMS ?? 16) / 1000 * (atSpeed(1000) ? 1000 / atSpeed(1000) : 1);
      const T = Math.min(token.w, token.h), k = T / 120;
      for (const sp of [su, so]) { sp.position.set(token.center.x, token.center.y); sp.scale.set(k); }
      gu.clearRect(0, 0, BOX, BOX); go.clearRect(0, 0, BOX, BOX);
      looks.forEach((key, j) => {
        SEALX = (j - (looks.length - 1) / 2) * 40;
        const L = LOOKS[key];
        try { L.under?.(gu, C, C, t, t); L.over?.(go, C, C, t, t); } catch (e) { console.warn("Qin | buff look " + key, e); }
      });
      SEALX = 0;
      tu.update(); to.update();
      if (shivers && shiver) shiver(t > 0.35 && t < 1.0 ? Math.sin(t * 70) * 2.2 * (1 - (t - 0.35) / 0.65) * k : 0);
      if (t >= end) stop();
    };
    const stop = () => {
      canvas.app?.ticker?.remove(tick);
      if (shiver) shiver(0);
      su.destroy({ texture: true, baseTexture: true }); so.destroy({ texture: true, baseTexture: true }); ground.destroy({ children: true });
      resolve();
    };
    canvas.app?.ticker?.add(tick);
  });
}

export { looksOfBuff, looksOfKey } from "./buff-looks.mjs";
