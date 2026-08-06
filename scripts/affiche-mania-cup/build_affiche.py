# -*- coding: utf-8 -*-
"""Affiche Springs Mania Cup — genere un HTML autonome, a capturer en 1080x1527.

Usage :  python build_affiche.py    ->  affiche.html
Puis ouvrir affiche.html dans un navigateur en 1080x1527 et capturer.
Tous les assets sont embarques en base64 : le HTML produit est autoportant.
"""
import base64, io, os

HERE   = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
REPO   = os.path.abspath(os.path.join(HERE, "..", ".."))

FONT   = os.path.join(REPO, "public", "fonts", "Rajdhani-Bold.ttf")
LOGO   = os.path.join(REPO, "public", "springs-logo.png")
SP404  = os.path.join(ASSETS, "PAGE_404.png")
SPIBIS = os.path.join(ASSETS, "Ibis-budget-2019.svg.png")
PHOTO  = os.path.join(ASSETS, "fond-trackmania.jpg")

SCRATCH = HERE

def b64(p):
    with open(p, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")

lines = "".join(
    '<i style="left:%dpx; top:%dpx; width:%dpx; opacity:%.2f;"></i>' % (
        -80 + (i * 41) % 240, 90 + i * 104, 560 + (i * 91) % 560, 0.07 + (i % 5) * 0.045
    ) for i in range(15)
)

HTML = u"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<style>
@font-face { font-family:'Rajdhani'; src:url(data:font/ttf;base64,__FONT__) format('truetype'); font-weight:700; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { background:#000; }
.poster { position:relative; width:1080px; height:1527px; overflow:hidden; background:#07050b;
  font-family:'Rajdhani','Arial Narrow',sans-serif; color:#fff; -webkit-font-smoothing:antialiased; }

.photo { position:absolute; inset:0;
  background-image:url(data:image/jpeg;base64,__PHOTO__);
  background-size:cover; background-position:50% 50%; background-repeat:no-repeat;
  filter:saturate(1.3) contrast(1.12) brightness(1.06); }
.veil { position:absolute; inset:0;
  background:linear-gradient(180deg,
    rgba(7,5,11,.96) 0%, rgba(7,5,11,.95) 34%, rgba(9,6,16,.93) 48%,
    rgba(9,6,16,.84) 58%, rgba(9,6,16,.58) 68%, rgba(7,5,11,.40) 79%,
    rgba(7,5,11,.46) 89%, rgba(7,5,11,.88) 100%); }
.tint { position:absolute; inset:0; background:rgba(60,20,100,.22); mix-blend-mode:multiply;
  -webkit-mask-image:linear-gradient(180deg, #000 0%, #000 55%, rgba(0,0,0,.25) 72%, rgba(0,0,0,.1) 100%);
          mask-image:linear-gradient(180deg, #000 0%, #000 55%, rgba(0,0,0,.25) 72%, rgba(0,0,0,.1) 100%); }
.glow  { position:absolute; width:1500px; height:1020px; left:-210px; top:-400px;
  background:radial-gradient(ellipse at center, rgba(123,47,190,.82) 0%, rgba(123,47,190,.20) 44%, rgba(7,5,11,0) 70%); }
.glow2 { position:absolute; width:1200px; height:820px; right:-360px; bottom:-300px;
  background:radial-gradient(ellipse at center, rgba(0,217,54,.22) 0%, rgba(0,217,54,.05) 46%, rgba(7,5,11,0) 72%); }
.lines { position:absolute; inset:0; }
.lines i { position:absolute; height:2px; transform:skewY(-13deg); transform-origin:left center;
  background:linear-gradient(90deg, rgba(163,100,217,0) 0%, rgba(163,100,217,.5) 45%, rgba(0,217,54,.45) 100%); }
.rays { position:absolute; left:-10%; right:-10%; bottom:0; height:62%;
  background:repeating-conic-gradient(from 208deg at 50% 128%,
    rgba(255,255,255,.05) 0deg 1.4deg, rgba(255,255,255,0) 1.4deg 7deg);
  -webkit-mask-image:linear-gradient(0deg, #000 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(0deg, #000 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,0) 100%); }
.grain { position:absolute; inset:0;
  background-image:repeating-linear-gradient(0deg, rgba(255,255,255,.02) 0 1px, transparent 1px 3px); }

.checker { position:absolute; left:0; right:0; height:22px;
  background-image:repeating-conic-gradient(#e9e9f2 0% 25%, transparent 0% 50%);
  background-size:22px 22px; opacity:.85;
  -webkit-mask-image:linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%); }
.checker.top { top:0; } .checker.bot { bottom:0; opacity:.5; }

.inner { position:relative; padding:36px 70px 0; height:100%; display:flex; flex-direction:column; }

/* ---------- HEADER : Springs en avant ---------- */
.top { text-align:center; }
.top img { width:285px; filter:drop-shadow(0 4px 14px rgba(0,0,0,.7)); }
.top .p { margin-top:6px; font-size:22px; letter-spacing:11px; color:#9d98b3; text-indent:11px; }

/* ---------- TITRE ---------- */
/* L'ecusson d'origine — un blason a pointe basse — faisait penser a la ZRT,
   une autre competition : plusieurs personnes l'ont dit a l'organisateur.
   La forme elle-meme etait en cause, on l'a donc remplacee et non retouchee.
   Le trait sous le titre reprend son idee sans jamais refermer de contour. */
.tt3 { position:relative; margin:40px auto 0; text-align:center; }
.tt3 .kick { font-size:25px; letter-spacing:12px; text-indent:12px; color:#00D936; }
.tt3 .springs { margin-top:16px; font-size:38px; letter-spacing:20px; text-indent:20px;
  line-height:1; color:#8f8fa6; }
.tt3 .maniacup { margin-top:4px; font-size:124px; line-height:.92; letter-spacing:1px;
  color:#fff; filter:drop-shadow(0 4px 0 rgba(0,0,0,.55)) drop-shadow(0 14px 30px rgba(0,0,0,.8)); }
/* Le trait reprend la barre de la variante B, mise a plat : il souligne le
   titre sans jamais refermer une forme autour de lui. */
.tt3 .rule { margin:22px auto 0; width:420px; height:4px;
  background:linear-gradient(90deg, rgba(0,217,54,0) 0%, #00D936 22%, #00D936 78%, rgba(0,217,54,0) 100%); }
.tt3 .when { margin-top:20px; display:flex; align-items:center; justify-content:center; gap:20px; }
.tt3 .when .d { font-size:36px; letter-spacing:2px; text-indent:2px; color:#fff; white-space:nowrap; }
.tt3 .when .dot { width:7px; height:7px; background:#00D936; transform:rotate(45deg); }
.tt3 .when .p { font-size:22px; letter-spacing:8px; text-indent:8px; color:#00D936; white-space:nowrap; }

/* Les 281 px rendus aux intervalles : sans ca, tout le texte se serre dans la
   moitie haute et le bas n'est plus qu'une photo. */
.hook { margin-top:64px !important; }
.stats { margin-top:52px !important; }
.prize { margin-top:46px !important; }
.pract { margin-top:40px !important; }

/* ---------- ACCROCHE ---------- */
.hook { margin-top:20px; text-align:center; }
.hook .lab { display:inline-block; font-size:23px; letter-spacing:7px; color:#07050b;
  background:linear-gradient(180deg,#25f04f,#00b62c); padding:8px 22px 6px; text-indent:7px; }
.hook .h1 { margin-top:12px; font-size:70px; line-height:1.02; letter-spacing:1px; color:#fff; }
.hook .h1 b { color:#00D936; }

/* ---------- INFOS ---------- */
.when { margin-top:22px; display:flex; align-items:baseline; justify-content:center; gap:24px; }
.when .d { font-size:58px; line-height:1; color:#fff; white-space:nowrap; }
.when .s { width:3px; height:40px; background:#7B2FBE; }
.when .p { font-size:35px; letter-spacing:5px; color:#a364d9; white-space:nowrap; }

.stats { margin-top:18px; display:flex; text-align:center;
  background:linear-gradient(180deg, rgba(7,5,11,.60) 0%, rgba(7,5,11,.46) 100%);
  -webkit-backdrop-filter:blur(9px); backdrop-filter:blur(9px);
  border-top:2px solid rgba(255,255,255,.14); border-bottom:2px solid rgba(255,255,255,.14); }
.stats > div { flex:1; padding:15px 0 13px; }
.stats > div + div { border-left:2px solid rgba(255,255,255,.10); }
.stats .v { font-size:54px; line-height:.9; color:#fff; text-shadow:0 3px 12px rgba(0,0,0,.9); }
.stats .k { margin-top:-6px; font-size:17px; letter-spacing:2.5px; color:#8d89a8; }

.prize { margin-top:18px; display:flex; align-items:center; justify-content:center; gap:26px;
  transform:skewX(-5deg); border-left:8px solid #00D936; border-right:2px solid rgba(163,100,217,.45);
  background:linear-gradient(90deg, rgba(0,217,54,.16) 0%, rgba(123,47,190,.30) 55%, rgba(123,47,190,.10) 100%);
  padding:14px 28px; box-shadow:0 10px 26px rgba(0,0,0,.6); }
.prize > * { transform:skewX(5deg); }
.prize .amt { font-size:100px; line-height:.85; color:#00D936;
  filter:drop-shadow(0 3px 0 rgba(0,0,0,.45)); }
.prize .lab { text-align:left; font-size:26px; letter-spacing:6px; color:#e6e2f0; line-height:1.4; }
.prize .lab small { display:block; font-size:20px; letter-spacing:3.5px; color:#9d99b5; }

.pract { position:relative; margin-top:16px; text-align:center; font-size:29px; text-shadow:0 3px 14px rgba(0,0,0,.95); letter-spacing:3px; color:#cfcbdd; }
.pract b { color:#fff; } .pract em { font-style:normal; color:#8d89a8; }

/* ---------- SPONSORS ---------- */
.sponsors { margin-top:auto; padding-top:12px; text-align:center; }
.sponsors .sl { text-shadow:0 3px 12px rgba(0,0,0,.9); font-size:19px; letter-spacing:6px; color:#6f6b86; }
.sponsors .row { margin-top:11px; display:flex; justify-content:center; align-items:center; gap:18px; }
.sponsors .card { background:#fff; border-radius:5px; height:74px; padding:9px 18px;
  display:flex; align-items:center; justify-content:center; }
.sponsors .card img { max-height:46px; max-width:165px; object-fit:contain; display:block; }
.sponsors .plain { height:74px; display:flex; align-items:center; padding:0 8px; }
.sponsors .plain img { max-height:56px; max-width:190px; object-fit:contain; display:block; }

.cta { position:relative; margin-top:14px; margin-bottom:40px; text-align:center;
  border-top:2px solid rgba(255,255,255,.12); padding-top:20px; }
.cta .l { text-shadow:0 3px 12px rgba(0,0,0,.9); font-size:22px; letter-spacing:6px; color:#8d89a8; }
.cta .u { text-shadow:0 4px 16px rgba(0,0,0,.95); margin-top:3px; font-size:50px; letter-spacing:2px; color:#fff; }
.cta .u b { color:#00D936; }
</style></head><body>
<div class="poster">
  <div class="photo"></div><div class="veil"></div><div class="tint"></div>
  <div class="glow" style="opacity:.55"></div><div class="glow2" style="opacity:.5"></div>
  <div class="lines">__LINES__</div>
  <div class="grain"></div>
  <div class="checker top"></div><div class="checker bot"></div>

  <div class="inner">
    <div class="top">
      <img src="data:image/png;base64,__LOGO__" alt="Springs E-Sport">
      <div class="p">PRÉSENTE</div>
    </div>

    <div class="tt3">
      <div class="kick">LAN TRACKMANIA</div>
      <div class="springs">SPRINGS</div>
      <div class="maniacup">MANIA CUP</div>
      <div class="rule"></div>
      <div class="when">
        <div class="d">3 &amp; 4 OCTOBRE 2026</div>
        <div class="dot"></div>
        <div class="p">MARZY (58)</div>
      </div>
    </div>

    <div class="hook">
      <div class="lab">UNE PREMIÈRE : 100 % FAST LEARN</div>
      <div class="h1">TON TALENT,<br>PAS TON <b>GRIND</b></div>
    </div>

    <div class="stats">
      <div><div class="v">2</div><div class="k">JOURS DE LAN</div></div>
      <div><div class="v">64</div><div class="k">JOUEURS</div></div>
      <div><div class="v">+40</div><div class="k">MAPS INÉDITES</div></div>
      <div><div class="v">8</div><div class="k">ÉPREUVES</div></div>
    </div>

    <div class="prize">
      <div class="amt">1 200 €</div>
      <div class="lab">DE CASHPRIZE</div>
    </div>

    <div class="pract"><b>30 €</b> <em>L'INSCRIPTION</em> &nbsp;·&nbsp; <b>BYOPC</b> <em>LOCATION LIMITÉE</em></div>

    <div class="sponsors">
      <div class="sl">AVEC LE SOUTIEN DE</div>
      <div class="row">
        <div class="plain"><img src="data:image/png;base64,__SP404__" alt="PAGE 404"></div>
        <div class="card"><img src="data:image/png;base64,__SPIBIS__" alt="ibis budget"></div>
      </div>
    </div>

    <div class="cta">
      <div class="l">INSCRIPTIONS SUR</div>
      <div class="u">aedral.com<b>/</b>mania-cup</div>
    </div>
  </div>
</div>
</body></html>
"""

html = (HTML.replace("__FONT__", b64(FONT))
            .replace("__LOGO__", b64(LOGO))
            .replace("__SP404__", b64(SP404))
            .replace("__SPIBIS__", b64(SPIBIS))
            .replace("__PHOTO__", b64(PHOTO))
            .replace("__LINES__", lines))

out = os.path.join(HERE, "affiche.html")
with io.open(out, "w", encoding="utf-8") as f:
    f.write(html)
print("OK", out, os.path.getsize(out) // 1024, "KB")
