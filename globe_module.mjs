

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js';

/* =====================================================
   定数 / データ
===================================================== */

const EVENTS = JSON.parse(document.getElementById('EVENTS_DATA').textContent);
const REGION_ICONS = JSON.parse(document.getElementById('ICONS_DATA').textContent);

// 起動時に 4 枚の src を流し込む
(function loadRegionIcons(){
  for (const img of document.querySelectorAll('#regionIcon img')){
    const k = img.dataset.key;
    if (REGION_ICONS[k]) img.src = REGION_ICONS[k];
  }
})();

const ERAS = [
  { ja:"旧石器", ro:"Paleolithic", s:-40000, e:-14000 },
  { ja:"縄文",   ro:"Jōmon",       s:-14000, e:-300 },
  { ja:"弥生",   ro:"Yayoi",       s:-300,   e:250 },
  { ja:"古墳",   ro:"Kofun",       s:250,    e:538 },
  { ja:"飛鳥",   ro:"Asuka",       s:538,    e:710 },
  { ja:"奈良",   ro:"Nara",        s:710,    e:794 },
  { ja:"平安",   ro:"Heian",       s:794,    e:1185 },
  { ja:"鎌倉",   ro:"Kamakura",    s:1185,   e:1333 },
  { ja:"室町",   ro:"Muromachi",   s:1336,   e:1573 },
  { ja:"安土桃山",ro:"Azuchi-Momoyama", s:1573, e:1603 },
  { ja:"江戸",   ro:"Edo",         s:1603,   e:1868 },
  { ja:"明治",   ro:"Meiji",       s:1868,   e:1912 },
  { ja:"大正",   ro:"Taishō",      s:1912,   e:1926 },
  { ja:"昭和",   ro:"Shōwa",       s:1926,   e:1989 },
  { ja:"平成",   ro:"Heisei",      s:1989,   e:2019 },
  { ja:"令和",   ro:"Reiwa",       s:2019,   e:2030 },
];
const MIN_YEAR = -40000, MAX_YEAR = 2030;

const KIND_META = {
  japan:    { color: 0xff5d6c, label:"日本",   css:"#ff5d6c" },
  world:    { color: 0xfff48b, label:"世界",   css:"#fff48b" },
  war:      { color: 0xff8a4c, label:"戦争",   css:"#ff8a4c" },
  culture:  { color: 0xa0e1ff, label:"文化",   css:"#a0e1ff" },
  science:  { color: 0x7cffbf, label:"科学",   css:"#7cffbf" },
  religion: { color: 0xffb3ff, label:"宗教",   css:"#ffb3ff" },
  discovery:{ color: 0xb6ff5c, label:"探検",   css:"#b6ff5c" },
  politics: { color: 0xff8de5, label:"政治",   css:"#ff8de5" },
  economy:  { color: 0xffd97a, label:"経済",   css:"#ffd97a" },
  geology:  { color: 0xc89b7e, label:"地学",   css:"#c89b7e" },
  astronomy:{ color: 0x9bb3ff, label:"天文",   css:"#9bb3ff" },
  geography:{ color: 0x7ee1c4, label:"地理",   css:"#7ee1c4" },
  chemistry:{ color: 0xf28adb, label:"化学",   css:"#f28adb" },
};

function eraForYear(y){
  for (const e of ERAS) if (y >= e.s && y < e.e) return e;
  return null;
}
function formatYear(y){
  return y < 0 ? `B.C. ${-y}` : `A.D. ${y}`;
}

/* =====================================================
   Three.js シーン
===================================================== */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth/window.innerHeight, 0.1, 4000);
camera.position.set(0, 0, 7);

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// 明るくクッキリ. tonemap は弱め (Linear) で暗くならないように.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.45;
// 影 (太陽光) — 地球↔月が影を落としリアリティを増す (月食/日食の表現)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('globeWrap').appendChild(renderer.domElement);

// ── 星空: なめらかな球殻分布 + 恒星の色温度ばらつき + 天の川バンドで本格的に
function makeStarSprite(){
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,0, 32,32,32);
  // 多段グラデで滑らかなグロー (硬い縁を出さない)
  g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.38, 'rgba(255,255,255,0.38)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.84, 'rgba(255,255,255,0.03)');
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,64,64);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
}
const STAR_TEX = makeStarSprite();

// 球殻分布: 一様な方向 × 半径レンジ. cube より天球が均一で滑らか.
function fillShell(arr, n, rMin, rMax){
  for (let i=0; i<n; i++){
    const u  = Math.random()*2 - 1;
    const th = Math.random()*Math.PI*2;
    const s  = Math.sqrt(1 - u*u);
    const r  = rMin + Math.random()*(rMax - rMin);
    arr[i*3]   = r * s * Math.cos(th);
    arr[i*3+1] = r * u;
    arr[i*3+2] = r * s * Math.sin(th);
  }
}

// 恒星の色温度パレット (白主体, 一部 青白 / 黄白 / 橙)
const STAR_TINTS = [
  [1.00,1.00,1.00],[0.98,0.99,1.00],[1.00,1.00,1.00],[1.00,1.00,1.00],
  [0.80,0.87,1.00],   // 青白
  [1.00,0.95,0.85],   // 黄白
  [1.00,0.84,0.70],   // 橙
];

// 主層: ふんわり光る星 (sprite glow) + 色・明るさのばらつき
const starsGeo = new THREE.BufferGeometry();
const STARS_N = 6000;
const _starsPos = new Float32Array(STARS_N*3);
const _starsCol = new Float32Array(STARS_N*3);
fillShell(_starsPos, STARS_N, 600, 1400);
for (let i=0; i<STARS_N; i++){
  const t = STAR_TINTS[(Math.random()*STAR_TINTS.length)|0];
  const b = 0.65 + Math.random()*0.35;      // 明るさのばらつき
  _starsCol[i*3]   = t[0]*b;
  _starsCol[i*3+1] = t[1]*b;
  _starsCol[i*3+2] = t[2]*b;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(_starsPos, 3));
starsGeo.setAttribute('color',    new THREE.BufferAttribute(_starsCol, 3));
const starsMat = new THREE.PointsMaterial({
  map: STAR_TEX,
  vertexColors: true,
  size: 5,
  sizeAttenuation: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  alphaTest: 0.002,
  opacity: 0.9,
});
const stars = new THREE.Points(starsGeo, starsMat);
scene.add(stars);

// 微細層: 同じソフトスプライトで細粒を大量に. 空をなめらかに埋める.
const tinyGeo = new THREE.BufferGeometry();
const TINY_N = 16000;
const _tinyPos = new Float32Array(TINY_N*3);
fillShell(_tinyPos, TINY_N, 700, 1650);
tinyGeo.setAttribute('position', new THREE.BufferAttribute(_tinyPos, 3));
const tinyMat = new THREE.PointsMaterial({
  map: STAR_TEX,
  color: 0xeef2ff,
  size: 1.6,
  sizeAttenuation: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  opacity: 0.55,
  depthWrite: false,
});
const tinyStars = new THREE.Points(tinyGeo, tinyMat);
scene.add(tinyStars);

// 天の川バンド: 生成テクスチャを大球に内向き貼り (うっすら, 奥行きと本格感)
function makeMilkyWayTex(){
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,2048,1024);
  const cy = 512;
  for (let i=0; i<1500; i++){
    const x = Math.random()*2048;
    const band = Math.exp(-Math.pow(Math.random()*2-1, 2) * 2.2); // 帯中央に集中
    const y = cy + (Math.random()*2-1)*220 + Math.sin(x/2048*Math.PI*2)*55;
    const r = 16 + Math.random()*70;
    const a = 0.010 + band*0.050;
    const hue = 205 + Math.random()*45;
    const g = ctx.createRadialGradient(x,y,0, x,y,r);
    g.addColorStop(0, `hsla(${hue},42%,84%,${a})`);
    g.addColorStop(1, 'hsla(220,42%,80%,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
  }
  for (let i=0; i<5000; i++){           // 微小な星粒を焼き込み
    const x = Math.random()*2048, y = Math.random()*1024;
    ctx.fillStyle = `rgba(255,255,255,${(Math.random()*0.5).toFixed(3)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const milkyWay = new THREE.Mesh(
  new THREE.SphereGeometry(1800, 48, 48),
  new THREE.MeshBasicMaterial({
    map: makeMilkyWayTex(),
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
milkyWay.rotation.z = 0.5;    // 帯を少し傾ける
milkyWay.rotation.x = 0.22;
scene.add(milkyWay);

// 地球
const earthGeometry = new THREE.SphereGeometry(2, 96, 96);
const loader = new THREE.TextureLoader();
const earthTex = loader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg', t => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
});
const bumpTex  = loader.load('https://threejs.org/examples/textures/planets/earth_normal_2048.jpg');
const specTex  = loader.load('https://threejs.org/examples/textures/planets/earth_specular_2048.jpg');
// xxx.html ベース: MeshStandard で素直に明るく. emissive を高くして夜面も発色させる.
const earthMaterial = new THREE.MeshStandardMaterial({
  map: earthTex,
  normalMap: bumpTex,
  roughness: 0.85,
  metalness: 0.0,
  emissive: new THREE.Color(0xffffff),
  emissiveMap: earthTex,
  emissiveIntensity: 0.55,   // 夜側でも色が見える基礎発光
});
const earth = new THREE.Mesh(earthGeometry, earthMaterial);
earth.castShadow = true;      // 月へ影を落とす (月食)
earth.receiveShadow = true;   // 月の影を受ける (日食の点)
scene.add(earth);

// 雲 — 3D 系 (多層 + Phong で太陽光の陰影 + バンプで puff の立体感)
const cloudTex = loader.load('https://threejs.org/examples/textures/planets/earth_clouds_1024.png');

// 下層 (厚雲) — Lambert ベースで白く明るく
const cloudsLow = new THREE.Mesh(
  new THREE.SphereGeometry(2.026, 128, 128),
  new THREE.MeshLambertMaterial({
    map: cloudTex,
    alphaMap: cloudTex,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    emissive: new THREE.Color(0x202428),
    emissiveIntensity: 0.5,
  })
);
scene.add(cloudsLow);

// 中層 — 少し膨らんだ位置でゆっくり別方向に流す
const cloudsMid = new THREE.Mesh(
  new THREE.SphereGeometry(2.044, 96, 96),
  new THREE.MeshLambertMaterial({
    map: cloudTex,
    alphaMap: cloudTex,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  })
);
scene.add(cloudsMid);

// 高層 (うっすら) — 加算で発光感. 反対方向に速め.
const cloudsHi = new THREE.Mesh(
  new THREE.SphereGeometry(2.072, 64, 64),
  new THREE.MeshLambertMaterial({
    map: cloudTex,
    alphaMap: cloudTex,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
scene.add(cloudsHi);

// 後方互換: 旧 `clouds` 参照を残す
const clouds = cloudsLow;

/* =====================================================
   月 (Moon) — 地球と同格に本格描画
   ・実テクスチャ + バンプでクレーターの起伏
   ・地球と同じ太陽光で照らされ, 公転に伴い満ち欠け (phase) が出る
   ・地球(原点)を周回. 軌道傾斜 5.14°. 潮汐ロックで常に同じ面を地球へ.
===================================================== */
const MOON_RADIUS     = 0.545;                  // 地球半径2に対する実比 (約0.273)
const MOON_ORBIT_DIST = 7.4;                    // 地球中心からの距離
const MOON_ORBIT_TILT = 5.14 * Math.PI / 180;   // 軌道傾斜
const MOON_ORBIT_SPEED = 0.0009;                // 公転 (地球自転よりゆっくり)

const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 96, 96);
const moonTex = loader.load('https://threejs.org/examples/textures/planets/moon_1024.jpg', t => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
});
// 地球の earthMaterial と同系統 (MeshStandard) で本格的に. 夜側は控えめ発光.
const moonMaterial = new THREE.MeshStandardMaterial({
  map: moonTex,
  bumpMap: moonTex,
  bumpScale: 0.014,                 // クレーターの陰影を立たせる
  roughness: 0.96,
  metalness: 0.0,
  emissive: new THREE.Color(0xb9c0d0),
  emissiveMap: moonTex,
  emissiveIntensity: 0.10,          // 地球(0.55)より暗く — 満ち欠けを残す
});
const moon = new THREE.Mesh(moonGeometry, moonMaterial);
moon.castShadow = true;
moon.receiveShadow = true;

// 公転ピボット: 地球中心(原点)に置き Y回転で公転. 軌道面を傾ける.
// 月メッシュは moonOrbit の子なので, 自前回転なしで自動的に潮汐ロック (常に同じ面が地球向き).
const moonOrbit = new THREE.Group();
moonOrbit.rotation.z = MOON_ORBIT_TILT;
/* 月は不要 */ // scene.add(moonOrbit);
moon.position.set(MOON_ORBIT_DIST, 0, 0);
moonOrbit.add(moon);

// (月ラベルは廃止 — 文字なしの宇宙ビュー)

// (大気のハロ・暗ヴィネット撤去 — 地球をしっかり明るく見せる)

// ライト (起動時は 0 から 1s で立ち上げる)
// 太陽の向き: 画面内 (右上・手前寄り = -Z 側) に置き, そこから地球を照らす.
// → 太陽が視界に入り, 地球はサイド光で陰影 (アンビエント強めなので暗くなりすぎない).
// 視軸(-Z)から ~16° の上やや右. 地球の視半径(~12.5°)の外に出て画面内に収まる.
const SUN_DIR = new THREE.Vector3(0.20, 0.18, -0.96).normalize();
const sun = new THREE.DirectionalLight(0xffffff, 0);
sun.position.copy(SUN_DIR).multiplyScalar(30);   // 向きのみ意味を持つ (影カメラ位置も兼ねる)
// 影マップ: 地球(半径2)・月軌道(7.4)を覆う正射影フラスタム
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far  = 45;
sun.shadow.camera.left = -9;
sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9;
sun.shadow.camera.bottom = -9;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 3;          // PCFソフトで縁をなめらかに
scene.add(sun);

/* =====================================================
   太陽 (Sun) — 光源方向に実体を配置. 本体 + 多層コロナ(加算グロー).
   地球・月と同じく "本格的" に見える発光体.
===================================================== */
const SUN_DIST = 115;
const sunGroup = new THREE.Group();
sunGroup.position.copy(SUN_DIR).multiplyScalar(SUN_DIST);
scene.add(sunGroup);

// ── 光球面テクスチャ: 粒状斑(granulation) + 黒点 + 白斑 をプロシージャル生成
function makeSunSurfaceTex(){
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  // ベースの暖色グラデ
  const base = x.createLinearGradient(0,0,0,1024);
  base.addColorStop(0,'#ffd27a'); base.addColorStop(0.5,'#ffbe55'); base.addColorStop(1,'#ffcf6e');
  x.fillStyle = base; x.fillRect(0,0,1024,1024);
  // 粒状斑: 暖色の柔らかいブロブを大量に重ねる
  for (let i=0; i<9000; i++){
    const px=Math.random()*1024, py=Math.random()*1024, r=4+Math.random()*16;
    const warm = Math.random();
    const col = warm<0.5
      ? `rgba(255,${(205+Math.random()*45)|0},${(110+Math.random()*70)|0},0.45)`
      : `rgba(255,${(150+Math.random()*55)|0},${(45+Math.random()*45)|0},0.40)`;
    const g=x.createRadialGradient(px,py,0,px,py,r);
    g.addColorStop(0,col); g.addColorStop(1,'rgba(255,170,80,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  // 黒点 (暗い領域)
  for (let i=0; i<12; i++){
    const px=Math.random()*1024, py=Math.random()*1024, r=10+Math.random()*30;
    const g=x.createRadialGradient(px,py,0,px,py,r);
    g.addColorStop(0,'rgba(90,40,12,0.62)'); g.addColorStop(0.6,'rgba(140,70,25,0.35)'); g.addColorStop(1,'rgba(140,70,25,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  // 白斑 (明るいプラージュ)
  for (let i=0; i<40; i++){
    const px=Math.random()*1024, py=Math.random()*1024, r=5+Math.random()*14;
    const g=x.createRadialGradient(px,py,0,px,py,r);
    g.addColorStop(0,'rgba(255,252,228,0.75)'); g.addColorStop(1,'rgba(255,244,205,0)');
    x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  return t;
}
const SUN_SURFACE = makeSunSurfaceTex();

// 本体: 自発光する光球 (ライティング非依存). 起伏感のため emissiveMap も同テクスチャ.
const sunCore = new THREE.Mesh(
  new THREE.SphereGeometry(7, 96, 96),
  new THREE.MeshBasicMaterial({ map: SUN_SURFACE, color: 0xffffff, toneMapped: false })
);
sunCore.castShadow = false;
sunCore.receiveShadow = false;
sunGroup.add(sunCore);

// ── フレネル発光シェル: リム(縁)が燃えるように光る = 本物の光球感
const sunGlowShell = new THREE.Mesh(
  new THREE.SphereGeometry(7, 64, 64),
  new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0xffb24d) },
      viewVector:{ value: new THREE.Vector3(0,0,1) },
      c: { value: 0.42 }, p: { value: 4.2 },
    },
    vertexShader: `
      uniform vec3 viewVector; uniform float c; uniform float p;
      varying float intensity;
      void main(){
        vec3 vNormal = normalize(normalMatrix * normal);
        vec3 vView   = normalize(normalMatrix * viewVector);
        intensity = pow( max(0.0, c - dot(vNormal, vView)), p );
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform vec3 glowColor; varying float intensity;
      void main(){ gl_FragColor = vec4(glowColor, 1.0) * clamp(intensity,0.0,1.0); }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
);
sunGlowShell.scale.setScalar(1.45);   // 本体より一回り大きいシェル
sunGroup.add(sunGlowShell);

// コロナ用ソフトグロー テクスチャ (放射状)
function makeSunGlowTex(){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128,128,0, 128,128,128);
  g.addColorStop(0.00, 'rgba(255,247,224,1.00)');
  g.addColorStop(0.16, 'rgba(255,236,188,0.92)');
  g.addColorStop(0.40, 'rgba(255,200,128,0.36)');
  g.addColorStop(0.68, 'rgba(255,170,92,0.09)');
  g.addColorStop(1.00, 'rgba(255,150,70,0.00)');
  x.fillStyle = g; x.fillRect(0,0,256,256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SUN_GLOW = makeSunGlowTex();
// 内コロナ (濃いめ) + 外コロナ (広く薄い) の 2 層
const coronaIn = new THREE.Sprite(new THREE.SpriteMaterial({
  map: SUN_GLOW, color: 0xffffff, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, toneMapped: false,
}));
coronaIn.scale.set(24, 24, 1);
sunGroup.add(coronaIn);
const coronaOut = new THREE.Sprite(new THREE.SpriteMaterial({
  map: SUN_GLOW, color: 0xffcf94, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.42, toneMapped: false,
}));
coronaOut.scale.set(52, 52, 1);
sunGroup.add(coronaOut);

// 太陽 → カメラ方向 (フレネルシェルの視線ベクトル更新に使用)
const _sunToCam = new THREE.Vector3();
const amb = new THREE.AmbientLight(0xffffff, 0);   // 白色アンビでフラットに明るく
scene.add(amb);
// 目標値 — 暗くないように強め. emissive 0.55 と合わせて全周明るい.
const LIGHT_TARGET = { sun: 2.0, amb: 1.6 };

function rampLighting(dur){
  const t0 = performance.now();
  function step(){
    const t = Math.min(1, (performance.now()-t0)/dur);
    const k = 1 - Math.pow(1-t, 3);
    sun.intensity = LIGHT_TARGET.sun * k;
    amb.intensity = LIGHT_TARGET.amb * k;
    earthMaterial.emissive = new THREE.Color(0x0); // 念のため
    if (t < 1) requestAnimationFrame(step);
  }
  step();
}

/* =====================================================
   緯度経度 → 3D 座標
===================================================== */
function latLonToVec3(lat, lon, radius){
  const phi = (90 - lat) * Math.PI/180;
  const theta = (lon + 180) * Math.PI/180;
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
     (radius * Math.cos(phi)),
     (radius * Math.sin(phi) * Math.sin(theta))
  );
}
function vec3ToLatLon(v){
  const r = v.length();
  const lat = 90 - Math.acos(v.y / r) * 180/Math.PI;
  // x = -r*sin(phi)*cos(theta), z = r*sin(phi)*sin(theta)
  const lon = Math.atan2(v.z, -v.x) * 180/Math.PI - 180;
  let l = lon;
  while (l < -180) l += 360;
  while (l > 180) l -= 360;
  return { lat, lon: l };
}

/* =====================================================
   史実ピン
===================================================== */
const pinsGroup = new THREE.Group();
earth.add(pinsGroup);

const PIN_RADIUS = 2.02;
const pinObjects = []; // {mesh, ev}

// 地球上のドット (史実ピン) は撤去. pinObjects は空のままにして
// hover/pick/applyEventVisibility を無害化する.
pinsGroup.visible = false;

/* =====================================================
   ScrubController (年の中央 state)
===================================================== */
const state = {
  year: 2026,
  rotating: true,
  is3D: true,
  scrubbing: false,
  categoryFilter: null,   // null = all
  lastEra: "",
};

function setYear(y, {silent=false, animated=true} = {}){
  const clamped = Math.max(MIN_YEAR, Math.min(MAX_YEAR, Math.round(y)));
  if (clamped === state.year) return;
  state.year = clamped;
  refreshUIYear();
  if (!silent){
    bumpNotch();
    haptic('tap');
  }
  applyEventVisibility();
}

function nudgeYear(d){ setYear(state.year + d); }

/* =====================================================
   Notch HUD
===================================================== */
const notchEl = document.getElementById('notch');
const notchYearEl = document.getElementById('notchYear');
const notchEraEl  = document.getElementById('notchEra');

let _bumpT = null;
function bumpNotch(){
  notchEl.classList.add('bump');
  clearTimeout(_bumpT);
  _bumpT = setTimeout(()=> notchEl.classList.remove('bump'), 180);
}

function refreshUIYear(){
  notchYearEl.textContent = formatYear(state.year);
  const era = eraForYear(state.year);
  if (era){
    notchEraEl.innerHTML = `${era.ja} <span class="romaji">${era.ro}</span>`;
  } else {
    notchEraEl.innerHTML = `先史 <span class="romaji">Prehistoric</span>`;
  }
  refreshEraRail();
  refreshWheelReadout();
}

notchEl.addEventListener('click', e => {
  if (e.target.closest('.expanded-pane')) return;  // 中の操作は無視
  toggleNotchExpand(true);
});
document.getElementById('notchClose').addEventListener('click', e => {
  e.stopPropagation(); toggleNotchExpand(false);
});

/* =====================================================
   EraTimeline (右レール) — iOS 風 ティック + 元号
   img2 の TerraKoku 風: 新しい時代 → 古い時代 (上から下)
===================================================== */
const eraRailScroll = document.getElementById('eraRailScroll');
const eraChips = [];
{
  // img2 の TerraKoku は 上=新しい 下=古い の順
  const reversed = [...ERAS].slice().reverse();
  for (const era of reversed){
    const row = document.createElement('div');
    row.className = 'eraRow';
    row.innerHTML = `<span class="tick"></span><span class="ja">${era.ja}</span>`;
    row.addEventListener('click', ()=>{
      const mid = Math.round((era.s + era.e)/2);
      setYear(mid);
      haptic('confirm');
    });
    eraRailScroll.appendChild(row);
    eraChips.push({ era, el: row });
  }
}
function refreshEraRail(){
  const cur = eraForYear(state.year);
  for (const c of eraChips){
    c.el.classList.toggle('active', cur && cur.ja === c.era.ja);
  }
}

/* =====================================================
   CategoryRail (右下)
===================================================== */
const catRailEl = document.getElementById('catRail');
const catChips = [];
// 化学 を強調 (TerraKoku では化学が rail のメインだった)
const CAT_ORDER = ['chemistry','japan','world','war','culture','science','religion','discovery','politics','economy','geology','astronomy','geography'];
for (const kind of CAT_ORDER){
  const meta = KIND_META[kind];
  if (!meta) continue;
  const chip = document.createElement('div');
  chip.className = 'catChip';
  chip.innerHTML = `<span class="dot" style="background:${meta.css}"></span>${meta.label}`;
  chip.addEventListener('click', ()=>{
    state.categoryFilter = (state.categoryFilter === kind) ? null : kind;
    for (const c of catChips) c.el.classList.toggle('on', c.kind === state.categoryFilter);
    applyEventVisibility();
    haptic('confirm');
  });
  catRailEl.appendChild(chip);
  catChips.push({ kind, el: chip });
}

/* =====================================================
   イベント可視性 — カテゴリチップ非表示なので全プロット常時表示.
   年に近いものは少し大きく / 遠いものは小さく, ただし常に visible.
===================================================== */
function applyEventVisibility(){
  for (const p of pinObjects){
    const dy = Math.abs(p.ev.year - state.year);
    // 近いほど 1.4 倍, 遠くても 0.7 倍以上は確保
    let s;
    if (dy <= 30) s = 1.4;
    else if (dy <= 200) s = 1.4 - (dy-30)/170 * 0.55;
    else s = 0.7;
    p.mesh.visible = true;
    p.mat.opacity = 1.0;
    p.mat.transparent = false;
    p.mesh.scale.setScalar(s);
  }
}

/* =====================================================
   Dynamic Island Expand: 年スライダ
===================================================== */
const yearSlider = document.getElementById('yearSlider');
const ysFill = document.getElementById('ysFill');
const ysTicks = document.getElementById('ysTicks');
const expYearEl = document.getElementById('expYear');
const expEraEl  = document.getElementById('expEra');
const NOTCH_MIN_YEAR = -10000;
const NOTCH_MAX_YEAR = 2030;

// 時代ティックを 1 度だけ描く
(function buildTicks(){
  // 主要時代の開始年だけマーク
  const marks = ERAS.filter(e => e.s >= NOTCH_MIN_YEAR && e.s <= NOTCH_MAX_YEAR);
  const span = NOTCH_MAX_YEAR - NOTCH_MIN_YEAR;
  ysTicks.innerHTML = '';
  for (const m of marks){
    const x = ((m.s - NOTCH_MIN_YEAR) / span) * 100;
    const tk = document.createElement('div'); tk.className='tk'; tk.style.left = x+'%';
    ysTicks.appendChild(tk);
  }
  // BC ラベル / 0 / 1000 / 2026
  [[-10000,'-10k'],[-5000,'-5k'],[0,'0'],[1000,'1000'],[2026,'2026']].forEach(([y,lab])=>{
    const x = ((y - NOTCH_MIN_YEAR) / span) * 100;
    const lb = document.createElement('div'); lb.className='lb'; lb.style.left = x+'%'; lb.textContent = lab;
    ysTicks.appendChild(lb);
  });
})();

function syncSliderToYear(){
  const y = Math.max(NOTCH_MIN_YEAR, Math.min(NOTCH_MAX_YEAR, state.year));
  yearSlider.value = y;
  const pct = ((y - NOTCH_MIN_YEAR) / (NOTCH_MAX_YEAR - NOTCH_MIN_YEAR)) * 100;
  ysFill.style.width = pct + '%';
  expYearEl.textContent = formatYear(state.year);
  const era = eraForYear(state.year);
  expEraEl.innerHTML = era
    ? `${era.ja} <span class="romaji">${era.ro}</span>`
    : `先史 <span class="romaji">Prehistoric</span>`;
}

yearSlider.addEventListener('input', () => {
  const y = parseInt(yearSlider.value, 10);
  setYear(y, { silent: true });
  bumpNotch();
});
yearSlider.addEventListener('change', () => haptic('confirm'));

// ── 上下スワイプでもスライダを動かす. 0.3s 滑らかに到達.
(function attachVerticalSwipe(){
  const wrap = document.querySelector('.yearSliderWrap');
  let active = false, startY = 0, startX = 0, startYear = 0, mode = null;
  let pid = null;
  let easeTarget = null, easeFrom = null, easeT0 = 0, easeRaf = null;

  function startEase(toYear){
    cancelAnimationFrame(easeRaf);
    easeFrom = state.year;
    easeTarget = toYear;
    easeT0 = performance.now();
    const dur = 300;
    function step(){
      const t = Math.min(1, (performance.now()-easeT0)/dur);
      const k = 1 - Math.pow(1-t, 3);
      const y = Math.round(easeFrom + (easeTarget - easeFrom)*k);
      setYear(y, { silent:true });
      if (t < 1) easeRaf = requestAnimationFrame(step);
    }
    easeRaf = requestAnimationFrame(step);
  }

  wrap.addEventListener('pointerdown', e => {
    if (!notchEl.classList.contains('expanded')) return;
    active = true; pid = e.pointerId;
    startY = e.clientY; startX = e.clientX; startYear = state.year;
    mode = null;
    wrap.setPointerCapture(pid);
  });
  wrap.addEventListener('pointermove', e => {
    if (!active) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!mode){
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5){
        mode = (Math.abs(dy) > Math.abs(dx)) ? 'v' : 'h';
      }
    }
    if (mode === 'v'){
      e.preventDefault();
      // 上スワイプ = 未来へ. 1px = 12 年.
      const delta = -dy * 12;
      const target = Math.max(NOTCH_MIN_YEAR, Math.min(NOTCH_MAX_YEAR, startYear + Math.round(delta)));
      setYear(target, { silent: true });
    }
  });
  function endSwipe(){
    if (!active) return;
    if (pid != null) try { wrap.releasePointerCapture(pid); } catch(_){}
    active = false; pid = null;
    if (mode === 'v') haptic('confirm');
    mode = null;
  }
  wrap.addEventListener('pointerup', endSwipe);
  wrap.addEventListener('pointercancel', endSwipe);

  // ホイール (trackpad 2 本指縦) でも 0.3s 滑らかに
  wrap.addEventListener('wheel', e => {
    if (!notchEl.classList.contains('expanded')) return;
    e.preventDefault();
    const delta = -e.deltaY * 6;
    const target = Math.max(NOTCH_MIN_YEAR, Math.min(NOTCH_MAX_YEAR, state.year + Math.round(delta)));
    startEase(target);
  }, { passive:false });
})();

function toggleNotchExpand(force){
  const want = force === undefined ? !notchEl.classList.contains('expanded') : force;
  notchEl.classList.toggle('expanded', want);
  if (want){
    syncSliderToYear();
    haptic('confirm');
  }
}

// 旧: wheel overlay 系は廃止. 既存の wheelOverlay 要素も hide.
{
  const w = document.getElementById('wheelOverlay');
  if (w) w.remove();
}
// 旧 wheel ベース identifiers は no-op 化
function toggleWheel(force){ toggleNotchExpand(force); }
function refreshWheelReadout(){ syncSliderToYear(); }
function syncWheelToYear(){ syncSliderToYear(); }

// (旧 YearWheel column UI は撤去 — Dynamic Island expand スライダで代替)

/* =====================================================
   TimeMachine Stack
===================================================== */
const stackOverlay = document.getElementById('stackOverlay');
const stackInner = document.getElementById('stackInner');
const stackUp = document.getElementById('stackUp');
const stackDown = document.getElementById('stackDown');
const stackCounter = document.getElementById('stackCounter');
const stackClose = document.getElementById('stackClose');

let stackCards = [];
let stackFocus = 0;

function openTimeMachine(events){
  if (!events.length){
    // 周辺イベントを採用
    events = nearestEvents(state.year, 7);
  }
  stackCards = events;
  stackFocus = 0;
  renderStack();
  stackOverlay.classList.add('show');
  haptic('confirm');
}
function closeTimeMachine(){
  stackOverlay.classList.remove('show');
}

function renderStack(){
  stackInner.innerHTML = '';
  stackCards.forEach((ev, idx) => {
    const dz = idx - stackFocus;
    const isFocus = idx === stackFocus;
    const yOff = dz * 48;
    const sc = isFocus ? 1.0 : (1 - Math.abs(dz)*0.06);
    const op = isFocus ? 1 : Math.max(0.18, 1 - Math.abs(dz)*0.22);
    const rot = isFocus ? 0 : dz * -3.4;
    const card = document.createElement('div');
    card.className = 'tmCard' + (isFocus ? ' focus':'');
    card.style.transform = `translate(-50%, calc(-50% + ${yOff}px)) scale(${sc}) rotateX(${rot}deg)`;
    card.style.top = '50%';
    card.style.opacity = op;
    card.style.zIndex = 100 - Math.abs(dz);
    const meta = KIND_META[ev.kind] || {label:'', css:'#fff'};
    card.innerHTML = `
      <div class="year">${formatYear(ev.year)}　<span class="dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${meta.css};margin:0 4px 0 4px;"></span>${meta.label}<span class="focusChip">FOCUS</span></div>
      <div class="title">${escapeHtml(ev.title)}</div>
      <div class="summary">${escapeHtml(ev.summary)}</div>
      <div class="link">🔗<a href="${ev.url}" target="_blank" rel="noopener">${ev.url}</a></div>
    `;
    card.addEventListener('click', ()=>{
      stackFocus = idx;
      renderStack();
      haptic('snap');
      // 該当年へジャンプ
      setYear(ev.year);
      // ピンへフォーカス
      flyTo(ev.lat, ev.lon);
    });
    stackInner.appendChild(card);
  });
  stackCounter.textContent = `${stackFocus+1} / ${stackCards.length}`;
  stackUp.disabled = stackFocus <= 0;
  stackDown.disabled = stackFocus >= stackCards.length-1;
}
function stepStack(d){
  const n = Math.max(0, Math.min(stackCards.length-1, stackFocus+d));
  if (n !== stackFocus){
    stackFocus = n;
    renderStack();
    haptic('snap');
  }
}
stackUp.addEventListener('click', ()=> stepStack(-1));
stackDown.addEventListener('click', ()=> stepStack(1));
stackClose.addEventListener('click', closeTimeMachine);
stackOverlay.addEventListener('click', e => { if (e.target === stackOverlay) closeTimeMachine(); });

// 上下スワイプ / トラックパッド縦スクロール で stepStack. 連続発火は 500ms スロットル.
(function attachStackSwipe(){
  let lastStep = 0;
  function trySwitch(dir){
    const now = performance.now();
    if (now - lastStep < 500) return;
    lastStep = now;
    stepStack(dir);
  }
  // wheel (PC スクロール / trackpad)
  stackInner.addEventListener('wheel', e => {
    if (!stackOverlay.classList.contains('show')) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < 8) return;
    trySwitch(e.deltaY > 0 ? 1 : -1);
  }, { passive:false });
  // pointer swipe
  let pid = null, startY = 0, accY = 0, active = false;
  stackInner.addEventListener('pointerdown', e => {
    if (!stackOverlay.classList.contains('show')) return;
    active = true; pid = e.pointerId; startY = e.clientY; accY = 0;
    try { stackInner.setPointerCapture(pid); } catch(_){}
  });
  stackInner.addEventListener('pointermove', e => {
    if (!active) return;
    accY = e.clientY - startY;
    if (Math.abs(accY) > 56){
      trySwitch(accY < 0 ? 1 : -1);
      startY = e.clientY;  // 続けて swipe で連続切替
      accY = 0;
    }
  });
  function endSwipe(){
    if (!active) return;
    try { stackInner.releasePointerCapture(pid); } catch(_){}
    active = false; pid = null; accY = 0;
  }
  stackInner.addEventListener('pointerup', endSwipe);
  stackInner.addEventListener('pointercancel', endSwipe);
  // キーボード
  document.addEventListener('keydown', e => {
    if (!stackOverlay.classList.contains('show')) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); trySwitch(1); }
    if (e.key === 'ArrowUp'){ e.preventDefault(); trySwitch(-1); }
  });
})();
// 縦スワイプを邪魔しないために stackInner の touch-action を CSS で固定
stackInner.style.touchAction = 'none';

function nearestEvents(year, n){
  const sorted = EVENTS
    .filter(ev => !state.categoryFilter || ev.kind === state.categoryFilter)
    .map(ev => ({ev, d: Math.abs(ev.year - year)}))
    .sort((a,b)=>a.d-b.d)
    .slice(0, n)
    .map(x=> x.ev);
  return sorted;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

/* =====================================================
   Saved Regions (localStorage)
===================================================== */
const SAVED_KEY = 'TerraKokuWeb.SavedSpots.v1';
const savedOverlay = document.getElementById('savedOverlay');
const savedList = document.getElementById('savedList');
const savedBadge = document.getElementById('savedBadge');
const savedClose = document.getElementById('savedClose');

function loadSaved(){
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch(e){ return []; }
}
function writeSaved(arr){
  localStorage.setItem(SAVED_KEY, JSON.stringify(arr));
  refreshSavedBadge();
}
function refreshSavedBadge(){
  const arr = loadSaved();
  if (arr.length){
    savedBadge.style.display = 'block';
    savedBadge.textContent = arr.length;
  } else {
    savedBadge.style.display = 'none';
  }
}
function saveCurrent(){
  const center = currentCenterLatLon();
  const name = prompt(`現在地を保存。場所名: (例: アレクサンドリア)`);
  if (!name) return;
  const arr = loadSaved();
  arr.unshift({
    id: 'sp-'+Date.now(),
    name, lat: center.lat, lon: center.lon, year: state.year,
    summary: `${name} ${formatYear(state.year)}`,
    savedAt: Date.now(),
  });
  writeSaved(arr);
  haptic('confirm');
}
function renderSavedList(){
  const arr = loadSaved();
  savedList.innerHTML = '';
  if (!arr.length){
    savedList.innerHTML = '<div class="savedEmpty">保存済みなし<br><small>左下の📌で現在地を保存</small></div>';
    return;
  }
  for (const sp of arr){
    const row = document.createElement('div');
    row.className = 'savedItem';
    row.innerHTML = `<div class="info"><div class="name">${escapeHtml(sp.name)}</div><div class="meta">${formatYear(sp.year)} ・ ${sp.lat.toFixed(1)}, ${sp.lon.toFixed(1)}</div></div><div class="del" data-id="${sp.id}">🗑</div>`;
    row.querySelector('.info').addEventListener('click', ()=>{
      flyTo(sp.lat, sp.lon, 1.6);
      setYear(sp.year);
      toggleSaved(false);
    });
    row.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      writeSaved(loadSaved().filter(x => x.id !== sp.id));
      renderSavedList();
    });
    savedList.appendChild(row);
  }
}
function toggleSaved(force){
  const open = force===undefined ? !savedOverlay.classList.contains('show') : force;
  if (open){
    renderSavedList();
    savedOverlay.classList.add('show');
    haptic('snap');
  } else {
    savedOverlay.classList.remove('show');
  }
}
savedClose.addEventListener('click', ()=> toggleSaved(false));
savedOverlay.addEventListener('click', e => { if (e.target === savedOverlay) toggleSaved(false); });

/* =====================================================
   Camera / 視点
===================================================== */
// 拡大しすぎ防止: 3D は globe が画面上半分くらいに収まる距離.
// 2D は全球が見渡せる引き.
const MIN_ZOOM_DIST     = 6.5;   // これより近づけない (拡大しすぎ防止)
const MAX_ZOOM_DIST     = 28;
const DEFAULT_ZOOM_DIST = 9.0;   // 3D 規定 — globe が画面上半分に収まる
const INTRO_ZOOM_DIST   = 14.0;  // 起動時は引きから始めて 3D に寄る
const DEFAULT_TILT      = 0.35;  // 約 20° の控えめ tilt

const TWO_D_DIST = 14.0;
const TWO_D_FOV  = 25;

const camCtl = {
  rot: { x: 0, y: 0 },
  dist: INTRO_ZOOM_DIST,
  targetDist: INTRO_ZOOM_DIST,
  targetRot: { x: 0, y: 0 },
  fov: TWO_D_FOV,
  targetFov: TWO_D_FOV,
  showcase: 0,   // ショーケース首振りの重み (操作で 0、自動回転で 1)
};
camera.position.set(0, 0, camCtl.dist);
camera.fov = camCtl.fov;
camera.updateProjectionMatrix();

function currentCenterLatLon(){
  // 視点正面方向の単位ベクトル (world)
  const cam = camera.position.clone().normalize();
  // earth は回転している. earth ローカルで cam の前方を求める.
  const inv = new THREE.Matrix4().copy(earth.matrixWorld).invert();
  const local = cam.clone().applyMatrix4(inv).normalize();
  return vec3ToLatLon(local);
}

function flyTo(lat, lon, dist){
  // tick() の Euler 設定順 (XYZ) と整合: latLonToVec3 を逆解析した結果
  //   ry = atan2(sin(phi)*cos(theta), sin(phi)*sin(theta))
  //   rx = lat (rad)
  // で点 (lat,lon) が camera 方向 (0,0,1) に来る.
  const phi   = (90 - lat) * Math.PI/180;
  const theta = (lon + 180) * Math.PI/180;
  const px = -(Math.sin(phi) * Math.cos(theta));
  const py =  (Math.cos(phi));
  const pz =  (Math.sin(phi) * Math.sin(theta));
  const ry = Math.atan2(-px, pz);
  const horiz = Math.sqrt(px*px + pz*pz);
  const rx = Math.atan2(py, horiz);
  // shortest path で targetRot.y を合わせる
  let cy = camCtl.targetRot.y;
  let dy = (ry - cy) % (Math.PI*2);
  if (dy >  Math.PI) dy -= Math.PI*2;
  if (dy < -Math.PI) dy += Math.PI*2;
  camCtl.targetRot.y = cy + dy;
  camCtl.targetRot.x = rx;
  camCtl.targetDist  = Math.max(MIN_ZOOM_DIST, dist || 8.0);
}

/* =====================================================
   入力: ドラッグ回転 / ホイールズーム
===================================================== */
let mouseDown = false;
let lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.target !== renderer.domElement) return;
  mouseDown = true; lastX = e.clientX; lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', e => {
  mouseDown = false;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch(_) {}
  endForceTouch();
});
renderer.domElement.addEventListener('pointercancel', () => { mouseDown = false; endForceTouch(); });
renderer.domElement.addEventListener('pointermove', e => {
  if (!mouseDown) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  camCtl.targetRot.y += dx * 0.005;
  camCtl.targetRot.x += dy * 0.005;
  camCtl.targetRot.x = Math.max(-1.3, Math.min(1.3, camCtl.targetRot.x));
});
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  camCtl.targetDist = Math.max(MIN_ZOOM_DIST, Math.min(MAX_ZOOM_DIST, camCtl.targetDist + e.deltaY * 0.008));
}, { passive: false });

/* =====================================================
   ForceTouch (Mac) ≥ 1.8 → scrub
===================================================== */
const ftRing = document.getElementById('ftRing');
let ftActive = false;
let ftScrubLoopId = null;
let ftMouseX = window.innerWidth/2;
let ftPressure = 0;

document.addEventListener('webkitmouseforcechanged', e => {
  ftPressure = e.webkitForce || 0;
  ftMouseX = e.clientX;
  ftRing.style.left = e.clientX + 'px';
  ftRing.style.top = e.clientY + 'px';
  if (ftPressure >= 1.0){
    ftRing.classList.add('show');
    ftRing.classList.toggle('arming', ftPressure < 1.8);
  } else {
    ftRing.classList.remove('show');
  }
  // 1.8 で始動 (Force Click 強度)
  if (ftPressure >= 1.8 && !ftActive){
    ftActive = true;
    state.scrubbing = true;
    notchEl.classList.add('scrubbing');
    haptic('deepPress');
    startScrubLoop();
  } else if (ftPressure < 1.2 && ftActive){
    endForceTouch();
  }
}, { passive:true });

function endForceTouch(){
  if (!ftActive) return;
  ftActive = false;
  state.scrubbing = false;
  notchEl.classList.remove('scrubbing');
  ftRing.classList.remove('show');
  if (ftScrubLoopId){ cancelAnimationFrame(ftScrubLoopId); ftScrubLoopId = null; }
  haptic('confirm');
}

function startScrubLoop(){
  let last = performance.now();
  function tick(){
    if (!ftActive){ ftScrubLoopId = null; return; }
    const now = performance.now();
    const dt = (now - last)/1000;
    last = now;
    // pressure 1.8〜3 → 0〜1 に正規化
    const norm = Math.min(1, Math.max(0, (ftPressure - 1.8) / 1.2));
    const speed = Math.pow(norm, 1.6) * 200;
    const dir = ftMouseX >= window.innerWidth/2 ? 1 : -1;
    setYear(state.year + Math.round(speed * dt * dir), {silent:true});
    bumpNotch();
    ftScrubLoopId = requestAnimationFrame(tick);
  }
  ftScrubLoopId = requestAnimationFrame(tick);
}

/* =====================================================
   Hover / Click on pins (raycast)
===================================================== */
const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.04 };
const mouseV = new THREE.Vector2();
let hoverPin = null;
const pinHoverHUD = document.getElementById('pinHoverHUD');
const pinHoverText = document.getElementById('pinHoverText');
const pinHoverIcon = document.getElementById('pinHoverIcon');

renderer.domElement.addEventListener('pointermove', e => {
  mouseV.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseV.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
function pickPin(){
  raycaster.setFromCamera(mouseV, camera);
  const hits = raycaster.intersectObjects(pinsGroup.children, false);
  // 表示中だけ
  for (const h of hits){
    if (h.object.visible) return h.object;
  }
  return null;
}
function updateHover(){
  if (mouseDown || ftActive) { setHoverPin(null); return; }
  const p = pickPin();
  setHoverPin(p);
}
function setHoverPin(p){
  if (p === hoverPin) return;
  if (hoverPin) hoverPin.scale.setScalar(0.6 + (hoverPin.material.opacity||1)*0.9);
  hoverPin = p;
  if (p){
    p.scale.setScalar(1.6);
    const ev = p.userData.ev;
    const meta = KIND_META[ev.kind] || {css:'#fff'};
    pinHoverHUD.classList.add('show');
    pinHoverIcon.style.color = meta.css;
    pinHoverText.textContent = `${formatYear(ev.year)} · ${ev.title}`;
    haptic('hover');
  } else {
    pinHoverHUD.classList.remove('show');
  }
}
renderer.domElement.addEventListener('click', e => {
  const p = pickPin();
  if (!p) return;
  // 周辺イベントで TimeMachine
  const around = EVENTS
    .filter(ev => !state.categoryFilter || ev.kind === state.categoryFilter)
    .filter(ev => Math.abs(ev.year - p.userData.ev.year) <= 200 || ev === p.userData.ev)
    .sort((a,b)=> Math.abs(a.year - p.userData.ev.year) - Math.abs(b.year - p.userData.ev.year))
    .slice(0, 7);
  // フォーカス先頭は picked
  const reordered = [p.userData.ev, ...around.filter(e => e !== p.userData.ev)].slice(0,7);
  openTimeMachine(reordered);
});

/* =====================================================
   Dock 操作
===================================================== */
document.getElementById('btnClock').addEventListener('click', ()=> toggleNotchExpand());
document.getElementById('btnMode').addEventListener('click', e => {
  state.is3D = !state.is3D;
  e.target.textContent = state.is3D ? '3D' : '2D';
  // 2D: 大きく寄って fov を狭め平らに見せる. 3D: 距離 7 + 緯度 +0.15rad で globe.
  if (state.is3D){
    // 3D: 控えめ tilt, globe が上半分くらいに収まる距離
    camCtl.targetRot.x = DEFAULT_TILT;
    camCtl.targetDist = DEFAULT_ZOOM_DIST;
    camCtl.targetFov  = 36;
  } else {
    // 2D: 全球が見渡せる引き
    camCtl.targetRot.x = 0;
    camCtl.targetDist = TWO_D_DIST;
    camCtl.targetFov  = TWO_D_FOV;
  }
  haptic('confirm');
});
document.getElementById('btnStack').addEventListener('click', ()=> openTimeMachine(nearestEvents(state.year, 7)));
document.getElementById('btnSaveCurrent').addEventListener('click', saveCurrent);
document.getElementById('btnSaved').addEventListener('click', ()=> toggleSaved());

/* =====================================================
   Search Pill (場所/年/事件)
===================================================== */
const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const q = searchInput.value.trim();
  if (!q) return;
  // 1) 年指定 (数字 / B.C. / A.D. / 紀元前)
  const ymatch = q.match(/^(B\.?C\.?|A\.?D\.?|紀元前)?\s*(\d{1,5})/i);
  if (ymatch){
    let y = parseInt(ymatch[2], 10);
    if (/B\.?C\.?|紀元前/i.test(ymatch[1] || '')) y = -y;
    setYear(y);
    haptic('confirm');
    return;
  }
  // 2) 時代名 (旧石器/縄文/...)
  const era = ERAS.find(e => e.ja === q || e.ro.toLowerCase() === q.toLowerCase());
  if (era){
    setYear(Math.round((era.s + era.e)/2));
    haptic('confirm');
    return;
  }
  // 3) イベント検索 (title/summary 部分一致)
  const found = EVENTS.find(ev => ev.title.includes(q) || ev.summary.includes(q));
  if (found){
    setYear(found.year);
    flyTo(found.lat, found.lon, 4.5);
    haptic('confirm');
    setTimeout(()=> openTimeMachine([found, ...nearestEvents(found.year, 6).filter(e=>e!==found)].slice(0,7)), 950);
    return;
  }
  haptic('tap');
});

/* =====================================================
   Weather HUD (右レール内) + region globe icon
===================================================== */
const weatherEl = document.getElementById('railWeather');
const weatherTemp = weatherEl.querySelector('.temp');
const regionIconEl = document.getElementById('regionIcon');
const regionImgs = {
  us:   regionIconEl.querySelector('img[data-key="us"]'),
  afr:  regionIconEl.querySelector('img[data-key="afr"]'),
  asia: regionIconEl.querySelector('img[data-key="asia"]'),
  aust: regionIconEl.querySelector('img[data-key="aust"]'),
};
let currentRegionKey = null;

function regionKeyFor(lat, lon){
  // Americas: lon < -30
  if (lon < -30) return 'us';
  // Europe + Western Africa: -30 <= lon < 25
  if (lon < 25) return 'afr';
  // 北部 (Ukraine→東アジア): lat >= 30
  if (lat >= 30) return 'asia';
  // 残り (中東/インド/SE アジア/オーストラリア): 中東&aust
  return 'aust';
}

function setRegionIcon(key, {boot=false} = {}){
  if (key === currentRegionKey) return;
  currentRegionKey = key;
  for (const k in regionImgs){
    regionImgs[k].classList.toggle('show', k === key);
  }
  if (boot){
    regionIconEl.classList.add('bootIn');
    setTimeout(()=> regionIconEl.classList.remove('bootIn'), 1000);
  }
}

const weatherCache = new Map();
async function fetchWeather(lat, lon){
  const key = `${Math.round(lat)},${Math.round(lon)}`;
  const cached = weatherCache.get(key);
  if (cached && (Date.now() - cached.t < 30*60*1000)) return cached.v;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
    const r = await fetch(url);
    const j = await r.json();
    const c = j.current;
    const v = { temp: Math.round(c.temperature_2m), emoji: wmoEmoji(c.weather_code) };
    weatherCache.set(key, { v, t: Date.now() });
    return v;
  } catch(e){ return null; }
}
function wmoEmoji(code){
  if (code === 0) return '☀️';
  if (code === 1) return '🌤';
  if (code === 2) return '⛅️';
  if (code === 3) return '☁️';
  if ([45,48].includes(code)) return '🌫';
  if ([51,53,55,80,81,82].includes(code)) return '🌦';
  if ([56,57,61,63,65,66,67].includes(code)) return '🌧';
  if ([71,73,75,77,85,86].includes(code)) return '🌨';
  if ([95,96,99].includes(code)) return '⛈';
  return '🌍';
}

let lastWeatherFetch = 0;
let lastWeatherKey = '';
async function refreshWeather(force=false){
  const center = currentCenterLatLon();
  // 中心地が変わるたびに地域地球儀を 0.5s 切替
  setRegionIcon(regionKeyFor(center.lat, center.lon));
  const key = `${Math.round(center.lat)},${Math.round(center.lon)}`;
  const now = Date.now();
  if (!force && key === lastWeatherKey && now - lastWeatherFetch < 7000) return;
  lastWeatherKey = key;
  lastWeatherFetch = now;
  weatherEl.classList.add('loading');
  const v = await fetchWeather(center.lat, center.lon);
  if (!v){ weatherEl.classList.remove('loading'); return; }
  weatherTemp.textContent = `${v.temp}°C`;
  weatherEl.classList.remove('loading');
}

// camera が動いたら 200ms ごとに region icon を再評価 (天気 fetch とは独立)
setInterval(()=>{
  const c = currentCenterLatLon();
  setRegionIcon(regionKeyFor(c.lat, c.lon));
}, 200);
setInterval(()=> refreshWeather(), 7000);
setTimeout(()=> refreshWeather(true), 800);
weatherEl.addEventListener('click', ()=> refreshWeather(true));

/* =====================================================
   SmartHaptic 代替 (Vibration API + 視覚)
===================================================== */
function haptic(kind){
  const map = { tap:8, snap:14, confirm:22, hover:4, deepPress:40 };
  const d = map[kind] || 8;
  if (navigator.vibrate) try { navigator.vibrate(d); } catch(_) {}
  // 視覚的: bumpNotch 軽く
  if (kind === 'snap' || kind === 'confirm' || kind === 'deepPress') bumpNotch();
}

/* =====================================================
   Keyboard
===================================================== */
window.addEventListener('keydown', e => { if(!document.body.classList.contains('globe-open'))return;
  if (document.activeElement === searchInput) return;
  switch(e.key){
    case 'ArrowLeft':  nudgeYear(e.shiftKey ? -50 : -1); break;
    case 'ArrowRight': nudgeYear(e.shiftKey ?  50 :  1); break;
    case 'ArrowUp':    nudgeYear(e.shiftKey ? 500 : 10); break;
    case 'ArrowDown':  nudgeYear(e.shiftKey ?-500 :-10); break;
    case 'c': case 'C': openTimeMachine(nearestEvents(state.year, 7)); break;
    case 'y': case 'Y': toggleWheel(); break;
    case 'b': case 'B': toggleSaved(); break;
    case 's': case 'S': saveCurrent(); break;
    case 'Escape':
      if (false) toggleWheel(false);
      else if (stackOverlay.classList.contains('show')) closeTimeMachine();
      else if (savedOverlay.classList.contains('show')) toggleSaved(false);
      break;
  }
});

/* =====================================================
   Resize
===================================================== */
function fitViewport(){
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);   // false: インライン style を書かない → CSS の 100%×100% を尊重
}
window.addEventListener('resize', fitViewport);
window.addEventListener('orientationchange', ()=>{ fitViewport(); setTimeout(fitViewport,300); });
// iOS は PWA 全画面化やバー出入りを visualViewport で通知する
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitViewport);
// 起動直後は innerHeight が全画面化前の値のことがあるため、複数回 再フィット
window.addEventListener('load', ()=>{ fitViewport(); [120,360,800].forEach(t=>setTimeout(fitViewport,t)); });
fitViewport();

/* =====================================================
   Render loop
===================================================== */
let cloudLowDrift = 0, cloudMidDrift = 0, cloudHiDrift = 0;
function tick(){
  requestAnimationFrame(tick);
  if(document.hidden) return;   // バックグラウンド時は描画スキップ＝電池/CPU節約(rAFは継続して可視復帰で即再開)
  if(window.__globePaused) return;   // 背景が地球儀でない(白/カスタム画像)ときは描画スキップ＝電池節約。rAFは上で継続＝globe選択で即再開
  // 慣性
  camCtl.rot.x += (camCtl.targetRot.x - camCtl.rot.x) * 0.12;
  camCtl.rot.y += (camCtl.targetRot.y - camCtl.rot.y) * 0.12;
  camCtl.dist  += (camCtl.targetDist  - camCtl.dist)  * 0.10;
  const newFov = camCtl.fov + (camCtl.targetFov - camCtl.fov) * 0.10;
  if (Math.abs(newFov - camCtl.fov) > 0.02){
    camCtl.fov = newFov;
    camera.fov = camCtl.fov;
    camera.updateProjectionMatrix();
  }
  camera.position.z = camCtl.dist;
  // AirPods Max 風ショーケース回転: なめらかな連続スピン + ゆるやかな首振りチルト
  const auto = state.rotating && !mouseDown && !ftActive;
  camCtl.showcase += (((auto?1:0) - camCtl.showcase) * 0.04);   // 操作中は滑らかに 0 へ
  if (auto){
    camCtl.targetRot.y += 0.0022;                               // ターンテーブルの連続スピン
  }
  // 回転に合わせて上下に首を振り、上面/側面を順に見せる (ターンテーブル的演出)
  const nod = Math.sin(performance.now() * 0.00034) * 0.22 * camCtl.showcase;
  earth.rotation.x = camCtl.rot.x + nod;
  earth.rotation.y = camCtl.rot.y;
  // 雲は 3 層を別速度で流す (パララックス感)
  cloudLowDrift += 0.00060;
  cloudMidDrift += 0.00040;
  cloudHiDrift  += 0.00130;
  cloudsLow.rotation.x = camCtl.rot.x + nod;
  cloudsLow.rotation.y = camCtl.rot.y + cloudLowDrift;
  cloudsMid.rotation.x = camCtl.rot.x + nod;
  cloudsMid.rotation.y = camCtl.rot.y - cloudMidDrift * 0.7;
  cloudsHi.rotation.x  = camCtl.rot.x + nod;
  cloudsHi.rotation.y  = camCtl.rot.y - cloudHiDrift;
  // 星: 微速回転で空の流れ. 微細層は別速度でパララックス.
  stars.rotation.y     += 0.00006;
  tinyStars.rotation.y += 0.00010;
  milkyWay.rotation.y  += 0.00002;
  // 太陽: 光球をゆっくり自転 + コロナの微脈動 + フレネルシェルの視線更新
  sunCore.rotation.y += 0.0006;
  const cs = 52 + Math.sin(performance.now() * 0.0012) * 3;
  coronaOut.scale.set(cs, cs, 1);
  _sunToCam.copy(camera.position).sub(sunGroup.position);
  sunGlowShell.material.uniforms.viewVector.value = _sunToCam;
  // 月: 地球を公転 (潮汐ロックは親子関係で自動). 太陽光で自然に満ち欠け.
  moonOrbit.rotation.y += MOON_ORBIT_SPEED;
  updateHover();
  renderer.render(scene, camera);
}
tick();

/* ライブ翻訳の lat/lon→画面投影に使うため globe 内部を公開 */
window.__globe = { THREE: THREE, scene: scene, camera: camera, earth: earth, renderer: renderer, R: 2 };

/* =====================================================
   起動初期化
===================================================== */
refreshUIYear();
refreshEraRail();
applyEventVisibility();
refreshSavedBadge();

// 起動シーケンス: 1) 暗 (light=0, dist 近く, fov 狭い "2D 風")
//                2) 1.0s かけて light ramp + bootMask フェード
//                3) 0.4s 後 → 0.9s で 2D→3D へ寄って globe へ. (dist 3 → 7, fov 22 → 40)
//                4) UI レイヤフェードイン
(function bootSequence(){
  const bootMask = document.getElementById('bootMask');
  const uiLayer  = document.getElementById('uiLayer');
  // 起動暗
  rampLighting(1000);
  setTimeout(()=> bootMask.classList.add('lit'), 50);
  setTimeout(()=> uiLayer.classList.add('lit'), 350);
  // 起動: 2D 引きビュー → 0.6s 後に 3D へ寄せる (拡大しすぎず globe を上半分に)
  setTimeout(()=>{
    camCtl.targetDist  = DEFAULT_ZOOM_DIST;
    camCtl.targetRot.x = DEFAULT_TILT;
    camCtl.targetFov   = 36;
    state.is3D = true;
    document.getElementById('btnMode').textContent = '3D';
    haptic('confirm');
  }, 600);
  // 年スクラブ intro (古→現)
  setTimeout(()=>{
    const start = performance.now();
    const dur = 1400;
    setYear(-3000, {silent:true, animated:false});
    function step(){
      const t = Math.min(1, (performance.now()-start)/dur);
      const k = 1 - Math.pow(1-t, 3);
      const y = Math.round(-3000 + (2026 - (-3000))*k);
      setYear(y, {silent:true, animated:false});
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, 900);
})();

