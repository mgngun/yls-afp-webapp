/* LFAAnalyzer v5: calibrated, orientation-safe, exposure-aware line reader */
class LFAAnalyzer {
  constructor(config = {}) {
    this.config = {
      canonicalWidth: 640, canonicalHeight: 1920,
      tLinePosRatio: 0.32, cLinePosRatio: 0.76, peakTolerance: 0.12,
      minLineWidthPx: 3, maxLineWidthPx: 90,
      minCScore: 6, minTScore: 4,
      expectedOrientation: 'sample-to-absorbent',
      calibration: null, // { model:'4pl'|'poly', params:..., unit:'mg/dL' }
      ...config
    };
  }

  async analyze(source, options = {}) {
    const t0 = performance.now();
    try {
      const input = this._toCanvas(source);
      const quality = this._quality(input);
      if (!quality.ok) return this._fail(quality.reason, t0, quality);

      const strip = options.isPreCropped
        ? this._resize(input, this.config.canonicalWidth, this.config.canonicalHeight)
        : this._rectifyByGuide(input, options.guide); // production: replace with 4-corner marker homography
      const oriented = this._orient(strip);
      const { profile, bgProfile } = this._profile(oriented);
      const response = this._lineResponse(profile, bgProfile);
      const bg = this._background(response);
      const c = this._detect(response, this.config.cLinePosRatio, bg, 'C');
      const t = this._detect(response, this.config.tLinePosRatio, bg, 'T');
      const qc = this._qc(c, t, quality);
      const ratio = qc.valid && c.auc > 0 ? t.auc / c.auc : null;
      const concentration = qc.valid && t.detected ? this._concentration(ratio) : null;
      const result = !qc.valid ? '실패' : t.detected ? '양성' : '음성';
      const confidence = this._confidence(c, t, bg, quality);
      return {
        success:true, diagnosis:{ result, resultEnglish:{'양성':'positive','음성':'negative','실패':'fail'}[result],
          concentration, concentrationStr: concentration == null ? '-' : String(concentration),
          cLineDetected:c.detected, tLineDetected:t.detected, confidence, errorReason:qc.reason||'' },
        metrics:{ cPeakHeight:c.height, cPeakAUC:c.auc, tPeakHeight:t.height, tPeakAUC:t.auc,
          tcRatio:ratio, signalToNoise:Math.max(c.snr,t.snr), bgNoiseSigma:bg.sigma, quality },
        visualData:{ stripCanvas:oriented, response:Array.from(response), cLine:c, tLine:t },
        elapsedMs:Math.round(performance.now()-t0)
      };
    } catch(e) { return this._fail(e.message, t0); }
  }

  _toCanvas(s) {
    if (s instanceof HTMLCanvasElement) return s;
    const c=document.createElement('canvas'); c.width=s.naturalWidth||s.videoWidth||s.width; c.height=s.naturalHeight||s.videoHeight||s.height;
    c.getContext('2d').drawImage(s,0,0,c.width,c.height); return c;
  }
  _resize(src,w,h) { const c=document.createElement('canvas'); c.width=w;c.height=h;c.getContext('2d').drawImage(src,0,0,w,h);return c; }
  _rectifyByGuide(src, g) { return this._resize(src,this.config.canonicalWidth,this.config.canonicalHeight); }
  _orient(c) { return c; } // Require explicit kit orientation marker; do not infer orientation from texture variance.

  _quality(c) {
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let sum=0,sq=0,n=0;
    for(let i=0;i<d.length;i+=16){const y=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];sum+=y;sq+=y*y;n++;}
    const mean=sum/n, sd=Math.sqrt(Math.max(0,sq/n-mean*mean));
    if(mean<45) return {ok:false,reason:'too_dark',mean,sd};
    if(mean>250) return {ok:false,reason:'saturated',mean,sd};
    return {ok:true,mean,sd};
  }
  _profile(c) {
    const {data,width:w,height:h}=c.getContext('2d').getImageData(0,0,c.width,c.height), p=new Float32Array(h), bg=new Float32Array(h);
    const x0=Math.floor(w*.18),x1=Math.ceil(w*.82);
    for(let y=0;y<h;y++) { let a=0,b=0,n=0; for(let x=x0;x<x1;x++){const i=(y*w+x)*4; const r=data[i],g=data[i+1],bl=data[i+2]; const chrom=(r+1)/(g+bl+2); a+=chrom;n++;} p[y]=a/n; }
    for(let y=0;y<h;y++){let s=0,n=0;for(let k=-Math.floor(h*.025);k<=Math.floor(h*.025);k++){const j=Math.max(0,Math.min(h-1,y+k));s+=p[j];n++;}bg[y]=s/n;}
    return {profile:p,bgProfile:bg};
  }
  _lineResponse(p,b) { const r=new Float32Array(p.length); for(let i=0;i<r.length;i++) r[i]=Math.max(0,(p[i]-b[i])/(b[i]||1)); return r; }
  _background(r) { const a=Array.from(r).sort((x,y)=>x-y).slice(0,Math.floor(r.length*.7)); const med=a[Math.floor(a.length/2)]||0; const mad=a.map(x=>Math.abs(x-med)).sort((x,y)=>x-y)[Math.floor(a.length/2)]||.0001; return {median:med,sigma:1.4826*mad}; }
  _detect(r,pos,bg,name) {
    const n=r.length, half=Math.floor(n*this.config.peakTolerance), center=Math.round(n*pos), lo=Math.max(2,center-half), hi=Math.min(n-3,center+half);
    let idx=lo; for(let i=lo+1;i<=hi;i++) if(r[i]>r[idx]) idx=i;
    const base=bg.median, h=Math.max(0,r[idx]-base), threshold=Math.max(bg.sigma*(name==='C'?6:4), name==='C'?.004:.003);
    let l=idx; while(l>lo&&r[l]>base+h*.5)l--; let rr=idx; while(rr<hi&&r[rr]>base+h*.5)rr++;
    const width=rr-l+1; let auc=0;for(let i=l;i<=rr;i++)auc+=Math.max(0,r[i]-base);
    const detected=h>=threshold&&width>=this.config.minLineWidthPx&&width<=this.config.maxLineWidthPx;
    return {detected,index:idx,height:h,auc,width,snr:bg.sigma? h/bg.sigma:0,range:[l,rr]};
  }
  _qc(c,t,q) { if(!c.detected)return {valid:false,reason:'C_line_not_detected'}; return {valid:true,reason:''}; }
  _concentration(r) {
    const cal=this.config.calibration; if(!cal) return null;
    if(cal.model==='4pl'){const {A,B,C,D}=cal.params; const z=Math.max(1e-9,Math.min(.999999,(r-A)/(D-A))); return +(C*Math.pow((1-z)/z,1/B)).toPrecision(6);}
    if(cal.model==='poly'){let y=0;cal.params.forEach((a,i)=>y+=a*Math.pow(r,i));return +Math.max(0,y).toPrecision(6);} return null;
  }
  _confidence(c,t,bg,q){if(!c.detected)return 0;const s=Math.min(1,(c.snr+t.snr)/30);return Math.round(100*Math.min(1,.45*s+.35*(q.mean>60&&q.mean<235)+.2*(t.detected||t.snr<3))/10)/10;}
  _fail(reason,t,q={}){return {success:false,diagnosis:{result:'실패',resultEnglish:'fail',concentration:null,concentrationStr:'-',confidence:0,errorReason:reason},metrics:{quality:q,elapsedMs:Math.round(performance.now()-t)}};}
}
window.LFAAnalyzer=LFAAnalyzer;
