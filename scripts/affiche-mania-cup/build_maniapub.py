# -*- coding: utf-8 -*-
u"""Visuels ManiaPub — les panneaux publicitaires affichés DANS Trackmania.

    python build_maniapub.py            -> les trois formats, en français
    python build_maniapub.py en         -> les trois formats, en anglais

Produit un HTML autoportant par format (tous les assets en base64), à capturer
aux dimensions exactes par scripts/affiche-mania-cup/render_maniapub.mjs.

Trois formats imposés par ManiaPub :

    bandeau   512 x  80   ratio 6,4:1 — une bande très fine
    portrait  512 x 768   ratio 2:3
    grand    2048 x 1312  ratio 1,56:1

CE QUI CHANGE PAR RAPPORT À L'AFFICHE PAPIER, et pourquoi :

Une affiche se regarde ; un panneau ManiaPub se croise à 300 km/h, souvent de
biais et petit à l'écran. Tout ce qui demande à être lu deux fois est perdu. On
garde donc, par ordre : le NOM, la DATE, l'ADRESSE où s'inscrire. Le reste —
les statistiques, les sponsors, l'accroche — n'apparaît que sur le grand
format, le seul qu'on ait le temps de lire.

Le bandeau de 80 px de haut ne peut porter que deux lignes. Y mettre les huit
épreuves ou le prix des places donnerait une bouillie grise : on n'y met que le
nom, la date et l'adresse.

Les textes sont ceux de l'affiche validée — aucune formulation nouvelle.
"""
import base64, io, os, sys

TEXTES = {
    "fr": {
        "kick":       u"LAN TRACKMANIA",
        "dates":      u"3 &amp; 4 OCTOBRE 2026",
        "dates_court": u"3 &amp; 4 OCT. 2026",
        "lieu":       u"MARZY (58)",
        "slogan":     u"TON TALENT,<br>PAS TON <b>GRIND</b>",
        "accroche":   u"UNE PREMIÈRE : 100 % FAST LEARN",
        "k_jours":    u"JOURS DE LAN",
        "k_joueurs":  u"JOUEURS",
        "k_maps":     u"MAPS INÉDITES",
        "k_epreuves": u"ÉPREUVES",
        "v_maps":     u"+40",
        "cashprize":  u"DE CASHPRIZE",
        "montant":    u"1 200 €",
        "prix":       u"<b>30 €</b> <em>L'INSCRIPTION</em>",
        "inscription": u"INSCRIPTIONS SUR",
        "soutien":    u"AVEC LE SOUTIEN DE",
        "presente":   u"PRÉSENTE",
    },
    "en": {
        "kick":       u"TRACKMANIA LAN",
        "dates":      u"OCTOBER 3–4, 2026",
        "dates_court": u"OCT. 3–4, 2026",
        "lieu":       u"MARZY, FRANCE",
        "slogan":     u"YOUR TALENT,<br>NOT YOUR <b>GRIND</b>",
        "accroche":   u"A FIRST: 100 % FAST LEARN",
        "k_jours":    u"DAYS OF LAN",
        "k_joueurs":  u"PLAYERS",
        "k_maps":     u"NEW MAPS",
        "k_epreuves": u"EVENTS",
        "v_maps":     u"40+",
        "cashprize":  u"PRIZE POOL",
        "montant":    u"€1,200",
        "prix":       u"<b>€30</b> <em>ENTRY</em>",
        "inscription": u"REGISTER AT",
        "soutien":    u"SUPPORTED BY",
        "presente":   u"PRESENTS",
    },
}

LANGUE = sys.argv[1] if len(sys.argv) > 1 else "fr"
if LANGUE not in TEXTES:
    raise SystemExit("langue inconnue : %s (fr ou en)" % LANGUE)
T = TEXTES[LANGUE]

HERE   = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
REPO   = os.path.abspath(os.path.join(HERE, "..", ".."))

FONT   = os.path.join(REPO, "public", "fonts", "Rajdhani-Bold.ttf")
LOGO   = os.path.join(REPO, "public", "springs-logo.png")
PHOTO  = os.path.join(ASSETS, "fond-trackmania.jpg")
SP404  = os.path.join(ASSETS, "PAGE_404.png")
SPIBIS = os.path.join(ASSETS, "Ibis-budget-2019.svg.png")


def b64(p):
    with open(p, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


# ── Socle commun ─────────────────────────────────────────────────────────────
# Le damier, la teinte violette et le vert Trackmania viennent de l'affiche :
# les deux visuels doivent se reconnaître comme une même campagne.

BASE = u"""
@font-face { font-family:'Rajdhani'; src:url(data:font/ttf;base64,__FONT__) format('truetype'); font-weight:700; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { background:#000; }
.pub { position:relative; overflow:hidden; background:#07050b;
  font-family:'Rajdhani','Arial Narrow',sans-serif; color:#fff; font-weight:700;
  -webkit-font-smoothing:antialiased; }
.photo { position:absolute; inset:0;
  background-image:url(data:image/jpeg;base64,__PHOTO__);
  background-size:cover; background-position:50% 42%;
  filter:saturate(1.25) contrast(1.1) brightness(1.02); }
.veil { position:absolute; inset:0; }
.tint { position:absolute; inset:0; background:rgba(60,20,100,.20); mix-blend-mode:multiply; }
.glow { position:absolute; border-radius:50%;
  background:radial-gradient(ellipse at center, rgba(123,47,190,.75) 0%, rgba(123,47,190,.16) 46%, rgba(7,5,11,0) 72%); }
.checker { position:absolute; left:0; right:0;
  background-image:repeating-conic-gradient(#e9e9f2 0% 25%, transparent 0% 50%);
  -webkit-mask-image:linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 18%, #000 82%, rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 18%, #000 82%, rgba(0,0,0,0) 100%); }
.inner { position:relative; height:100%; display:flex; }
.vert { color:#00D936; }
"""

# ── 1. Bandeau 512 x 80 ──────────────────────────────────────────────────────
# Deux lignes, pas trois. Le nom domine, l'adresse est le seul autre élément
# qui a le droit d'être en couleur : c'est la seule chose à retenir.

BANDEAU = u"""
.pub { width:512px; height:80px; }
.veil { background:linear-gradient(90deg, rgba(7,5,11,.97) 0%, rgba(7,5,11,.88) 40%, rgba(7,5,11,.95) 74%, rgba(7,5,11,.97) 100%); }
.glow { width:420px; height:300px; left:-140px; top:-150px; opacity:.55; }
.checker { height:5px; background-size:5px 5px; opacity:.55; }
.checker.top { top:0; } .checker.bot { bottom:0; opacity:.3; }
.bar { position:absolute; left:0; top:0; bottom:0; width:6px;
  background:linear-gradient(180deg,#25f04f,#00b62c); }
/* Deux colonnes de largeur FIXE, pas deux blocs qui se poussent : à cette
   taille, une ligne qui déborde d'un cheveu passe sous la colonne voisine et
   le bandeau devient illisible. Chaque colonne est bornée, et son contenu est
   dimensionné pour tenir dedans. */
.inner { align-items:center; padding:0 14px 0 20px; gap:10px; }
.g { width:258px; overflow:hidden; }
.g .n { font-size:27px; line-height:1; letter-spacing:.3px; white-space:nowrap;
  text-shadow:0 2px 8px rgba(0,0,0,.9); }
.g .n span { color:#8f8fa6; font-size:18px; letter-spacing:3px; }
.g .s { margin-top:4px; font-size:13px; line-height:1; letter-spacing:1.4px; color:#c3bed4;
  white-space:nowrap; text-shadow:0 2px 6px rgba(0,0,0,.95); }
.d { width:200px; text-align:right; white-space:nowrap; overflow:hidden; }
.d .c { font-size:11px; line-height:1; letter-spacing:1.4px; color:#a9a4bd; }
.d .c b { color:#00D936; font-size:17px; letter-spacing:.5px; }
.d .u { margin-top:5px; font-size:20px; line-height:1; letter-spacing:.2px; color:#fff;
  text-shadow:0 2px 8px rgba(0,0,0,.95); }
.d .u b { color:#00D936; }
"""

BANDEAU_BODY = u"""
<div class="pub">
  <div class="photo"></div><div class="veil"></div><div class="tint"></div>
  <div class="glow"></div>
  <div class="checker top"></div><div class="checker bot"></div>
  <div class="bar"></div>
  <div class="inner">
    <div class="g">
      <div class="n"><span>SPRINGS</span> MANIA CUP</div>
      <div class="s">__T_DATES_COURT__ &nbsp;·&nbsp; __T_LIEU__</div>
    </div>
    <div class="d">
      <div class="c"><b>__T_MONTANT__</b> __T_CASHPRIZE__</div>
      <div class="u">aedral.com<b>/</b>mania-cup</div>
    </div>
  </div>
</div>
"""

# ── 2. Portrait 512 x 768 ────────────────────────────────────────────────────
# Le format d'un panneau vertical de bord de piste. On garde la dotation, qui
# est l'argument, et une seule ligne de chiffres.

PORTRAIT = u"""
.pub { width:512px; height:768px; }
.veil { background:linear-gradient(180deg,
  rgba(7,5,11,.95) 0%, rgba(7,5,11,.90) 30%, rgba(9,6,16,.72) 52%,
  rgba(7,5,11,.62) 70%, rgba(7,5,11,.93) 100%); }
.glow { width:700px; height:480px; left:-120px; top:-200px; opacity:.6; }
.checker { height:10px; background-size:10px 10px; opacity:.75; }
.checker.top { top:0; } .checker.bot { bottom:0; opacity:.45; }
.inner { flex-direction:column; align-items:center; text-align:center; padding:30px 30px 26px; }
.logo { width:132px; filter:drop-shadow(0 3px 10px rgba(0,0,0,.8)); }
.kick { margin-top:16px; font-size:16px; letter-spacing:7px; text-indent:7px; color:#00D936; }
.springs { margin-top:12px; font-size:22px; letter-spacing:12px; text-indent:12px; color:#8f8fa6; line-height:1; }
.name { margin-top:2px; font-size:66px; line-height:.92; letter-spacing:.5px;
  filter:drop-shadow(0 3px 0 rgba(0,0,0,.55)) drop-shadow(0 10px 22px rgba(0,0,0,.85)); }
.rule { margin:14px auto 0; width:240px; height:3px;
  background:linear-gradient(90deg, rgba(0,217,54,0) 0%, #00D936 22%, #00D936 78%, rgba(0,217,54,0) 100%); }
.when { margin-top:14px; font-size:24px; letter-spacing:1.5px; text-shadow:0 2px 10px rgba(0,0,0,.95); }
.when .p { margin-top:2px; font-size:16px; letter-spacing:6px; text-indent:6px; color:#a364d9; }
.slogan { margin-top:auto; font-size:37px; line-height:1.03; text-shadow:0 3px 14px rgba(0,0,0,.95); }
.slogan b { color:#00D936; }
.prize { margin-top:20px; display:flex; align-items:center; justify-content:center; gap:14px;
  transform:skewX(-5deg); border-left:6px solid #00D936;
  background:linear-gradient(90deg, rgba(0,217,54,.18) 0%, rgba(123,47,190,.32) 60%, rgba(123,47,190,.10) 100%);
  padding:10px 20px; box-shadow:0 8px 20px rgba(0,0,0,.6); }
.prize > * { transform:skewX(5deg); }
.prize .amt { font-size:58px; line-height:.85; color:#00D936; filter:drop-shadow(0 2px 0 rgba(0,0,0,.45)); }
.prize .lab { text-align:left; font-size:17px; letter-spacing:3.5px; color:#e6e2f0; line-height:1.2; }
.stats { margin-top:18px; width:100%; display:flex;
  border-top:2px solid rgba(255,255,255,.16); border-bottom:2px solid rgba(255,255,255,.16);
  background:linear-gradient(180deg, rgba(7,5,11,.62) 0%, rgba(7,5,11,.44) 100%); }
.stats > div { flex:1; padding:9px 0 8px; }
.stats > div + div { border-left:2px solid rgba(255,255,255,.10); }
.stats .v { font-size:30px; line-height:.9; text-shadow:0 2px 8px rgba(0,0,0,.9); }
.stats .k { margin-top:-2px; font-size:11px; letter-spacing:1.6px; color:#8d89a8; }
.pract { margin-top:14px; font-size:17px; letter-spacing:2.5px; color:#cfcbdd; text-shadow:0 2px 10px rgba(0,0,0,.95); }
.pract b { color:#fff; } .pract em { font-style:normal; color:#8d89a8; }
.cta { margin-top:14px; width:100%; border-top:2px solid rgba(255,255,255,.14); padding-top:12px; }
.cta .l { font-size:13px; letter-spacing:4.5px; color:#8d89a8; }
.cta .u { margin-top:2px; font-size:31px; letter-spacing:.5px; text-shadow:0 3px 12px rgba(0,0,0,.95); }
.cta .u b { color:#00D936; }
"""

PORTRAIT_BODY = u"""
<div class="pub">
  <div class="photo"></div><div class="veil"></div><div class="tint"></div>
  <div class="glow"></div>
  <div class="checker top"></div><div class="checker bot"></div>
  <div class="inner">
    <img class="logo" src="data:image/png;base64,__LOGO__" alt="Springs E-Sport">
    <div class="kick">__T_KICK__</div>
    <div class="springs">SPRINGS</div>
    <div class="name">MANIA CUP</div>
    <div class="rule"></div>
    <div class="when">__T_DATES__<div class="p">__T_LIEU__</div></div>

    <div class="slogan">__T_SLOGAN__</div>

    <div class="prize">
      <div class="amt">__T_MONTANT__</div>
      <div class="lab">__T_CASHPRIZE__</div>
    </div>

    <div class="stats">
      <div><div class="v">64</div><div class="k">__T_K_JOUEURS__</div></div>
      <div><div class="v">8</div><div class="k">__T_K_EPREUVES__</div></div>
      <div><div class="v">__T_V_MAPS__</div><div class="k">__T_K_MAPS__</div></div>
    </div>

    <div class="pract">__T_PRIX__</div>

    <div class="cta">
      <div class="l">__T_INSCRIPTION__</div>
      <div class="u">aedral.com<b>/</b>mania-cup</div>
    </div>
  </div>
</div>
"""

# ── 3. Grand 2048 x 1312 ─────────────────────────────────────────────────────
# Le seul format qu'on a le temps de lire : il porte l'accroche, les quatre
# chiffres et les sponsors. Composition en deux colonnes pour occuper la
# largeur au lieu d'empiler au centre — un panneau large empilé au centre
# laisse deux tiers de vide.

GRAND = u"""
.pub { width:2048px; height:1312px; }
.veil { background:linear-gradient(105deg,
  rgba(7,5,11,.97) 0%, rgba(7,5,11,.93) 40%, rgba(9,6,16,.74) 62%,
  rgba(7,5,11,.60) 80%, rgba(7,5,11,.80) 100%); }
.glow { width:1700px; height:1150px; left:-380px; top:-460px; opacity:.6; }
.glow2 { position:absolute; border-radius:50%; width:1200px; height:820px; right:-300px; bottom:-320px;
  background:radial-gradient(ellipse at center, rgba(0,217,54,.20) 0%, rgba(0,217,54,.04) 48%, rgba(7,5,11,0) 74%); }
.checker { height:26px; background-size:26px 26px; opacity:.8; }
.checker.top { top:0; } .checker.bot { bottom:0; opacity:.45; }
.inner { align-items:stretch; padding:70px 92px 62px; gap:70px; }

.col-g { flex:1.25; display:flex; flex-direction:column; min-width:0; }
.col-d { flex:1; display:flex; flex-direction:column; justify-content:center; min-width:0; }

.logo { width:290px; filter:drop-shadow(0 4px 14px rgba(0,0,0,.8)); }
.presente { margin-top:8px; font-size:20px; letter-spacing:10px; text-indent:10px; color:#9d98b3; }
/* Le bloc du titre flotte au MILIEU de ce qui reste entre le logo et les
   sponsors. Sans ça il restait collé en haut et tout l'espace libre tombait
   d'un seul bloc en dessous : un grand vide sous la date, alors que la colonne
   de droite, elle, est centrée. Les deux marges automatiques répartissent
   l'espace au-dessus et en dessous à parts égales. */
.titre { margin:auto 0; }
.kick { font-size:28px; letter-spacing:13px; text-indent:13px; color:#00D936; }
.springs { margin-top:16px; font-size:44px; letter-spacing:23px; text-indent:23px; color:#8f8fa6; line-height:1; }
.name { margin-top:2px; font-size:150px; line-height:.9; letter-spacing:1px;
  filter:drop-shadow(0 5px 0 rgba(0,0,0,.55)) drop-shadow(0 16px 34px rgba(0,0,0,.85)); }
.rule { margin-top:26px; width:520px; height:5px;
  background:linear-gradient(90deg, #00D936 0%, #00D936 72%, rgba(0,217,54,0) 100%); }
.when { margin-top:26px; display:flex; align-items:center; gap:22px; }
.when .d { font-size:46px; letter-spacing:2px; white-space:nowrap; text-shadow:0 3px 12px rgba(0,0,0,.95); }
.when .dot { width:9px; height:9px; background:#00D936; transform:rotate(45deg); }
.when .p { font-size:27px; letter-spacing:9px; text-indent:9px; color:#a364d9; white-space:nowrap; }

.sponsors .sl { font-size:19px; letter-spacing:6px; color:#6f6b86; text-shadow:0 3px 12px rgba(0,0,0,.9); }
.sponsors .row { margin-top:14px; display:flex; align-items:center; gap:20px; }
.sponsors .card { background:#fff; border-radius:5px; height:78px; padding:10px 20px;
  display:flex; align-items:center; }
.sponsors .card img { max-height:48px; max-width:170px; object-fit:contain; display:block; }
.sponsors .plain { height:78px; display:flex; align-items:center; padding:0 8px; }
.sponsors .plain img { max-height:60px; max-width:200px; object-fit:contain; display:block; }

.lab { align-self:flex-start; font-size:26px; letter-spacing:8px; text-indent:8px; color:#07050b;
  background:linear-gradient(180deg,#25f04f,#00b62c); padding:9px 24px 7px; }
.slogan { margin-top:20px; font-size:88px; line-height:1.0; text-shadow:0 4px 18px rgba(0,0,0,.95); }
.slogan b { color:#00D936; }
.prize { margin-top:40px; align-self:flex-start; display:flex; align-items:center; gap:26px;
  transform:skewX(-5deg); border-left:9px solid #00D936;
  background:linear-gradient(90deg, rgba(0,217,54,.18) 0%, rgba(123,47,190,.34) 58%, rgba(123,47,190,.10) 100%);
  padding:16px 34px; box-shadow:0 12px 30px rgba(0,0,0,.65); }
.prize > * { transform:skewX(5deg); }
.prize .amt { font-size:112px; line-height:.85; color:#00D936; filter:drop-shadow(0 3px 0 rgba(0,0,0,.45)); }
.prize .lb { text-align:left; font-size:29px; letter-spacing:6px; color:#e6e2f0; line-height:1.25; }
.stats { margin-top:38px; display:flex; text-align:center;
  border-top:3px solid rgba(255,255,255,.16); border-bottom:3px solid rgba(255,255,255,.16);
  background:linear-gradient(180deg, rgba(7,5,11,.60) 0%, rgba(7,5,11,.42) 100%); }
.stats > div { flex:1; padding:18px 0 15px; }
.stats > div + div { border-left:3px solid rgba(255,255,255,.10); }
.stats .v { font-size:60px; line-height:.9; text-shadow:0 3px 12px rgba(0,0,0,.9); }
.stats .k { margin-top:-4px; font-size:17px; letter-spacing:2.6px; color:#8d89a8; }
.pract { margin-top:26px; font-size:30px; letter-spacing:3px; color:#cfcbdd; text-shadow:0 3px 14px rgba(0,0,0,.95); }
.pract b { color:#fff; } .pract em { font-style:normal; color:#8d89a8; }
.cta { margin-top:38px; border-top:3px solid rgba(255,255,255,.14); padding-top:22px; }
.cta .l { font-size:22px; letter-spacing:6px; color:#8d89a8; }
.cta .u { margin-top:4px; font-size:62px; letter-spacing:1px; text-shadow:0 4px 16px rgba(0,0,0,.95); }
.cta .u b { color:#00D936; }
"""

GRAND_BODY = u"""
<div class="pub">
  <div class="photo"></div><div class="veil"></div><div class="tint"></div>
  <div class="glow"></div><div class="glow2"></div>
  <div class="checker top"></div><div class="checker bot"></div>
  <div class="inner">
    <div class="col-g">
      <img class="logo" src="data:image/png;base64,__LOGO__" alt="Springs E-Sport">
      <div class="presente">__T_PRESENTE__</div>

      <div class="titre">
        <div class="kick">__T_KICK__</div>
        <div class="springs">SPRINGS</div>
        <div class="name">MANIA CUP</div>
        <div class="rule"></div>
        <div class="when">
          <div class="d">__T_DATES__</div>
          <div class="dot"></div>
          <div class="p">__T_LIEU__</div>
        </div>
      </div>

      <div class="sponsors">
        <div class="sl">__T_SOUTIEN__</div>
        <div class="row">
          <div class="plain"><img src="data:image/png;base64,__SP404__" alt="PAGE 404"></div>
          <div class="card"><img src="data:image/png;base64,__SPIBIS__" alt="ibis budget"></div>
        </div>
      </div>
    </div>

    <div class="col-d">
      <div class="lab">__T_ACCROCHE__</div>
      <div class="slogan">__T_SLOGAN__</div>
      <div class="prize">
        <div class="amt">__T_MONTANT__</div>
        <div class="lb">__T_CASHPRIZE__</div>
      </div>
      <div class="stats">
        <div><div class="v">2</div><div class="k">__T_K_JOURS__</div></div>
        <div><div class="v">64</div><div class="k">__T_K_JOUEURS__</div></div>
        <div><div class="v">__T_V_MAPS__</div><div class="k">__T_K_MAPS__</div></div>
        <div><div class="v">8</div><div class="k">__T_K_EPREUVES__</div></div>
      </div>
      <div class="pract">__T_PRIX__</div>
      <div class="cta">
        <div class="l">__T_INSCRIPTION__</div>
        <div class="u">aedral.com<b>/</b>mania-cup</div>
      </div>
    </div>
  </div>
</div>
"""

FORMATS = [
    ("bandeau",  512,   80, BANDEAU,  BANDEAU_BODY),
    ("portrait", 512,  768, PORTRAIT, PORTRAIT_BODY),
    ("grand",    2048, 1312, GRAND,   GRAND_BODY),
]

GABARIT = u"""<!DOCTYPE html>
<html lang="__LANG__"><head><meta charset="utf-8"><title>ManiaPub __NOM__</title>
<style>__CSS__</style></head><body>__BODY__</body></html>
"""

FONT_B64  = b64(FONT)
LOGO_B64  = b64(LOGO)
PHOTO_B64 = b64(PHOTO)
SP404_B64 = b64(SP404)
IBIS_B64  = b64(SPIBIS)

suffixe = "" if LANGUE == "fr" else "-%s" % LANGUE

for nom, largeur, hauteur, css, body in FORMATS:
    html = (GABARIT
            .replace("__LANG__", LANGUE)
            .replace("__NOM__", nom)
            .replace("__CSS__", BASE + css)
            .replace("__BODY__", body))
    html = (html.replace("__FONT__", FONT_B64)
                .replace("__LOGO__", LOGO_B64)
                .replace("__PHOTO__", PHOTO_B64)
                .replace("__SP404__", SP404_B64)
                .replace("__SPIBIS__", IBIS_B64))
    for cle, valeur in T.items():
        html = html.replace("__T_%s__" % cle.upper(), valeur)

    out = os.path.join(HERE, "maniapub-%s%s.html" % (nom, suffixe))
    with io.open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("OK %-9s %4d x %4d  ->  %s (%d KB)" % (
        nom, largeur, hauteur, os.path.basename(out), os.path.getsize(out) // 1024))
