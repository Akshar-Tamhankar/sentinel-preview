/* ===== scene.js: the home page's moving scenes, in plain WebGL 2 (no libraries).
   - hero:  a photograph cut into sky and ground, with the headline between them. Clouds, rain and wind keep moving.
   - gate:  cards come down the line, get scanned, and break into points. It runs on its own, with the app's real screens on the glass.
   - air:   photographs whose mist and fog move.
   Two things follow the scroll: the hero's headline going down behind the trees, and the bleachers at the end of the file. Each scene draws only while it is on
   screen. Without WebGL the page is photographs and plain text. ===== */
(() => {
  "use strict";
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const VERT = "#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const HEAD = `#version 300 es
precision highp float;out vec4 o;uniform vec2 uRes;uniform float uT,uDpr;
float h11(float x){return fract(sin(x*127.1)*43758.5453);}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+17.;a*=.5;}return s;}
float grain(vec2 f){return h21(f+fract(uT*7.)*91.)-.5;}
`;

  class Scene {
    constructor(canvas, frag, names, cap = 2) {
      this.cv = canvas; this.cap = cap; this.on = false; this.loc = {}; this.frame = null; this.t0 = performance.now();
      const gl = this.gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
      if (!gl) throw new Error("no webgl2");
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = this.pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, HEAD + frag));
      gl.bindAttribLocation(pr, 0, "p"); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      ["uRes", "uT", "uDpr", ...names].forEach(n => { this.loc[n] = gl.getUniformLocation(pr, n); });
      this.units = 0; this.tick = this.tick.bind(this);
    }
    tex(name, src, unit = this.units++) {
      const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      const ext = gl.getExtension("EXT_texture_filter_anisotropic"); if (ext) gl.texParameteri(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, name === "uPlate" ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(this.pr, name), unit);
      return unit;
    }
    set(name, ...v) { const l = this.loc[name]; if (l) this.gl["uniform" + v.length + "f"](l, ...v); }
    size() {
      const w = this.cv.clientWidth, h = this.cv.clientHeight, d = Math.min(this.cap, devicePixelRatio || 1);
      const W = Math.max(1, Math.round(w * d)), H = Math.max(1, Math.round(h * d));
      if (W === this.cv.width && H === this.cv.height && d === this.dpr) return false;
      this.cv.width = W; this.cv.height = H; this.W = w; this.H = h; this.dpr = d;
      this.gl.viewport(0, 0, W, H); this.set("uRes", W, H); this.set("uDpr", d);
      return true;
    }
    draw(t) { this.gl.useProgram(this.pr); if (this.before) this.before(t); this.set("uT", calm ? 3 : t); this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); if (this.after) this.after(t); }
    tick(now) {
      if (!this.on) return;
      const dt = Math.min(.05, (now - (this.last || now)) / 1000); this.last = now; this.t = (this.t || 0) + dt;
      if (this.size()) { this.gl.useProgram(this.pr); if (this.resized) this.resized(); }
      this.draw(this.t); this.raf = calm ? 0 : requestAnimationFrame(this.tick);
    }
    /** Draw only while the canvas is on screen. */
    run() {
      const go = v => { if (v === this.on) return; this.on = v; this.last = 0; if (v) this.raf = requestAnimationFrame(this.tick); };
      new IntersectionObserver(es => go(es[0].isIntersecting), { rootMargin: "60px" }).observe(this.cv);
      if (calm) { const again = () => { if (this.on) requestAnimationFrame(this.tick); }; addEventListener("scroll", again, { passive: true }); addEventListener("resize", again); this.again = again; }
      return this;
    }
  }
  const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const canvas2d = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
  const FACE = '"Sofia Sans Extra Condensed", Impact, sans-serif';

  /* ---------- hero ---------- */
  const HERO = `
uniform sampler2D uPlate,uMask,uText;uniform vec2 uOff,uImg,uLampA,uLampB,uMouse;uniform float uScale,uP,uLa,uLb,uRise,uBank,uHor;
vec2 img(vec2 f){return vec2((f.x-uOff.x)/(uImg.x*uScale),(f.y-uOff.y)/(uImg.y*uScale));}
// one bank of ten bulbs on a pole; returns warm light, and darkens the steel
vec3 tower(vec2 f,vec2 c,float L,float s,float lean,inout vec3 col,float ground){
  vec2 q=f-c;float poleX=lean*q.y*.03;
  float pole=smoothstep(1.2,0.,abs(q.x-poleX)-s*.045*(1.+max(q.y,0.)*.0006))*step(0.,q.y)*step(f.y,ground);
  col=mix(col,col*.06+vec3(.004,.010,.014),pole);
  float frame=smoothstep(1.,0.,max(abs(q.x)-s*1.12,abs(q.y)-s*.36));
  float bars=frame*max(smoothstep(1.4*uDpr,0.,abs(abs(q.y)-s*.2)),smoothstep(1.4*uDpr,0.,abs(q.y)));
  col=mix(col,vec3(.01,.018,.022),bars*.9);
  vec3 add=vec3(0.);
  for(int i=0;i<10;i++){
    vec2 b=vec2((float(i%5)-2.)*s*.46,(i<5?-1.:1.)*s*.2);
    float k=clamp(L*10.-h11(float(i)+lean*3.)*7.,0.,1.);
    float r=length(q-b)/s;
    add+=vec3(1.,.965,.9)*k*(smoothstep(.17,.1,r)*1.6+.010/(r*r+.012));
    col=mix(col,vec3(.05,.075,.085),smoothstep(.19,.16,r)*(1.-k)*.8);
  }
  float d=length(q)/s;
  add+=vec3(.62,.86,.95)*L*(.16/(d*d*.35+.9));                              // the glow around the bank
  float star=pow(max(0.,1.-abs(q.y)/(s*.16)),6.)*exp(-abs(q.x)/(s*2.6));    // a slight horizontal flare
  add+=vec3(.55,.8,.95)*star*L*.35;
  return add;
}
float beam(vec2 f,vec2 c,vec2 to){vec2 d=normalize(to-c),q=f-c;float a=dot(q,d);float w=abs(q.x*d.y-q.y*d.x);return smoothstep(a*.42+uRes.y*.015,a*.04,w)*step(0.,a)*exp(-a/(uRes.y*.8));}
float rain(vec2 f,float s,float v){vec2 p=f/(uDpr*s);p.x+=p.y*.07;p.y-=uT*v;vec2 c=floor(p/vec2(5.,60.)),q=fract(p/vec2(5.,60.));float n=h21(c);return step(.80,n)*smoothstep(.13,0.,abs(q.x-.2-.6*h11(n*9.)))*smoothstep(0.,.25,q.y)*smoothstep(.5,.25,q.y);}
void main(){
  vec2 f=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  float z=1.+uP*.16;vec2 pin=vec2(uRes.x*.5,uHor);vec2 fz=(f-pin)/z+pin;
  vec2 uv=img(fz);
  vec2 sk=uv+uMouse*vec2(.0016,.0010);sk.y-=.014;
  vec2 fg=uv+uMouse*vec2(.0052,.0022);
  // the clouds drift sideways: two copies of the sky slide and swap, so it never jumps
  float high=1.-smoothstep(.30,.47,sk.y);vec2 flow=vec2(.075,-.006)*high;float ph=fract(uT*.035),ph2=fract(ph+.5);
  vec3 sky=mix(texture(uPlate,vec2(sk.x-flow.x*(ph-.5),1.-sk.y+flow.y*(ph-.5))).rgb,texture(uPlate,vec2(sk.x-flow.x*(ph2-.5),1.-sk.y+flow.y*(ph2-.5))).rgb,abs(2.*ph-1.));
  // wind crosses the grass
  float near=smoothstep(.63,1.,fg.y);float gust=fbm(vec2(fg.x*3.2-uT*.42,fg.y*7.+uT*.05));
  vec2 gg=fg+vec2((sin(fg.x*260.+uT*3.1+gust*9.)*.0007+(gust-.5)*.0035)*near,0.);
  vec3 grd=texture(uPlate,vec2(gg.x,1.-gg.y)).rgb;grd*=1.+(gust-.45)*.75*smoothstep(.625,.72,fg.y);
  float m=fg.y>1.?1.:texture(uMask,vec2(fg.x,1.-fg.y)).r;
  float on=.5*uLa+.5*uLb;
  vec2 a=uLampA,b=uLampB;
  float da=length(fz-a)/uRes.y,db=length(fz-b)/uRes.y;
  float lit=uLa*(.30+.5*exp(-da*1.5))+uLb*(.30+.5*exp(-db*1.5));
  float fog=fbm(fz/uRes.y*vec2(2.2,3.4)+vec2(uT*.018,-uT*.01));
  vec3 col=sky*(.09+.86*lit);
  col*=.86+.3*fog;
  vec3 add=vec3(0.);
  add+=tower(fz,a,uLa,uBank,1.,col,uHor);
  add+=tower(fz,b,uLb,uBank,-1.,col,uHor);
  for(int i=0;i<7;i++){float k=float(i),sp=.5+h11(k+3.)*.9;vec2 m0=vec2(sin(uT*sp*1.7+k*4.1)+.5*sin(uT*sp*3.3+k),cos(uT*sp*1.3+k*2.3)*.8+.4*sin(uT*sp*2.9+k*7.))*uBank*(1.1+h11(k)*1.5);
    vec2 ca=mod(k,2.)<.5?a:b;add+=vec3(1.,.95,.85)*smoothstep(1.7*uDpr,.2*uDpr,length(fz-ca-m0-vec2(0.,uBank*.5)))*(mod(k,2.)<.5?uLa:uLb)*.75;}
  // the headline stands in the sky, behind the trees, and catches the same light
  vec2 tp=vec2(fz.x/uRes.x,(fz.y-(1.-uRise)*uRes.y*.42-uP*uRes.y*.46)/uRes.y)+uMouse*vec2(-.0022,-.0012);
  float tx=tp.y>0.&&tp.y<1.?texture(uText,vec2(tp.x,1.-tp.y)).r:0.;
  float tl=clamp(.03+uLa*(.34+.75*exp(-da*1.15))+uLb*(.34+.75*exp(-db*1.15)),0.,1.);
  vec3 tc=mix(vec3(.16,.34,.40),vec3(1.18),tl)*mix(.05,1.,tl);
  col=mix(col,tc,tx);
  add*=1.-tx*.55;
  // ground, trees and stands in front
  float spill=exp(-max(0.,fg.y-.623)*2.6);
  vec3 gcol=grd*(.07+lit*(1.05+.35*spill));
  col=mix(col,gcol,m);
  add*=1.-m*.92;
  float bm=beam(fz,a,vec2(uRes.x*.40,uRes.y*.86))*uLa+beam(fz,b,vec2(uRes.x*.60,uRes.y*.86))*uLb;
  col+=vec3(.30,.55,.62)*bm*(.10+.22*fog);
  float r=rain(f,1.,520.)*.9+rain(f+37.,1.6,700.)*.7+rain(f+91.,.7,380.)*.5;
  col+=vec3(.75,.92,1.)*r*(.03+.30*bm+.10*(uLa*exp(-da*6.)+uLb*exp(-db*6.)))*(calmK());
  col+=add;
  vec2 v=f/uRes-.5;col*=1.-dot(v,v)*.42;
  col=mix(col/(1.+max(vec3(0.),col-.82)*.6),col,tx*(1.-m));
  col+=grain(f)*.030;
  o=vec4(col,1.);
}`.replace("calmK()", calm ? "0." : "1.");

  function headline(W, H, d, lines, F, base) {
    const [c, x] = canvas2d(Math.round(W * d), Math.round(H * d));
    x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height); x.scale(d, d);
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "alphabetic"; x.font = `800 ${F}px ${FACE}`;
    if ("letterSpacing" in x) x.letterSpacing = `${-F * .012}px`;
    lines.forEach((l, i) => x.fillText(l, W / 2, base - (lines.length - 1 - i) * F * .79));
    return c;
  }

  async function hero() {
    const cv = document.getElementById("gl-hero"); if (!cv) return;
    const small = innerWidth * Math.min(2, devicePixelRatio || 1) < 1300 && innerWidth < 700;
    const s = new Scene(cv, HERO, ["uOff", "uImg", "uLampA", "uLampB", "uMouse", "uScale", "uP", "uLa", "uLb", "uRise", "uBank", "uHor"], innerWidth < 700 ? 2 : 2);
    const [plate, mask] = await Promise.all([load("assets/photos/field-2400.webp"), load("assets/photos/mask.webp"), document.fonts ? document.fonts.load(`800 100px ${FACE}`, "Fill") : 0]);
    s.tex("uPlate", plate, 0); s.tex("uMask", mask, 1); s.set("uImg", 2400, 1500);
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    s.resized = () => {
      const W = s.W, H = s.H, tall = W / H < .95, bar = 72;
      const sc = Math.max(W / 2400, H / 1500), horizon = H * (tall ? .60 : .66);
      const off = [W / 2 - 1184 * sc, Math.max(H - 1500 * sc, Math.min(0, horizon - 935 * sc))];
      if (off[0] > 0) off[0] = 0; if (off[0] + 2400 * sc < W) off[0] = W - 2400 * sc;
      const hor = off[1] + 935 * sc, base = off[1] + 786 * sc, d = s.dpr;
      const lines = tall ? ["Fill the", "student", "section"] : ["Fill the", "student section"];
      const [, m] = canvas2d(4, 4); m.font = `800 100px ${FACE}`;
      const widest = Math.max(...lines.map(l => m.measureText(l).width)) / 100;
      const room = base - bar - H * (tall ? .085 : .045);
      const F = Math.min(W * (tall ? .88 : .76) / widest, room / (.72 + (lines.length - 1) * .79));
      const tw = widest * F;
      const bank = Math.max(17, Math.min(40, W * (tall ? .05 : .022)));
      const lx = tall ? W * .10 : Math.max(W * .06, Math.min(W * .17, (W - tw) / 4));
      const ly = tall ? bar + H * .035 : bar + Math.max(34, H * .10);
      s.set("uScale", sc * d); s.set("uOff", off[0] * d, off[1] * d); s.set("uHor", hor * d);
      s.set("uLampA", lx * d, ly * d); s.set("uLampB", (W - lx) * d, ly * d); s.set("uBank", bank * d);
      s.tex("uText", headline(W, H, d, lines, F, base), 2);
    };
    const track = cv.closest(".s-hero"), t0 = performance.now();
    let La = calm ? 1 : 0, Lb = calm ? 1 : 0, rise = calm ? 1 : 0;
    const strike = (t, at) => { const k = t - at; if (k < 0) return 0; if (k < .07) return .5; if (k < .16) return .08; if (k < .22) return .7; if (k < .34) return .25; return Math.min(1, .45 + (k - .34) * .9); };
    const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 4);
    if (!calm && matchMedia("(pointer: fine)").matches) addEventListener("pointermove", e => { mouse.tx = e.clientX / innerWidth - .5; mouse.ty = e.clientY / innerHeight - .5; }, { passive: true });
    s.before = () => {
      const t = (performance.now() - t0) / 1000;
      if (!calm) { La = strike(t, .35); Lb = strike(t, .95); rise = ease((t - .55) / 1.5); }
      mouse.x += (mouse.tx - mouse.x) * .06; mouse.y += (mouse.ty - mouse.y) * .06;
      const r = track.getBoundingClientRect(), p = calm ? 0 : Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
      s.set("uLa", La); s.set("uLb", Lb); s.set("uRise", rise); s.set("uMouse", mouse.x, mouse.y); s.set("uP", p);
    };
    s.run();
    cv.closest(".s-hero").classList.add("lit");
  }

  /* ---------- the gate ---------- */
  const GATE = `
uniform sampler2D uScr,uOk,uCa,uCb,uNum,uBg;uniform vec2 uBs,uSway;uniform float uOkK,uZoom,uBeam,uFlood,uDrain,uNumK;uniform vec2 uPh,uFc;uniform vec4 uCam;uniform vec3 uA,uB,uRA,uRB,uRP,uBeamC;
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1,0,0,0,c,-s,0,s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0,s,0,1,0,-s,0,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,-s,0,s,c,0,0,0,1);}
float rbox(vec3 p,vec3 b,float rc,float re){vec2 q=abs(p.xy)-b.xy+rc;float d2=length(max(q,0.))+min(max(q.x,q.y),0.)-rc;vec2 w=vec2(d2,abs(p.z)-b.z)+re;return min(max(w.x,w.y),0.)+length(max(w,0.))-re;}
const vec3 PB=vec3(.48,1.0,.052);const vec3 CB=vec3(.62,.39,.008);const vec3 OR=vec3(1.,.4157,.2392);
mat3 MP,MA,MB;vec3 OP;float gFl;
float dP(vec3 p){return rbox(MP*(p-OP),PB,.115,.03);}
float dA(vec3 p){return rbox(MA*(p-uA),CB,.045,.006);}
float dB(vec3 p){return rbox(MB*(p-uB),CB,.045,.006);}
bool hP,hA,hB;
float map(vec3 p){float d=9.;if(hP)d=min(d,dP(p));if(hA)d=min(d,dA(p));if(hB)d=min(d,dB(p));return d;}
vec3 env(vec3 d){                                                     // a night field: two light banks, petrol sky, dark ground, and the orange when it is out
  vec3 c=mix(vec3(.004,.012,.016),vec3(.02,.085,.11),smoothstep(-.3,.9,d.y));
  vec2 a=d.xy-vec2(-.62,.55),b=d.xy-vec2(.70,.42);
  c+=vec3(1.,.97,.92)*2.2*smoothstep(.2,.02,max(abs(a.x)*.55,abs(a.y)*1.5))*step(d.z,.9);
  c+=vec3(.9,.97,1.)*1.6*smoothstep(.18,.02,max(abs(b.x)*.5,abs(b.y)*1.6));
  c+=OR*(.25+gFl*1.1)*smoothstep(.9,0.,abs(d.y+.35))*smoothstep(.3,-.9,d.x*(1.-.6*gFl));
  return c;
}
float gEdge;
bool sph(vec3 ro,vec3 rd,vec3 c,float rad){vec3 q=ro-c;float b=dot(q,rd);return b*b-dot(q,q)+rad*rad>0.;}
// how much of this pixel the orange has reached
float flood(vec2 p){
  if(uFlood<=0.)return 0.;
  vec2 q=p-uFc;float an=atan(q.y,q.x);
  float w=.05*sin(an*3.+uT*4.)+.035*sin(an*5.-uT*6.)+.02*sin(an*8.+uT*7.);
  float r=length(q)*(1.+w*smoothstep(0.,.5,uFlood));
  float in1=smoothstep(2.2/uRes.y,-2.2/uRes.y,r-uFlood);
  float asp=uRes.x/uRes.y;float dx=p.x/asp*.5*2.+.28*p.y+.10*(fbm(vec2(p.y*2.6+uT*.4,uT*.8))-.5)+.03*sin(p.y*9.+uT*7.);
  float out1=smoothstep(-1.6/uRes.x,1.6/uRes.x,dx-mix(-1.1,1.1,uDrain));
  return in1*(uDrain>0.?out1:1.);
}
vec3 card(vec3 q,vec3 n,vec3 rd,vec3 l,vec3 nl,sampler2D T,float t,float beam){
  vec3 r=reflect(rd,n);float fr=pow(1.-max(0.,dot(-rd,n)),5.);
  if(nl.z>.8){vec2 s=l.xy/CB.xy*.5+.5;vec3 c=textureLod(T,s,max(0.,log2(1240.*t/(1.75*uRes.y)/(2.*CB.x))-.35)).rgb*(.42+.68*max(0.,dot(n,normalize(vec3(-.35,.5,.8)))))+env(r)*(.05+.35*fr);
    if(beam>=0.){float b=s.y-(1.04-beam*1.08);c+=uBeamC*(smoothstep(.012,0.,abs(b))*1.5+.40*smoothstep(.20,0.,b)*step(0.,b));}
    return c;}
  if(nl.z<-.8)return vec3(.10,.27,.33)*(.3+.6*max(0.,n.y))+env(r)*.12;
  return vec3(.75,.80,.82)*(.2+.6*max(0.,n.y))+env(r)*.2;
}
vec3 shade(vec2 f){
  vec2 p=(f-.5*uRes)/uRes.y;gEdge=0.;
  MP=rz(uRP.z)*rx(uRP.x)*ry(uRP.y);MA=rz(uRA.z)*rx(uRA.x)*ry(uRA.y);MB=rz(uRB.z)*rx(uRB.x)*ry(uRB.y);
  OP=vec3(uPh,0.);
  vec3 ro=vec3(0.,0.,uZoom),rd=normalize(vec3(p,-1.75));
  // the ground, out of focus, sliding slowly sideways behind the line
  float sc=max(uRes.x/uBs.x,uRes.y/uBs.y)*1.16;vec2 bu=vec2(.5)+(f-.5*uRes)/(uBs*sc)+vec2(sin(uT*.11)*.045,.02)+uSway*vec2(-.012,.008);
  vec3 col=texture(uBg,bu).rgb;
  float fog=fbm(p*vec2(1.3,2.4)+vec2(-uT*.10,uT*.012));
  col*=.62+.95*fog;
  float fl=flood(p);gFl=smoothstep(.3,1.4,uFlood)*(1.-uDrain);
  if(fl>0.){vec3 oc=OR;float b=p.x*1.1+p.y*.45-uT*.55;oc*=1.-.055*smoothstep(.44,.5,abs(fract(b)-.5)+.0)-.045*smoothstep(.3,.32,abs(fract(b*.37)-.5));
    float num=texture(uNum,f/uRes).r*uNumK;oc=mix(oc,vec3(.0235,.0784,.1059),num);col=mix(col,oc,fl);}
  hP=sph(ro,rd,OP,1.14);hA=sph(ro,rd,uA,.76);hB=sph(ro,rd,uB,.76);
  float t=uZoom-2.4,d=1.;int hit=0;float near=1.;
  if(hP||hA||hB){for(int i=0;i<64;i++){d=map(ro+rd*t);near=min(near,d/t);if(d<.0006){hit=1;break;}t+=d*.93;if(t>uZoom+2.)break;}
  if(hit==0&&near<2.2/uRes.y)gEdge=1.;}
  if(fl>0.&&fl<1.)gEdge=1.;
  if(hit==1){
    vec3 q=ro+rd*t;vec2 e=vec2(.0009,0.);
    vec3 n=normalize(vec3(map(q+e.xyy)-map(q-e.xyy),map(q+e.yxy)-map(q-e.yxy),map(q+e.yyx)-map(q-e.yyx)));
    float a=hP?dP(q):9.,b=hA?dA(q):9.,c=hB?dB(q):9.;
    int id=a<b&&a<c?0:(b<c?1:2);
    vec3 l=id==0?MP*(q-OP):(id==1?MA*(q-uA):MB*(q-uB)),nl=id==0?MP*n:(id==1?MA*n:MB*n);
    float other=id==0?min(b,c):(id==1?min(a,c):min(a,b));vec2 le=(id==0?PB.xy:CB.xy)-abs(l.xy);
    if(abs(nl.z)<.97||other<.02||min(le.x,le.y)<.05)gEdge=1.;
    if(id==0){
      vec3 r=reflect(rd,n);float fr=pow(1.-max(0.,dot(-rd,n)),5.);
      if(nl.z>.9){
        vec2 s=l.xy/vec2(PB.x-.032,PB.y-.032)*.5+.5;
        vec2 cq=abs(l.xy)-vec2(PB.x-.032,PB.y-.032)+.088;float inr=length(max(cq,0.))+min(max(cq.x,cq.y),0.)-.088;
        float scr=smoothstep(.0035,-.0035,inr);
        float lod=max(0.,log2(780.*t/(1.75*uRes.y)/(2.*PB.x))-.35);vec3 A=textureLod(uScr,s,lod).rgb,B=textureLod(uOk,s,lod).rgb;
        float okw=smoothstep(-.012,.012,uOkK*1.1-.04-(1.-s.y));vec3 sc=mix(A,B,okw);
        // what the phone's camera sees: the card coming into the app's own brackets, the read, then the lock
        vec2 vf=(s-vec2(.0410,.4006))/vec2(.9179,.4366);vec2 vq=abs(vf-.5)-.5;float vin=step(max(vq.x,vq.y),0.)*step(.134,vf.y)*(1.-okw);
        if(uCam.x>0.&&vin>0.){
          vec2 ctr=vec2(.5+uCam.y,.565+uCam.z*.02);float ca=cos(uCam.z),sa=sin(uCam.z);vec2 cq=(vf-ctr)*358.;cq=mat2(ca,-sa,sa,ca)*cq;
          vec2 cu=cq/vec2(400.,251.6)+vec2(.74,.5);
          vec3 feed=textureLod(uBg,vec2(.35,.45)+vf*vec2(.25,.22)-uCam.y*.05,2.).rgb*.75+.02;
          vec2 ce=abs(cu-.5);float cin=smoothstep(.503,.497,max(ce.x,ce.y));
          float clod=max(0.,log2(1240.*t/(1.75*uRes.y)/(2.*PB.x*.918*400./358.))-.35);
          vec3 cc=textureLod(uCa,cu,clod).rgb*(.80+.12*(1.-vf.y));
          if(uBeam>=0.){float bb=cu.y-(1.04-uBeam*1.08);cc+=uBeamC*(smoothstep(.02,0.,abs(bb))*1.3+.40*smoothstep(.22,0.,bb)*step(0.,bb));}
          feed=mix(feed,cc,cin);
          float br=smoothstep(.10,.30,A.r-A.b);                          // the brackets, kept from the real screen
          vec2 lk=abs((vf-vec2(.5,.565))*358.)-vec2(95.,95.);float lm=max(lk.x,lk.y);
          feed=mix(feed,mix(vec3(1.,.4157,.2392),uBeamC,step(.5,uCam.w)),br);
          feed=mix(feed,uBeamC,smoothstep(1.2,.2,abs(lm)-1.6)*smoothstep(0.,.25,uCam.w));
          sc=mix(sc,feed,uCam.x*vin);
        }
        float isle=smoothstep(.004,-.002,length(vec2(max(abs(l.x)-.085,0.),l.y-.90))-.030);
        col=mix(vec3(.006),sc*.97,scr);col=mix(col,vec3(.004),isle);
        col+=env(r)*(.03+.4*fr)*scr+env(r)*.10*(1.-scr);
      }else{
        col=min(env(r),vec3(.16,.20,.22))*(.9+.45*fr)*vec3(.62,.70,.74)+vec3(.012,.02,.024)+OR*gFl*.10;
        if(nl.z<-.9){col=vec3(.03,.075,.09)+env(r)*.16;}
      }
    }else if(id==1)col=card(q,n,rd,l,nl,uCa,t,uBeam);else col=card(q,n,rd,l,nl,uCb,t,-1.);
  }
  return col;
}
void main(){
  vec2 f=gl_FragCoord.xy;vec3 col=shade(f);
  if(gEdge>.5){col+=shade(f+vec2(.33,-.17))+shade(f+vec2(-.31,.29))+shade(f+vec2(.12,.42));col*=.25;}
  vec2 v=f/uRes-.5;col*=1.-dot(v,v)*.4*(1.-gFl);
  col+=grain(f)*.024;
  o=vec4(col,1.);
}`;
  // the code's squares, on their way from the card to the number
  const BITS_V = `#version 300 es
precision highp float;layout(location=0) in vec2 q;layout(location=1) in vec4 ab;layout(location=2) in vec4 r;
uniform vec2 uRes;uniform float uK,uD,uSa,uSb,uT,uWave;out vec2 vq;out float va;flat out float vs;
void main(){
  float dl=r.x*.42+r.y*.12,k=clamp((uK-dl)/.72,0.,1.),e=k<.5?4.*k*k*k:1.-pow(-2.*k+2.,3.)/2.;
  vec2 d=ab.zw-ab.xy;vec2 n=vec2(-d.y,d.x);float arc=sin(k*3.1416);
  vec2 p=mix(ab.xy,ab.zw,e)+n*arc*(r.y-.5)*.55+vec2(0.,arc*(.10+.22*r.z));
  float dd=max(0.,uD-(.5+ab.z*.22)*.26-r.x*.14);
  p+=vec2(dd*dd*9.+dd*.4,dd*(r.y-.5)*1.9+dd*dd*(r.z-.35)*2.2);
  float s=mix(uSa,uSb,e)*(1.+arc*(.5+1.3*r.z))*(1.+.55*exp(-pow((ab.z-uWave)*6.,2.)))*(1.-smoothstep(.08,.50,dd));
  float a=(1.-e)*step(.0001,k)*(r.w-.5)*9.+dd*(r.w-.5)*16.;
  vs=s*.5*uRes.y;vec2 o=q*(s*.5+1.5/uRes.y);vq=o*uRes.y;
  o=mat2(cos(a),sin(a),-sin(a),cos(a))*o;va=1.;
  gl_Position=vec4((p+o)*2.*vec2(uRes.y/uRes.x,1.),0.,1.);
}`;
  const BITS_F = `#version 300 es
precision highp float;in vec2 vq;in float va;flat in float vs;out vec4 o;uniform float uA;
void main(){float a=clamp(vs-max(abs(vq.x),abs(vq.y))+.5,0.,1.)*uA;o=vec4(vec3(.0235,.0784,.1059)*a,a);}`;

  const LINE = [
    { name: "Ava Clark", id: "100234", code: "D7K2M9QX4T26", shot: "ava", ok: true },
    { name: "Marcus Lee", id: "100871", code: "DH3P8W2RN6C2", shot: "marcus", ok: true },
    { name: "Sophia Nguyen", id: "101102", code: "DQ9T4K7VM2F3", shot: "sophia", ok: true },
    { name: "Jordan Brooks", id: "101455", code: "DW2F7C9PL4M9", shot: "jordan", ok: false },
  ];
  const QK = 24, QX = n => 1240 - 70 - n * QK, QY = n => (780 - n * QK) / 2;
  function cardFace(who) {
    const [c, x] = canvas2d(1240, 780), QR = window.GameDay && window.GameDay.qr;
    x.fillStyle = "#fff"; x.fillRect(0, 0, 1240, 780);
    // the same mark as the header: five lights, one orange, and the pole
    x.save(); x.translate(66, 64); x.scale(4.9, 4.9); x.fillStyle = "#06141B";
    [[5, 4.5], [12, 4.5], [19, 4.5], [5, 12], [19, 12]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 3, 0, 7); x.fill(); });
    x.fillRect(11, 16.5, 2, 7.5); x.fillStyle = "#FF6A3D"; x.beginPath(); x.arc(12, 12, 3, 0, 7); x.fill(); x.restore();
    x.fillStyle = "#06141B"; x.font = `800 118px ${FACE}`; x.textBaseline = "alphabetic"; x.fillText("Sentinel", 208, 164);
    x.font = `600 46px "Sofia Sans", Arial`; x.fillText(who.name, 74, 640); x.fillStyle = "#465C66"; x.font = `400 38px "Sofia Sans", Arial`; x.fillText("ID " + who.id, 74, 698);
    const bits = [];
    if (QR) { const m = QR.matrix(who.code), n = m.length; x.fillStyle = "#06141B"; m.forEach((row, r) => row.forEach((on, i) => { if (!on) return; x.fillRect(QX(n) + i * QK, QY(n) + r * QK, QK, QK); bits.push([((QX(n) + (i + .5) * QK) / 1240 * 2 - 1) * .62, (1 - (QY(n) + (r + .5) * QK) / 780 * 2) * .39]); })); }
    return [c, bits];
  }
  async function gate() {
    const cv = document.getElementById("gl-gate"); if (!cv) return;
    const s = new Scene(cv, GATE, ["uOkK", "uZoom", "uBeam", "uBeamC", "uFlood", "uDrain", "uNumK", "uPh", "uFc", "uCam", "uBs", "uSway", "uA", "uB", "uRA", "uRB", "uRP", "uOk", "uCa", "uCb"], innerWidth < 700 ? 1.75 : 2), gl = s.gl;
    const [bg, ...shots] = await Promise.all(["gate-bg", "app-wait", ...LINE.map(p => "app-" + p.shot)].map(n => load(`assets/photos/${n}.webp`)));
    if (document.fonts) await Promise.all([document.fonts.load(`800 100px ${FACE}`, "Sentinel"), document.fonts.load('600 46px "Sofia Sans"', "Ava")]);
    s.tex("uScr", shots[0], 0); s.tex("uBg", bg, 10); s.set("uBs", bg.naturalWidth, bg.naturalHeight);
    LINE.forEach((p, i) => { s.tex("uOk" + i, shots[i + 1], 1 + i); const [c, bits] = cardFace(p); p.bits = bits; s.tex("uCard" + i, c, 5 + i); });
    /* the squares */
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const bp = gl.createProgram(); gl.attachShader(bp, sh(gl.VERTEX_SHADER, BITS_V)); gl.attachShader(bp, sh(gl.FRAGMENT_SHADER, BITS_F)); gl.linkProgram(bp);
    const bl = {}; ["uRes", "uK", "uD", "uSa", "uSb", "uA", "uWave"].forEach(n => { bl[n] = gl.getUniformLocation(bp, n); });
    const main = gl.createVertexArray(), vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(main); const tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(vao); const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); [1, 2].forEach(i => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 32, (i - 1) * 16); gl.vertexAttribDivisor(i, 1); });
    gl.bindVertexArray(main);

    let L = null, cells = [], count = 0;
    s.resized = () => {
      const a = s.W / s.H, tall = a < 1.5, zoom = tall ? 5.3 : 4.35, hh = zoom / 1.75 / 2, hw = hh * a, k = 1.75 / zoom, gut = Math.min(60, Math.max(18, s.W * .04)) / s.H;
      L = { a, tall, zoom, hw, hh, k };
      L.px = tall ? 0 : Math.min(hw - .78, hw * .60); L.py = tall ? -.62 : 0;
      L.ax = tall ? 0 : L.px - 1.30; L.ay = tall ? hh - .66 : .10; L.az = .5;
      L.wait = tall ? -hw - 1.2 : Math.max(-hw + .25, L.ax - 1.62); L.off = -hw - 1.1;
      // the number's box, in screen heights
      const left = -a / 2 + gut, right = tall ? a / 2 - gut : (L.px - .60) * k - .02, top = tall ? .5 - .03 : .40, bottom = tall ? (L.py + 1.02) * k + .02 : -.40;
      const d = s.dpr, [m, x] = canvas2d(s.cv.width, s.cv.height);
      x.fillStyle = "#000"; x.fillRect(0, 0, m.width, m.height); x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "alphabetic"; x.font = `800 100px ${FACE}`; if ("letterSpacing" in x) x.letterSpacing = "-2px";
      const w100 = x.measureText("+50").width, cap = 72;
      const F = Math.min((right - left) * s.H * .94 / w100, (top - bottom) * s.H / cap) * 100; x.font = `800 ${F * d}px ${FACE}`; if ("letterSpacing" in x) x.letterSpacing = `${-F * d * .02}px`;
      const cx = (left + right) / 2, cy = (top + bottom) / 2; L.nx = cx; L.nw = w100 * F / 100 / s.H;
      x.fillText("+50", (cx + a / 2) * s.H * d, (.5 - cy) * s.H * d + F * d * cap / 200);
      s.tex("uNum", m, 9);
      const g = F * cap / 100 / 26 * d, px = x.getImageData(0, 0, m.width, m.height).data; cells = [];
      for (let y = g / 2; y < m.height; y += g) for (let u = g / 2; u < m.width; u += g) if (px[(Math.floor(y) * m.width + Math.floor(u)) * 4] > 127) cells.push([u / d / s.H - a / 2, .5 - y / d / s.H]);
      L.g = g / d / s.H;
      if (count) aim(LINE[cur], now);
    };
    const rot = ([x, y, z]) => { const c = Math.cos, n = Math.sin, mul = (A, B) => [0, 1, 2].map(i => [0, 1, 2].map(j => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j])); // as the shader builds them (columns first)
      const X = [[1, 0, 0], [0, c(x), n(x)], [0, -n(x), c(x)]], Y = [[c(y), 0, -n(y)], [0, 1, 0], [n(y), 0, c(y)]], Z = [[c(z), n(z), 0], [-n(z), c(z), 0], [0, 0, 1]]; return mul(mul(Z, X), Y); };
    /** Where each square of this card's code is on screen now, and where it is going. */
    function aim(who, p) {
      const R = rot(p.RA), P = p.A, at = ([u, v]) => { const w = [0, 1, 2].map(j => P[j] + R[0][j] * u + R[1][j] * v); return [w[0] * 1.75 / (L.zoom - w[2]), w[1] * 1.75 / (L.zoom - w[2])]; };
      const from = who.bits.map(at), f = new Float32Array(cells.length * 8); if (!from.length) return;
      cells.forEach((t, i) => { const o = from[(i * 7919) % from.length]; f.set([o[0], o[1], t[0], t[1], Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, Math.abs(Math.sin(i * 78.233) * 12543.123) % 1, Math.abs(Math.sin(i * 39.425) * 9631.77) % 1, Math.abs(Math.sin(i * 5.17) * 7321.9) % 1], i * 8); });
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, f, gl.DYNAMIC_DRAW); count = cells.length;
      L.sa = QK / 1240 * 1.24 * 1.75 / (L.zoom - P[2]);
      L.fc = [from.reduce((q, o) => q + o[0], 0) / from.length, from.reduce((q, o) => q + o[1], 0) / from.length];
    }
    const clamp = v => Math.min(1, Math.max(0, v)), mix = (u, v, k) => u + (v - u) * k, seg = (t, u, v) => clamp((t - u) / (v - u)), io = k => k * k * (3 - 2 * k), out = k => 1 - Math.pow(1 - k, 3), inn = k => k * k * k;
    const SCAN = 1.05, HIT = 2.0, DRAIN = 4.55, NEXT = { true: 5.35, false: 4.3 };
    let cur = 0, t = 0, last = 0, fired = false, now = { A: [0, 0, 0], RA: [0, 0, 0] }, yaw = 0, vyaw = 0, pitch = 0, drag = null, mx = 0, my = 0, tx = 0, ty = 0;
    if (calm) t = 1.5;
    addEventListener("pointermove", e => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; if (drag) { yaw = drag.y + (e.clientX - drag.x) * .008; pitch = drag.p + (e.clientY - drag.yy) * .004; } }, { passive: true });
    cv.addEventListener("pointerdown", e => { drag = { x: e.clientX, yy: e.clientY, y: yaw, p: pitch }; cv.classList.add("drag"); });
    ["pointerup", "pointercancel", "blur"].forEach(n => addEventListener(n, () => { drag = null; cv.classList.remove("drag"); }));
    const steps = [...document.querySelectorAll("#night .step")];
    s.before = T => {
      const dt = Math.min(.05, T - last); last = T; if (!calm) t += dt;
      const who = LINE[cur], nxt = LINE[(cur + 1) % LINE.length];
      if (t >= NEXT[who.ok]) { t -= NEXT[who.ok]; cur = (cur + 1) % LINE.length; fired = false; return s.before(T); }
      if (!drag) { const f = -yaw * 60 - vyaw * 9; vyaw += f * .016; yaw += vyaw * .016; pitch *= .92; }
      mx += (tx - mx) * .06; my += (ty - my) * .06;
      const fl = calm ? 0 : T, bob = Math.sin(fl * 1.5) * .022, k0 = out(seg(t, 0, .95)), no = !who.ok;
      const sk = no ? seg(t, HIT, HIT + .36) : 0, shake = sk > 0 && sk < 1 ? Math.sin(sk * 19) * (1 - sk) * .07 : 0;
      const ok = io(seg(t, HIT, HIT + .32)) * (1 - io(seg(t, (no ? 3.55 : DRAIN + .2), (no ? 3.9 : DRAIN + .6))));
      const face = io(seg(t, HIT - .1, HIT + .7)) * (1 - io(seg(t, (no ? 3.3 : DRAIN), (no ? 4.2 : DRAIN + .75))));
      const go = who.ok ? seg(t, HIT + .06, HIT + .95) : 0, drop = no ? seg(t, HIT + .75, HIT + 1.75) : 0;
      const kick = who.ok ? Math.sin(seg(t, HIT, HIT + .5) * Math.PI) : 0;
      const A = [mix(L.wait, L.ax, k0) + shake + inn(go) * (L.hw * 2 + 1) - drop * .7, L.ay + bob - inn(drop) * 3.4 + (1 - k0) * .06, mix(L.az, -.75, io(clamp(go * 2.2)))];
      const RA = [.22 + my * .2 + drop * 1.1, mix(-.15, -.40, k0) + mx * .4 + go * 1.6, -.10 - (1 - k0) * .14 - drop * .9 + Math.sin(fl * 1.1) * .015];
      const bk = out(seg(t, .45, 1.6)), blow = who.ok ? inn(seg(t, HIT + .05, HIT + .5)) : 0;
      const B = [mix(L.off, L.wait, bk) - blow * 5, L.ay - bob * .8 + .06, L.az - .15 * 0], RB = [.22 + blow * .8, -.15 - blow * 1.6, -.24 - blow * .7];
      now = { A, RA };
      if (who.ok && t >= HIT && !fired && L && cells.length) { fired = true; aim(who, now); }
      s.gl.uniform1i(s.loc.uOk, 1 + cur); s.gl.uniform1i(s.loc.uCa, 5 + cur); s.gl.uniform1i(s.loc.uCb, 5 + (cur + 1) % LINE.length);
      s.set("uSway", mx, my); s.set("uZoom", L.zoom); s.set("uPh", L.px + shake * .8 + kick * .05, L.py - bob * .7); s.set("uRP", -.06 + my * .2 + pitch, mix(L.tall ? .30 : .52, L.tall ? .04 : .16, face) + mx * .35 + yaw + Math.sin(fl * .6) * .05 - kick * .22, mix(.05, 0, face) + shake * .5);
      s.set("uA", ...A); s.set("uRA", ...RA); s.set("uB", ...B); s.set("uRB", ...RB);
      const bm = seg(t, SCAN, HIT); s.set("uBeam", bm > 0 && bm < 1 ? (bm < .5 ? io(bm * 2) : 1 - io(bm * 2 - 1) * .999) : -1); s.set("uBeamC", ...(no && t > HIT - .12 ? [.88, .13, .25] : [1, .416, .239]));
      const gone = no ? seg(t, HIT + 1.0, HIT + 1.35) : seg(t, DRAIN - .2, DRAIN + .1);
      s.set("uCam", io(seg(t, .12, .42)) * (1 - gone), -(1 - out(seg(t, .25, 1.0))) * 1.25 + Math.sin(fl * 2.1) * .012 + shake * 1.2, -.05 - (1 - k0) * .2 + Math.sin(fl * 1.4) * .02, seg(t, HIT - .10, HIT + .05));
      const far = L.a + 1.1, fk = who.ok ? seg(t, HIT, HIT + .62) : 0; s.set("uFc", ...(L.fc || [0, 0])); s.set("uFlood", fk > 0 ? out(fk) * far + .001 : 0); s.set("uDrain", who.ok ? io(seg(t, DRAIN, DRAIN + .75)) : 0); s.set("uOkK", ok);
      s.set("uNumK", who.ok ? seg(t, HIT + 1.30, HIT + 1.48) * (t < DRAIN ? 1 : 0) : 0);
      const on = t < SCAN - .1 ? 0 : t < HIT || no ? 1 : 2; steps.forEach((e, i) => e.classList.toggle("on", i === on));
    };
    s.after = () => {
      const who = LINE[cur], k = t - HIT; if (!who.ok || k < 0 || !count || !fired || calm) return;
      const solid = k > 1.48 && t < DRAIN; if (solid) return;
      gl.useProgram(bp); gl.bindVertexArray(vao); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(bl.uRes, s.cv.width, s.cv.height); gl.uniform1f(bl.uK, k); gl.uniform1f(bl.uD, Math.max(0, t - DRAIN)); gl.uniform1f(bl.uSa, L.sa); gl.uniform1f(bl.uSb, L.g * 1.02); gl.uniform1f(bl.uA, 1); gl.uniform1f(bl.uWave, mix(L.nx - L.nw, L.nx + L.nw * 1.2, seg(k, .9, 1.5)));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.disable(gl.BLEND); gl.bindVertexArray(main); gl.useProgram(s.pr);
    };
    s.run();
  }

  /* ---------- air: photographs whose mist or fog moves ---------- */
  const AIR = `
uniform sampler2D uImg;uniform vec2 uIs,uPos;uniform float uMode;
void main(){
  vec2 f=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  float sc=max(uRes.x/uIs.x,uRes.y/uIs.y);vec2 vis=uRes/(uIs*sc);
  vec2 uv=f/uRes*vis+(1.-vis)*uPos;                                   // object-fit: cover
  vec3 col;
  if(uMode<.5){
    // light tower in the rain: the photograph holds still, mist crosses the beam and the lamp breathes
    vec2 lamp=vec2(.572,.235);float spray=1.-smoothstep(.36,.56,uv.x);
    col=texture(uImg,vec2(uv.x,1.-uv.y)).rgb;
    vec2 q=(uv-lamp)*vec2(uIs.x/uIs.y,1.);float d=length(q);
    float mist=fbm(vec2(q.x*1.7+uT*.085,q.y*1.3-uT*.04)),lampK=.96+.04*vn(vec2(uT*1.6,1.));
    col*=1.5*lampK*(1.+(mist-.45)*.62*spray);
    col+=vec3(.10,.24,.27)*mist*spray*exp(-d*1.7)*.35;
    col+=vec3(1.,.93,.8)*.005/(d*d*40.+.05)*lampK;
    float g=dot(col,vec3(.299,.587,.114));col=mix(vec3(g),col,1.1);
  }else{
    // field lights in fog: the fog crosses from left to right
    float sky=(1.-smoothstep(.36,.44,uv.y))*smoothstep(.22,.40,uv.x);sky*=smoothstep(.05,.17,length((uv-vec2(.435,.292))*vec2(1.5,1.)))*smoothstep(.03,.12,length((uv-vec2(.607,.315))*vec2(1.5,1.)));
    vec2 w=vec2(fbm(uv*vec2(4.,6.)+vec2(-uT*.05,0.)),fbm(uv*vec2(4.,6.)+vec2(7.,uT*.04)))-.5;
    vec2 fl=vec2(.05,.0)*sky;float p1=fract(uT*.06),p2=fract(p1+.5);
    vec3 a=texture(uImg,vec2(uv.x-fl.x*(p1-.5),1.-uv.y)).rgb,b=texture(uImg,vec2(uv.x-fl.x*(p2-.5),1.-uv.y)).rgb;
    col=mix(texture(uImg,vec2(uv.x,1.-uv.y)).rgb,mix(a,b,abs(2.*p1-1.)),sky*.75);
    float bank=fbm(vec2(uv.x*2.6-uT*.10,uv.y*6.+w.x*1.2)),low=fbm(vec2(uv.x*4.-uT*.19,uv.y*13.+w.y*2.));
    float glow=exp(-length((uv-vec2(.435,.292))*vec2(1.6,1.))*5.)+.75*exp(-length((uv-vec2(.607,.315))*vec2(1.6,1.))*6.);
    col*=1.+(bank-.45)*.55*(.35+.65*sky);
    col+=vec3(.75)*glow*(bank-.40)*.24*(.95+.05*vn(vec2(uT*5.,2.)));
    col+=vec3(.5)*smoothstep(.30,.75,low)*exp(-pow((uv.y-.455)*11.,2.))*.26*smoothstep(.1,.35,uv.x);
    col+=vec3(.35)*smoothstep(.42,.9,low)*exp(-pow((uv.y-.60)*5.,2.))*.16;
    col=mix(col,.50+(col-.50)*.74,smoothstep(.45,.75,col));                // hold the lamps back from pure white
  }
  col=min(col,vec3(1.));col+=grain(f)*.028;
  o=vec4(col,1.);
}`;
  async function air(cv) {
    const s = new Scene(cv, AIR, ["uIs", "uPos", "uMode"], 1.5), img = await load(`assets/photos/${cv.dataset.src}-${innerWidth < 700 ? "tall" : "2400"}.webp`);
    s.tex("uImg", img, 0); const [px, py] = (cv.dataset.at || "50 50").split(" ");
    // the upright crops are a window on the same photograph, so the lamp moves with them
    s.set("uIs", img.naturalWidth, img.naturalHeight); s.set("uPos", px / 100, py / 100); s.set("uMode", cv.dataset.air === "fog" ? 1 : 0);
    s.run();
  }

  const root = document.documentElement;
  const able = (() => { try { return !!document.createElement("canvas").getContext("webgl2") && "IntersectionObserver" in window; } catch (e) { return false; } })();
  if (able) {
    root.classList.add("gl");
    const start = (cv, fn) => { if (cv) fn(cv).then(() => cv.closest(".scene").classList.add("live")).catch(err => { cv.closest(".scene").classList.add("nogl"); console.warn(cv.id, err && err.message || err); }); };
    /** Nothing further down is built until you are about a screen away from it. */
    const soon = (cv, fn) => { if (cv) new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { io.disconnect(); start(cv, fn); } }, { rootMargin: "120% 0px" }).observe(cv.parentElement); };
    start(document.getElementById("gl-hero"), hero);
    soon(document.getElementById("gl-gate"), gate);
    document.querySelectorAll("canvas[data-air]").forEach(cv => soon(cv, air));
  }
  /* ---------- the fill: rows of empty bleachers turn over to a crowd ---------- */
  const fill = document.querySelector(".s-fill");
  if (fill && "IntersectionObserver" in window) {
    const set = () => { const r = fill.getBoundingClientRect(), p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight))), f = calm ? (p > .4 ? 1 : 0) : Math.min(1, Math.max(0, (p - (innerWidth <= 700 ? .1 : .16)) / .52)); fill.style.setProperty("--f", f.toFixed(4)); fill.classList.toggle("done", f >= .999); };
    addEventListener("scroll", set, { passive: true }); addEventListener("resize", set); set(); fill.classList.add("live");
  }
})();
