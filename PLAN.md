# FLIGHT — Gerçek Dünya Üzerinde Uçuş + Sürüş + Gemi Oyunu: Uygulama Planı

> **Bu doküman ne?** hop.earth benzeri, tarayıcıda çalışan, gerçek uydu görüntüleri ve gerçek
> topografya üzerinde geçen bir oyunun **eksiksiz, adım adım uygulama planı**. Ana odak **uçak**,
> yanında **araba** ve **gemi**. Bu plan bir kodlama ajanına (Claude Opus) devredilmek üzere
> yazıldı: her adımın dosyaları, formülleri, veri kaynakları ve kabul kriterleri belirtildi.
>
> **Uygulayıcı ajan için tek cümlelik özet:** Fazları sırayla uygula, her adımı commit'le,
> kabul kriterini doğrulamadan bir sonraki adıma geçme, ilerlemeyi bu dosyadaki kutucuklarda işaretle.

---

## İçindekiler

1. [Vizyon ve kapsam](#1-vizyon-ve-kapsam)
2. [Referans analizi: hop.earth ne yapıyor](#2-referans-analizi)
3. [Teknoloji seçimi](#3-teknoloji-seçimi)
4. [Veri kaynakları ve lisanslar](#4-veri-kaynakları-ve-lisanslar)
5. [Koordinat sistemi ve temel matematik](#5-koordinat-sistemi-ve-temel-matematik)
6. [Mimari ve klasör yapısı](#6-mimari-ve-klasör-yapısı)
7. [Fazlar (adım adım yapılacaklar)](#7-fazlar)
   - [Faz 0 — Proje kurulumu](#faz-0)
   - [Faz 1 — Arazi akış motoru (en kritik faz)](#faz-1)
   - [Faz 2 — Uçak](#faz-2)
   - [Faz 3 — Araba](#faz-3)
   - [Faz 4 — Gemi ve su](#faz-4)
   - [Faz 5 — Araç değiştirme ve spawn](#faz-5)
   - [Faz 6 — Gece estetiği (NFS Carbon görünümü)](#faz-6)
   - [Faz 7 — UI/UX: minimap, arama, HUD, ayarlar](#faz-7)
   - [Faz 8 — Oyun modları: checkpoint yarışı](#faz-8)
   - [Faz 9 — Multiplayer (opsiyonel)](#faz-9)
   - [Faz 10 — Performans, mobil, yayın](#faz-10)
8. [Tuş şeması](#8-tuş-şeması)
9. [Riskler ve çözümleri](#9-riskler-ve-çözümleri)
10. [Uygulayıcı ajana (Opus) devir talimatları](#10-devir-talimatları)
11. [Milestone'lar ve efor tahmini](#11-milestonelar-ve-efor-tahmini)

---

## 1. Vizyon ve kapsam

**Tek cümle:** Tarayıcıda aç, dünyanın herhangi bir yerini yaz, oraya ışınlan; gerçek uydu
görüntüsü ve gerçek yükseklik verisi üzerinde **uçakla uç, arabayla sür, gemiyle yüz** —
gece modunda NFS Carbon havasında.

**Öncelik sırası (kullanıcının isteği):**
1. **Uçak** — ana deneyim. Uçuş, üç araç içinde teknik olarak en kolayıdır (çarpışma yalnızca
   "yere değdin mi?" sorgusudur, fizik motoru gerekmez) ve arazi akış motorunu en iyi vitrine
   çıkaran araçtır. İlk oynanabilir demo uçak olacak.
2. **Araba** — hop.earth'ün ana deneyimi; bizde ikinci araç.
3. **Gemi** — su yüzeyi + basit yüzdürme fiziğiyle üçüncü araç.

**Kapsam içinde (v1):** serbest dolaşım, üç araç, anlık araç değiştirme, gece/gündüz,
minimap, yer arama/ışınlanma, checkpoint yarışı (tek oyuncu), paylaşılabilir konum URL'si.

**Kapsam dışında (v1 sonrası):** multiplayer (Faz 9, opsiyonel), 3D binalar, trafik/yapay zeka
araçları, hasar modeli, ekonomi/ilerleme sistemi, VR.

**Hedef platform:** Masaüstü tarayıcı (Chrome/Edge/Firefox/Safari), WebGL2. Orta seviye bir
laptopta 60 fps. Mobil dokunmatik destek Faz 10'da "çalışır" seviyesinde.

---

## 2. Referans analizi

hop.earth (DVLP London) ekran görüntüsünden ve tanıtımından çıkarılanlar:

| Özellik | hop.earth | Bizim plan |
|---|---|---|
| Gerçek dünya, uydu dokusu | ✅ | ✅ aynı yaklaşım (tile streaming) |
| Gerçek topografya | ✅ | ✅ (Terrarium yükseklik tile'ları) |
| Gerçek yollar, yol adları ("La Provençale" etiketi) | ✅ OSM vektör verisi kullanıyor | ✅ OSM Overpass → 3D yol şeridi + isimler |
| Gece modu, sokak lambaları, far/stop ışıkları | ✅ | ✅ Faz 6'nın tamamı buna ayrıldı |
| Minimap (sol altta, OSM tabanlı) | ✅ | ✅ MapLibre GL minimap |
| Araç: araba | ✅ | ✅ + **uçak** + **gemi** (bizim farkımız) |
| Multiplayer yarış | ✅ | Faz 9 (opsiyonel) |
| Tarayıcıda, kurulumsuz | ✅ | ✅ |

**Bizi farklı kılan şey:** üç ortam (hava/kara/deniz) arasında kesintisiz geçiş. "Uç, in,
arabaya geç, sahile sür, gemiye atla" akışı tek dünyada çalışacak.

---

## 3. Teknoloji seçimi

### Önerilen yığın (stack)

| Katman | Seçim | Neden |
|---|---|---|
| Dil | **TypeScript** (strict) | Ajanla geliştirmede tip güvenliği hataları erken yakalar |
| Build | **Vite** | Hızlı dev server, worker/wasm desteği kolay |
| 3D | **Three.js** (güncel sürüm, WebGLRenderer) | Tam şader kontrolü (gece estetiği için şart), hafif, devasa ekosistem |
| Fizik | **Rapier** (`@dimforge/rapier3d-compat`) | WASM, hızlı; hazır `DynamicRayCastVehicleController` (araba) ve heightfield collider (arazi) var. **Yalnızca araba için kullanılır** — uçak ve gemi özel basit fizikle çalışır |
| Post-processing | **`postprocessing`** (npm paketi) | UnrealBloom'dan hızlı, SMAA dahil |
| Minimap | **MapLibre GL JS** | Ücretsiz, raster/vektör OSM tabanı |
| State/UI | Vanilla TS + küçük DOM katmanı | Framework gereksiz; HUD birkaç overlay div + canvas |
| Test | **Vitest** (matematik/fizik birim testleri) + **Playwright** (smoke) | |
| Multiplayer (Faz 9) | Node.js + **Colyseus** (veya uWebSockets.js) | Oda yönetimi hazır |
| Deploy | **Cloudflare Pages** + **Cloudflare Worker** (tile proxy/cache) | Ücretsiz katman geniş, proxy ile API anahtarları gizlenir |

### Neden CesiumJS değil?

CesiumJS hazır globe + terrain streaming verir ama: (a) görsel stili oyunlaştırmak (özel şader,
bloom, araç fiziği entegrasyonu) savaşmaya döner, (b) bundle ağır, (c) render pipeline'ı bizim
değil. Biz **kendi quadtree tile motorumuzu** yazacağız (Faz 1) — bu işin en zor parçası ama
~1000 satırlık, iyi tanımlanmış bir problem.
**Kaçış kapısı:** Faz 1 tıkanırsa `three-geo` veya NASA-AMMOS `3d-tiles-renderer` +
Cesium ion terrain'e geçilebilir; bu yüzden dünya modülü arayüz (interface) arkasında yazılacak
(bkz. §6, `HeightSampler` ve `WorldRenderer` arayüzleri).

---

## 4. Veri kaynakları ve lisanslar

> **Uygulayıcı ajan için:** URL şablonları birebir kullanılabilir. `{z}/{x}/{y}` = Web Mercator
> XYZ şeması (y kuzeyden, TMS DEĞİL). Tüm istekler Faz 10'da proxy arkasına alınacak;
> geliştirme sırasında doğrudan çekilebilir.

### 4.1 Yükseklik (terrain)

| Kaynak | URL şablonu | Lisans | Not |
|---|---|---|---|
| **AWS Terrain Tiles (Terrarium)** — ÖNERİLEN | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Ücretsiz, anahtarsız (AWS Open Data) | Max zoom **15**. 256×256 PNG |
| Mapbox Terrain-RGB (alternatif) | `https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=...` | Anahtar gerekli, kota | Daha yüksek çözünürlük bazı bölgelerde |

**Terrarium çözme formülü (metre):**
```
h = (R * 256 + G + B / 256) - 32768
```

**Mapbox Terrain-RGB çözme formülü (yedek):**
```
h = -10000 + (R * 65536 + G * 256 + B) * 0.1
```

### 4.2 Uydu görüntüsü (imagery)

| Kaynak | URL şablonu | Lisans | Not |
|---|---|---|---|
| **Esri World Imagery** | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Attribution şart; kullanım koşullarına dikkat (§9) | Dikkat: yol sırası **z/y/x**. Çoğu yerde z19'a kadar |
| EOX Sentinel-2 Cloudless | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg` | 2016 katmanı CC-BY, yeni yıllar ticari-dışı | Max ~z14, bulutsuz, uçak yüksekliği için güzel |
| MapTiler Satellite | `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=...` | Ücretsiz anahtar + kota | Yayın (production) için en temiz seçenek |

**Strateji:** `ImageryProvider` arayüzü yaz, sağlayıcı tek satır config ile değişsin.
Geliştirmede Esri, yayında MapTiler/Mapbox anahtarıyla. Attribution overlay'i Faz 0'dan itibaren
ekranda dursun (sağ alt köşe, küçük).

### 4.3 Yollar, sokak lambaları, havaalanları (vektör veri)

| Veri | Kaynak | Sorgu |
|---|---|---|
| Yol geometrisi + adları | **Overpass API** `https://overpass-api.de/api/interpreter` | `way[highway~"motorway|trunk|primary|secondary|tertiary|residential|unclassified"]` bbox içinde |
| Sokak lambaları | Overpass | `node[highway=street_lamp]` — az veri olan yerlerde yol tipine göre otomatik dizilim (Faz 6.4) |
| Havaalanı/pist (uçak spawn) | **OurAirports CSV** `https://davidmegginson.github.io/ourairports-data/airports.csv` | Public domain; büyük havaalanlarını derleme zamanında JSON'a gömeriz |
| Su poligonları (göller, ileri seviye) | `https://osmdata.openstreetmap.de/data/water-polygons.html` | v1'de gerekmez (bkz. Faz 4.4) |

**Overpass kuralları:** istekleri bbox başına önbelleğe al (IndexedDB), saniyede 1'den fazla
istek atma, `[timeout:25]` kullan. Yoğun kullanım Faz 10'da kendi extract'imize taşınır.

### 4.4 Coğrafi arama (geocoding)

| Kaynak | URL | Not |
|---|---|---|
| **Nominatim** | `https://nominatim.openstreetmap.org/search?q={q}&format=jsonv2&limit=5` | Kullanım politikası: max 1 istek/sn, `User-Agent`/`Referer` belirt, sonuçları önbelleğe al |
| Photon (alternatif) | `https://photon.komoot.io/api/?q={q}` | Daha esnek, autocomplete'e uygun |

### 4.5 Attribution (zorunlu)

Ekranda sürekli görünecek metin: `© OpenStreetMap contributors · Imagery © Esri/MapTiler ·
Terrain: AWS Open Data (Mapzen)`. Tıklayınca detaylı lisans paneli açılır.

---

## 5. Koordinat sistemi ve temel matematik

> Bu bölüm `src/geo/` modülünün spesifikasyonudur. **Önce bunu yaz ve birim testle** —
> geri kalan her şey buna dayanır.

### 5.1 Karar: "yerel düzlem + çapa (anchor) + floating origin"

Dünyayı küre olarak DEĞİL, **Web Mercator düzlemi** olarak modelliyoruz (hop.earth de böyle).
Mercator'un ölçek bozulması (enlemle 1/cos(lat) büyüme) şöyle telafi edilir:

- Bir **çapa noktası** (anchor: `lat0, lon0`) seçilir (spawn/teleport noktası).
- Dünya uzayı = `(mercator(p) - mercator(anchor)) * cos(lat0)` → çapa çevresinde **gerçek metre**.
- Yükseklikler zaten gerçek metre → ölçekler tutarlı.
- Oyuncu çapadan **> 50 km** kuzey/güney uzaklaşırsa veya teleport olursa **re-anchor**
  (çapayı taşı, tüm sahne düğümlerini yeni çapaya göre yeniden konumlandır; tek karelik iş).
- Ayrıca **floating origin**: kamera orijinden > 8 km uzaklaşınca sahneyi kaydır
  (float32 titremesini önler). Re-anchor ile birleştirilebilir.

Bu yaklaşım kıtalar arası uçuşta bile çalışır; sadece tek seferde binlerce km kuzey-güney
uçarken ara re-anchor'lar gerekir (otomatik, görünmez). Gerçek elipsoit/ECEF (Cesium tarzı)
**kapsam dışı** — gerekirse sonradan `geo` modülü değiştirilerek eklenir.

### 5.2 Formüller (birebir kodlanacak, `src/geo/mercator.ts`)

```ts
const R = 6378137; // WGS84 yarıçapı (m)

// lon/lat (derece) → mercator metre
mx = R * toRad(lon);
my = R * Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2));

// mercator → lon/lat
lon = toDeg(mx / R);
lat = toDeg(2 * Math.atan(Math.exp(my / R)) - Math.PI / 2);

// lon/lat → tile koordinatı (XYZ, z zoom)
n = 2 ** z;
tx = Math.floor(((lon + 180) / 360) * n);
ty = Math.floor(((1 - Math.asinh(Math.tan(toRad(lat))) / Math.PI) / 2) * n);

// tile → mercator sınırları (kenar uzunluğu)
tileSize = (2 * Math.PI * R) / 2 ** z;            // mercator metre
metersPerPixel = (156543.03392 * Math.cos(toRad(lat))) / 2 ** z; // gerçek metre, 256px tile
```

**Kritik notlar:**
- XYZ şemasında `y` kuzeyden başlar (TMS ile karıştırma).
- Sahne ekseni: Three.js `x = doğu`, `z = -kuzey` (yani kuzey −z yönü), `y = yukarı`.
  Bu dönüşümü `geo/anchor.ts` içinde TEK yerde yap, her yerde aynı fonksiyonu kullan.

### 5.3 Zoom seçim tablosu (LOD hedefi)

Kamera yerden yüksekliğine (AGL) göre hedef zoom — Faz 1.6'daki SSE bunu otomatik üretir ama
sezgi tablosu:

| Kamera AGL | İmagery zoom | Terrain zoom (max 15) |
|---|---|---|
| < 300 m (araba/gemi) | 17–18 | 15 |
| 300–2000 m (alçak uçuş) | 15–16 | 15 |
| 2–8 km | 13–14 | 13–14 |
| 8–20 km | 11–12 | 11–12 |
| > 20 km | 8–10 | 8–10 |

**Önemli mimari karar:** Terrain verisi z15'te biter ama imagery z18'e iner. Bu yüzden
quadtree **imagery zoom'una göre** bölünür; z>15 tile'ların yükseklik verisi z15 ebeveynden
**bilinear upsample** edilir (`heightSampler` bunu şeffaf yapar).

---

## 6. Mimari ve klasör yapısı

```
flight/
├─ index.html
├─ package.json / tsconfig.json / vite.config.ts
├─ public/
│  └─ models/            # glTF araçlar (aşağıda kaynak listesi)
├─ src/
│  ├─ main.ts            # bootstrap: engine + world + vehicle + ui
│  ├─ core/
│  │  ├─ engine.ts       # requestAnimationFrame döngüsü, sabit dt fizik adımı (60 Hz, accumulator)
│  │  ├─ input.ts        # klavye + gamepad + touch soyutlaması (aksiyon haritası)
│  │  ├─ settings.ts     # kalite preset'leri, localStorage
│  │  └─ debug.ts        # stats.js FPS, tile sayacı, ?debug paneli
│  ├─ geo/
│  │  ├─ mercator.ts     # §5.2 formülleri (saf fonksiyonlar, birim testli)
│  │  ├─ tilemath.ts     # tile ↔ bbox, çocuk/ebeveyn, komşu
│  │  └─ anchor.ts       # anchor state, worldFromLonLat / lonLatFromWorld, re-anchor olayı
│  ├─ world/
│  │  ├─ types.ts        # HeightSampler, ImageryProvider, WorldRenderer arayüzleri
│  │  ├─ tiles/
│  │  │  ├─ quadtree.ts        # SSE tabanlı split/merge
│  │  │  ├─ tileManager.ts     # yaşam döngüsü: istek → decode → mesh → sahne; LRU tahliye
│  │  │  ├─ fetcher.ts         # fetch + AbortController + retry + IndexedDB önbellek
│  │  │  ├─ decode.worker.ts   # PNG → Float32Array yükseklik (createImageBitmap + OffscreenCanvas)
│  │  │  ├─ meshBuilder.ts     # grid mesh + skirt + normal (worker'da çalışabilir)
│  │  │  └─ lru.ts
│  │  ├─ heightSampler.ts # dünya konumu → yükseklik (bilinear, z15 üstünde upsample)
│  │  ├─ imagery/providers.ts
│  │  ├─ water/           # ocean.ts (Gerstner şader), waveSampler.ts (CPU tarafı aynı dalga)
│  │  ├─ roads/           # overpass.ts, roadMesh.ts (polyline→şerit), lamps.ts (instanced)
│  │  ├─ sky/             # sky.ts, stars.ts, dayNight.ts
│  │  └─ effects/post.ts  # bloom, tonemap, vignette, SMAA
│  ├─ physics/
│  │  ├─ rapier.ts        # rapier world (yalnız araba modunda aktif)
│  │  └─ terrainCollider.ts # yakın tile'lardan heightfield collider üret/sök
│  ├─ vehicles/
│  │  ├─ vehicle.ts       # ortak arayüz: update(dt), attachCamera, hud(), enter/exit
│  │  ├─ plane/  (flightModel.ts, planeVehicle.ts)
│  │  ├─ car/    (carVehicle.ts — Rapier DynamicRayCastVehicleController)
│  │  ├─ boat/   (buoyancy.ts, boatVehicle.ts)
│  │  ├─ switcher.ts      # 1/2/3 tuşları, geçiş kuralları
│  │  └─ spawn.ts         # havaalanı/yol/su spawn mantığı, URL paylaşımı
│  ├─ camera/chaseCamera.ts, freeCamera.ts
│  ├─ ui/
│  │  ├─ hud/             # hız, irtifa, varyometre, pusula — canvas/DOM
│  │  ├─ minimap.ts       # MapLibre GL
│  │  ├─ search.ts        # Nominatim/Photon + teleport
│  │  ├─ menu.ts, attribution.ts, mobile.ts
│  ├─ modes/
│  │  ├─ freeroam.ts
│  │  └─ race/ (raceEditor.ts, raceRun.ts, ghost.ts)
│  └─ net/                # Faz 9 (boş bırak)
├─ server/                # Faz 9 (boş bırak)
└─ tests/
   ├─ mercator.test.ts, tilemath.test.ts, terrarium.test.ts
   └─ flightModel.test.ts, buoyancy.test.ts
```

**3D araç modelleri (CC0, hazır glTF):**
- Quaternius (quaternius.com) — uçak, gemi, araba paketleri, CC0
- Kenney (kenney.nl) — car kit, watercraft, CC0
İlk sürümde her araçtan 1 model yeter. Modeli `public/models/` altına commit'le (CC0 olduğu
için sorun yok), `LICENSES.md` dosyasına kaynağını yaz.

**Genel kurallar:**
- Fizik sabit adım 60 Hz (accumulator pattern), render değişken.
- Ana thread'de asla PNG decode/mesh üretimi yapma → worker havuzu (`navigator.hardwareConcurrency - 1`, max 4).
- Her modül kendi `dispose()`'unu implement eder (texture/geometry sızıntısı = en yaygın hata).

---

## 7. Fazlar

> Her adımda: **Yap:** (işin tarifi) → **Kabul:** (geçme kriteri). Kutucuklar uygulayıcı ajan
> tarafından işaretlenecek.

---

### <a name="faz-0"></a>Faz 0 — Proje kurulumu (küçük faz)

- [x] **0.1 İskelet.** Yap: `npm create vite@latest . -- --template vanilla-ts`; `three`,
  `@types/three`, `postprocessing`, `vitest`, `playwright` ekle. `tsconfig` strict.
  Kabul: `npm run dev` boş sayfa açıyor, `npm run build` hatasız.
- [x] **0.2 Motor döngüsü.** Yap: `core/engine.ts` — rAF döngüsü, sabit 60 Hz fizik
  accumulator'ı, `update(dt)`/`render()` ayrımı; `core/debug.ts` FPS sayacı.
  Kabul: dönen bir küp + yön ışığı 60 fps, sekme arka plana alınınca zaman patlamıyor
  (dt clamp ≤ 100 ms).
- [x] **0.3 Girdi.** Yap: `core/input.ts` — aksiyon haritası (`throttleUp`, `steerLeft`...
  §8'deki tablo), klavye + gamepad. Kabul: debug panelde basılı aksiyonlar görünüyor.
- [x] **0.4 CI.** Yap: GitHub Actions — `npm ci && npm run build && npm test`.
  Kabul: push'ta workflow yeşil.
- [x] **0.5 Attribution overlay.** Yap: sağ altta sabit küçük attribution çubuğu (§4.5).
  Kabul: her zaman görünür.

---

### <a name="faz-1"></a>Faz 1 — Arazi akış motoru ⭐ (en kritik faz, en çok zaman burada)

> Hedef: serbest kamerayla dünyanın her yerinde gezilebilen, uydu dokulu, LOD'lu arazi.
> Bu faz bitince oyunun "vay be" anı hazırdır; araçlar bunun üstüne oturur.

- [x] **1.1 Geo matematiği.** Yap: `geo/mercator.ts` + `geo/tilemath.ts`, §5.2 formülleri;
  Vitest testleri (bilinen değerlerle: örn. lon=29.03, lat=41.11 (İstanbul) z15 → doğru tile).
  Kabul: `npm test` yeşil; ileri-geri dönüşümler 1e-9 hata altında.
- [x] **1.2 Fetcher + önbellek.** Yap: `tiles/fetcher.ts` — eşzamanlı istek limiti (8),
  AbortController (görünürlükten çıkan tile iptal), 2 kez retry, IndexedDB'de blob önbellek
  (anahtar: `provider/z/x/y`), LRU (~2000 tile).
  Kabul: aynı tile ikinci kez ağa çıkmıyor (devtools'ta doğrula); iptal çalışıyor.
- [x] **1.3 Terrarium decode (worker).** Yap: `decode.worker.ts` — blob → `createImageBitmap`
  → OffscreenCanvas → `getImageData` → §4.1 formülüyle `Float32Array(257×257)` (kenar
  paylaşımı için 256+1; sağ/alt kenar komşu tile'dan veya kenar kopyasından).
  Kabul: birim test — bilinen renk üçlüsü doğru metreye çözülüyor; deniz ≈ 0, Everest ≈ 8800.
- [x] **1.4 Tile mesh.** Yap: `meshBuilder.ts` — 128×128 segment grid (kalite ayarına göre
  64/128), yükseklikler decode'dan, kenarlarda **skirt** (LOD çatlaklarını gizler, derinlik:
  tile kenarının %5'i), normal hesabı. Geometri anchor-göreli konumda (§5.1).
  Kabul: tek tile (İstanbul z15) doğru ölçekte, ışıklandırması düzgün render oluyor.
- [x] **1.5 İmagery drape.** Yap: `imagery/providers.ts` (Esri + MapTiler + EOX config'leri);
  texture: `sRGB`, anisotropy 8, mipmap. Terrain tile'ı ile aynı z/x/y dokusu eşleşir; z>15'te
  doku o zoom'dan, geometri z15 upsample (§5.3).
  Kabul: tile fotogerçekçi görünüyor; renk yıkanması yok (sRGB doğru).
- [x] **1.6 Quadtree LOD.** Yap: `quadtree.ts` — kök tile'lar z6'dan başlar (görüş alanındaki),
  her karede ekran-uzayı hata (SSE) hesabı:
  `sse = (tileWorldSize / distanceToCamera) * (screenHeight / (2 * tan(fov/2))) / 256`
  `sse > 2` ise böl (4 çocuk), `< 1` ise birleştir; histerezis şart (titremesin).
  Çocuklar hazır olana dek ebeveyn render'da kalır (asla delik açılmaz).
  Kabul: serbest kamerayla (WASD + fare) alçalınca detay artıyor, yükselince azalıyor;
  delik/flaş yok; z6→z18 akıcı.
- [x] **1.7 TileManager + bütçeler.** Yap: yaşam döngüsü durum makinesi
  (`pending→fetching→decoding→meshing→ready→disposed`), kare başına max 2 mesh sahneye ekleme
  (spike önleme), toplam GPU doku bütçesi ~800 MB → LRU tahliye + `dispose()`.
  Kabul: 10 dk gezinti sonrası bellek düz (Chrome Performance Monitor), fps 60.
- [x] **1.8 Floating origin + re-anchor.** Yap: §5.1 — kamera > 8 km → origin kaydır;
  teleport → re-anchor. Tüm sistemlere `originShift(offset)` olayı yayınla.
  Kabul: çapadan 100 km uzakta z-fighting/titreme yok; Alpler → Himalaya teleport sorunsuz.
- [x] **1.9 HeightSampler.** Yap: `heightSampler.ts` — dünya (x,z) → yükseklik; yüklü en iyi
  tile'dan bilinear; tile yoksa senkron `0` + asenkron yükleme tetikle. Uçak/gemi/kamera bunu
  kullanacak. Kabul: birim test + kamera yere gömülmüyor.

**Faz 1 çıkış demosu:** Serbest kamerayla Boğaz üzerinden alçal, Antalya sahiline teleport,
Toroslar üzerinde süzül — 60 fps, delik yok, bellek stabil.

---

### <a name="faz-2"></a>Faz 2 — Uçak ✈ (ilk oynanabilir araç)

> Arcade uçuş modeli: gerçekçi aerodinamik DEĞİL, "iyi hissettiren" basit model.
> Fizik motoru kullanılmaz; yalnızca `heightSampler` ile yer kontrolü.

- [x] **2.1 Uçuş modeli.** Yap: `plane/flightModel.ts` — durum: `pos, vel (Vector3), quat,
  throttle (0..1)`. Her fizik adımında (60 Hz):
  ```
  forward = quat * (0,0,-1);  up = quat * (0,1,0)
  thrust  = forward * throttle * MAX_THRUST            // ~ 25 m/s² tepe
  vFwd    = dot(vel, forward)                          // ileri hız
  liftK   = clamp(vFwd / V_REF, 0, 1.4)²               // V_REF ~ 40 m/s
  lift    = up * liftK * G                             // tam liftK=1'de yerçekimini dengeler
  drag    = -vel * (D_LIN + D_QUAD * |vel|)            // parazit sürükleme
  vel    += (thrust + lift + (0,-G,0) + drag) * dt
  // dönüşler: input → açısal hız hedefleri (rad/s), hızla etkinlik artar
  pitchRate = input.pitch * 1.2 * ctl;  rollRate = input.roll * 2.2 * ctl
  yawRate   = input.yaw * 0.5 * ctl;    ctl = clamp(vFwd / V_REF, 0.2, 1)
  quat = quat * fromEuler(pitchRate*dt, yawRate*dt, rollRate*dt)
  // koordineli dönüş yardımı: roll varken hafif otomatik yaw (arcade his)
  // stall: vFwd < V_STALL (~18 m/s) → lift *= vFwd/V_STALL, burun aşağı torku ekle
  // hız vektörünü gövdeye hizala (arcade): vel = lerp(vel, forward*|vel|, ALIGN*dt)
  ```
  Sabitler `plane/config.ts`'te; ayar için ?debug panelinde slider.
  Kabul: Vitest — düz uçuşta irtifa sabit (±1 m/10 sn), gaz kesince süzülerek alçalıyor,
  stall'da burun düşüyor.
- [x] **2.2 Yer etkileşimi.** Yap: her adımda `h = heightSampler(pos)`; `pos.y - h < 1.5` iken:
  iniş takımı mantığı — alçalma hızı < 3 m/s ve gövde ±10° düz ise "yerde" durumuna geç
  (yerde: sürtünme, direksiyon=yaw, gaz ile kalkış rulesi); değilse **crash** → 1 sn fade
  → son güvenli konuma reset. Kabul: pistten kalkış ve yumuşak iniş yapılabiliyor; dağa
  çarpınca reset.
- [x] **2.3 Chase kamera.** Yap: `camera/chaseCamera.ts` — hedefin arkasında yay-sönümlü takip
  (pozisyon lerp ~4 Hz, bakış lerp daha hızlı), FOV 60→75 hızla, çarpışma: kamera-hedef arası
  terrain varsa kamerayı yaklaştır. Kabul: hızlı yaw/roll'da kamera mide bulandırmıyor,
  yere gömülmüyor.
- [x] **2.4 Uçak HUD.** Yap: hız (km/h), irtifa MSL + AGL, varyometre oku, pusula şeridi,
  gaz göstergesi. Sade, yarı saydam. Kabul: değerler doğru (heightSampler ile tutarlı).
- [ ] **2.5 Spawn: havaalanları.** Yap: OurAirports CSV'den derleme scriptiyle (`scripts/airports.ts`)
  büyük+orta havaalanlarını `public/data/airports.json`'a çıkar (isim, IATA, lat, lon, pist yönü
  yoksa 0). Başlangıç: İstanbul (LTFM) pistinde. Arama panelinden havaalanı seçilebilir.
  Kabul: LTFM'den kalk, Boğaz üstünde uç; AYT (Antalya)'ya teleport et, kalk.
- [x] **2.6 Uçak modeli + pervane animasyonu.** Yap: Quaternius CC0 uçak glTF; pervane döner,
  kontrol yüzeyleri (varsa) input'la oynar; gölge (tek yön ışık + `ShadowMaterial` yer düzlemi
  yakın çevrede). Kabul: model yönü uçuş yönüyle tutarlı, gölge yerde.

**Faz 2 çıkış demosu (= MİLESTONE M1):** LTFM'den kalk → köprülerin üzerinden geç →
Kız Kulesi'ne alçal → dağa çarp → reset. 60 fps.

---

### <a name="faz-3"></a>Faz 3 — Araba 🚗

> Rapier yalnızca bu modda aktifleşir (uçak/gemi kullanmaz). Bu, en pahalı sistemin
> (collider üretimi) maliyetini araca kilitler.

- [ ] **3.1 Rapier entegrasyonu.** Yap: `physics/rapier.ts` — WASM init (vite ile),
  60 Hz step, yerçekimi 9.81. Kabul: küp düşüp zeminde duruyor (test sahnesi).
- [ ] **3.2 Terrain collider'ları.** Yap: `physics/terrainCollider.ts` — araba çevresindeki
  3×3 z15 tile'dan heightfield collider üret (decode edilmiş Float32Array'den, ayrı kopya);
  araba tile sınırı geçince ileri üret/geride sök. Kabul: araba her yerde zemine oturuyor,
  tile geçişinde hıçkırık yok (collider üretimi worker'da/parçalı).
- [x] **3.3 Araç kontrolcüsü.** Yap: Rapier `DynamicRayCastVehicleController` — 4 teker,
  süspansiyon (gezinme 0.15 m, sertlik ayarlı), motor kuvveti hıza göre eğri, el freni =
  arka teker sürtünmesini düşür (drift), direksiyon hızla daralır (yüksek hızda ±15°).
  Sabitler `car/config.ts`. Kabul: dağ yolunda yokuş inişte kontrol kaybolmuyor, drift
  yapılabiliyor, takla atınca R ile toparlanıyor (reset upright).
- [x] **3.4 Araba kamera + HUD.** Yap: chase cam düşük ve yakın, FOV 65→80 hızla, hafif
  hız sarsıntısı; HUD: hız + el freni göstergesi. Kabul: hız hissi var.
- [x] **3.5 Zemin detayı.** Yap: araba yakınında (200 m) detay katmanı — imagery z18 +
  prosedürel detay normal map (asfalt/toprak gürültüsü) karışımı; yoksa uydu dokusu yakından
  bulanık kalır. Kabul: yerden bakışta zemin "oyun gibi" görünüyor.

**Faz 3 çıkış demosu:** Antalya–Mersin sahil yolunda (D400) sürüş — viraj, yokuş, deniz
manzarası; 60 fps.

---

### <a name="faz-4"></a>Faz 4 — Gemi ⛵ ve su

- [x] **4.1 Okyanus yüzeyi.** Yap: `water/ocean.ts` — deniz seviyesi y=0'da kamera-merkezli
  büyük grid (ör. 4×4 km, 256² segment, kamerayla kayar); vertex şaderde **3 oktav Gerstner
  dalgası** (yön, dalga boyu, genlik config), fragment'te: fresnel + env yansıma + derinliğe
  göre renk (terrain yüksekliği < 0 → derinlik). Kabul: denizde inandırıcı dalga, sahilde
  yumuşak geçiş; fps düşüşü < 2 ms.
- [x] **4.2 Su maskesi (v1 kuralı).** Yap: "su" = `heightSampler(x,z) <= 0.5 m`. Bilinen
  hata: deniz seviyesi altındaki karalar (Hollanda, Lut Gölü) yanlış su sayılır; göller
  (yükseklikte) su sayılmaz → `KNOWN_ISSUES.md`'ye yaz, v2'de OSM su poligonları (§4.3).
  Kabul: Boğaz, Akdeniz, Ege'de su doğru; kural dokümante.
- [x] **4.3 Yüzdürme fiziği.** Yap: `boat/buoyancy.ts` — gövdede 5 örnek noktası (pruva,
  kıç×2, orta×2). Her adım:
  ```
  her nokta p için: waveY = waveSampler(p.xz, t)   // Gerstner CPU kopyası (şaderle AYNI katsayılar)
  depth = waveY - p.y
  depth > 0 → F_up = K_BUOY * min(depth, MAX_DRAFT) → p noktasından uygula (tork üretir)
  su içi sönüm: vel *= (1 - DAMP_LIN*dt);  angVel *= (1 - DAMP_ANG*dt)
  itki = forward_yatay * throttle * THRUST;  dümen torku ∝ hız * rudder
  karaya oturma: heightSampler > -0.3 → hızı hızla söndür
  ```
  Basit rigid body kendi entegrasyonumuz (Rapier gerekmez). Kabul: Vitest — durgun suda gemi
  dengede salınıp oturuyor; dalgada yalpalıyor; devrilmiyor.
- [x] **4.4 Gemi görselleri.** Yap: Kenney/Quaternius tekne modeli, pruva köpüğü +
  kıç izi (scrolling foam texture'lı iki quad şerit), motor sesi (Faz 7.5 ile).
  Kabul: hareket halinde iz bırakıyor.

**Faz 4 çıkış demosu:** İstanbul Boğazı'nda gemiyle köprü altından geçiş, dalgalı deniz,
karaya oturunca durma.

---

### <a name="faz-5"></a>Faz 5 — Araç değiştirme ve spawn

- [x] **5.1 Vehicle arayüzü + switcher.** Yap: `vehicles/vehicle.ts`
  (`update(dt)`, `getCameraTarget()`, `renderHud()`, `enter(state)`, `exit(): state`,
  `dispose()`); `switcher.ts`: **1**=uçak, **2**=araba, **3**=gemi. Geçişte konum+yön+hız
  makul aktarılır (uçak→araba: yere indir; hız korunmaz, 0'dan başla).
  Kabul: geçişler kilitlenme/sızıntı olmadan onlarca kez çalışıyor.
- [x] **5.2 Akıllı geçiş kuralları.** Yap: su üstünde **2** (araba) basılırsa → en yakın kara
  noktasına ışınla (spiral tarama ile heightSampler > 1 m ilk nokta); karada **3** (gemi)
  basılırsa → en yakın su noktası; uçak her yerde spawn olur (havada 300 m AGL'de, V_REF
  hızında düz uçuşta). Kabul: hiçbir kombinasyon oyuncuyu gömmüyor/boğmuyor.
- [x] **5.3 URL durumu.** Yap: `?lat=..&lon=..&veh=plane&hdg=..&alt=..` — yüklemede oku,
  60 sn'de bir ve teleportta güncelle (replaceState). Kabul: URL kopyala → yeni sekmede aynı
  yer/araçla açılıyor (paylaşım özelliği).
- [x] **5.4 Başlangıç deneyimi.** Yap: ilk açılışta kısa overlay — "1/2/3 araç, WASD sürüş,
  T ile dünyada ara" + varsayılan spawn: LTFM pisti, uçak. Kabul: yeni oyuncu 10 sn'de uçuyor.

**Faz 5 çıkış demosu (= MİLESTONE M2):** Antalya üzerinde uç → sahile in → arabaya geç →
D400'de sür → marinada gemiye geç → açıl. Tek kesintisiz oturum.

---

### <a name="faz-6"></a>Faz 6 — Gece estetiği 🌙 (NFS Carbon görünümü — tweet'teki his)

> Referans kare: gece, sodyum/yeşilimsi sokak lambaları dizisi, parlak yol aydınlatma
> havuzları, araç stop lambalarında bloom, lacivert gök.

- [x] **6.1 Gündüz/gece durumu.** Yap: `sky/dayNight.ts` — güneş açısı parametresi (N tuşu:
  gündüz→akşam→gece döngüsü; varsayılan **gece**). Güneş/ay yönü ışığı, yıldız kubbesi
  (nokta sprite'lar), ufukta gradyan gök şaderi. Kabul: üç mod da tutarlı görünüyor.
- [x] **6.2 Post pipeline.** Yap: `effects/post.ts` — `postprocessing` ile: ACES tonemap,
  **selective bloom** (yalnız emissive katman: lambalar, stoplar, HUD hariç), SMAA, vignette,
  hızla artan hafif motion blur (opsiyonel, ayarlardan kapanır). Kabul: bloom yalnız ışık
  kaynaklarında; gündüz sahne yıkanmıyor.
- [x] **6.3 Uydu dokusunun gece uyarlaması.** Yap: terrain fragment şaderine gece uniform'u —
  doku luminance'ı ~0.12'ye çekilir, mavi tona kaydırılır; şehir bölgelerinde (dokunun parlak
  pikselleri) hafif sıcak ışık sızması. Kabul: gece arazi "siyah çukur" değil, ay ışığında
  okunuyor (tweet'teki gibi).
- [x] **6.4 Yol vektörleri + sokak lambaları.** Yap: `roads/` — Overpass'tan görünür bbox
  yolları; polyline → düz şerit mesh (yol genişliği sınıfa göre: motorway 12 m, primary 8 m...)
  hafif emissive-koyu asfalt dokusu, kenar çizgileri; **lambalar**: motorway/trunk/primary
  boyunca her 35 m'de instanced direk + spot ışık YOK (pahalı) → onun yerine: (a) direğin
  başında bloom'lu emissive küre, (b) yolda sahte ışık havuzu (additive decal quad, sodyum
  rengi `#ffb84d` veya tweet'teki gibi yeşilimsi `#d8ffb0`). Mesafeyle instancing fade.
  Kabul: gece D400'de sürüş tweet karesine benziyor; 500 lamba < 2 ms.
- [x] **6.5 Araç ışıkları.** Yap: uçak nav ışıkları (yanıp sönen kırmızı/yeşil/beyaz strobe),
  araba: 2 gerçek `SpotLight` far (yalnız araba modunda, gölgesiz) + emissive stoplar,
  gemi: seyir feneri. Kabul: farlar yolu aydınlatıyor, stoplarda bloom var.
- [x] **6.6 Atmosfer/sis.** Yap: yükseklik sisli exponential fog (gece koyu lacivert, gündüz
  hafif mavi-gri), uzak tile'lar sise karışıyor (LOD geçişini de gizler). Su gece yansıması:
  env map + fresnel yeter (SSR yok). Kabul: ufuk çizgisi çirkin bitmiyor; sis LOD'u örtüyor.

**Faz 6 çıkış demosu (= MİLESTONE M3):** Tweet'teki karenin birebir benzeri: gece, sahil
otoyolu, lamba dizisi, tek araba — ekran görüntüsü alınıp README'ye konur.

---

### <a name="faz-7"></a>Faz 7 — UI/UX

- [x] **7.1 Minimap.** Yap: `ui/minimap.ts` — MapLibre GL, OSM raster stil; sol altta
  yuvarlak/köşeli panel; oyuncu oku (yöne döner), harita oyuncuyu takip eder; araç tipine
  göre zoom (uçak 11, araba 15, gemi 13); M tuşu büyük harita (tıkla → teleport).
  Kabul: tweet'teki minimap paritesi; büyük haritadan tıkla-ışınlan çalışıyor.
- [x] **7.2 Arama.** Yap: `ui/search.ts` — T tuşu → arama kutusu; Nominatim/Photon (debounce
  400 ms, önbellek); sonuç seç → teleport (uçaksa 300 m AGL, arabaysa en yakın kara,
  gemiyse en yakın su — Faz 5.2 mantığı yeniden kullanılır). Kabul: "Antalya", "Kapadokya",
  "San Francisco" araması saniyeler içinde ışınlıyor.
- [x] **7.3 Ayarlar menüsü.** Yap: Esc → panel: kalite preset (Düşük/Orta/Yüksek: segment
  sayısı, doku bütçesi, bloom, gölge), tuş yeniden atama, dil TR/EN (basit sözlük objesi),
  imagery sağlayıcı seçimi. localStorage'a kaydet. Kabul: Düşük preset entegre GPU'da
  fps'i belirgin artırıyor.
- [x] **7.4 Ses.** Yap: WebAudio — motor sesi (araç başına loop, hıza göre pitch), rüzgar
  (uçak hızıyla), dalga (gemi), çarpışma efekti. Ses dosyaları CC0 (freesound/Kenney).
  Kabul: sesler hıza tepkili, toplam < 2 MB.
- [x] **7.5 Yardım.** Yap: H tuşu → tuş şeması overlay (§8 tablosu). Kabul: açılıp kapanıyor.

---

### <a name="faz-8"></a>Faz 8 — Oyun modları

- [x] **8.1 Mod altyapısı.** Yap: `modes/` — `GameMode` arayüzü (`start/stop/update/ui`);
  freeroam varsayılan. Kabul: modlar arası geçiş temiz.
- [ ] **8.2 Rota editörü.** Yap: büyük haritada (M) tıklayarak checkpoint dizisi oluştur
  (uçak için isteğe bağlı irtifa kapısı), rota adı ver, localStorage'a + paylaşılabilir
  URL'ye (`?race=` base64 polyline) kaydet. Kabul: Antalya–Mersin 10 checkpoint'lik rota
  kurulup URL ile paylaşılabiliyor.
- [x] **8.3 Yarış çalıştırıcı.** Yap: 3-2-1 geri sayım, sıradaki checkpoint dünya halkası
  (uçakta halka, arada yol oku), süre + son/en iyi tur, bitişte özet ekranı. Kabul: aynı
  rota üç araçla da (uygunsa) oynanabiliyor.
- [ ] **8.4 Hayalet (ghost).** Yap: en iyi koşuda 10 Hz pozisyon+quat kaydı (localStorage,
  delta sıkıştırma), sonraki koşuda yarı saydam araç olarak oynat. Kabul: hayaletle yarış
  çalışıyor, kayıt < 200 KB.

**Faz 8 çıkış demosu (= MİLESTONE M4):** Tweet'teki senaryo: Antalya–Mersin yolunda gece
yarışı — kullanıcının "yayın açsam gelir miydiniz" sorusunun cevabı burada 🙂

---

### <a name="faz-9"></a>Faz 9 — Multiplayer (OPSİYONEL — ayrı karar noktası)

> Buraya başlamadan kullanıcıya sor: sunucu barındırma (küçük VPS/Fly.io) ve efor ister.
> v1 bunsuz da yayınlanabilir.

- [ ] **9.1 Sunucu.** Node.js + Colyseus; oda = lobi kodu (arkadaşlar arası) — bölge bazlı
  otomatik eşleşme YOK (kapsam küçük kalsın). Durum: oyuncu başına `pos, quat, vel, veh, name`.
- [ ] **9.2 Senkronizasyon.** İstemci 15 Hz durum gönderir; sunucu 15 Hz yayın; alıcı tarafta
  100–150 ms interpolasyon tamponu; uzaktaki oyuncular fiziksiz görsel kopya (çarpışma yok —
  arkadaş arası eğlence, anti-cheat kapsam dışı).
- [ ] **9.3 Oyun içi.** İsim etiketleri, basit metin sohbeti, Faz 8 rotasını odada paylaşıp
  senkron başlatma (sunucu geri sayımı dağıtır, herkes kendi süresini koşar, skor tablosu).
- [ ] **9.4 Dağıtım.** Fly.io/Railway tek container; WebSocket TLS; oda başına 8 oyuncu limiti.
  Kabul: iki tarayıcıda birbirini görme, birlikte yarış, ~150 ms gecikmede oynanabilir.

---

### <a name="faz-10"></a>Faz 10 — Performans, mobil, yayın

- [x] **10.1 Performans geçişi.** Yap: Chrome tracing ile kare bütçesi çıkar; hedefler:
  draw call < 300, ana thread kare işi < 8 ms, GPU doku < 800 MB, worker'da decode.
  Instancing (lambalar, direkler), frustum culling doğrula, `renderer.info` debug panelde.
  Kabul: orta laptop (entegre GPU) Orta preset 60 fps; M1 Air 60 fps.
- [x] **10.2 Tile proxy.** Yap: Cloudflare Worker — `/tiles/:provider/:z/:x/:y` → kaynağa
  proxy + Cloudflare cache (TTL 30 gün) + API anahtarları Worker secret'ta + CORS +
  hafif rate limit. İstemci config'i proxy URL'sine çevrilir. Kabul: anahtarlar bundle'da
  görünmüyor; ikinci istek cache'ten (<50 ms).
- [x] **10.3 Mobil dokunmatik.** Yap: `ui/mobile.ts` — sol sanal joystick (direksiyon/pitch-roll),
  sağda gaz/fren kaydırıcı, araç değiştirme butonları; `pointerdown` tabanlı; DPR sınırla (≤2),
  otomatik Düşük preset. Kabul: telefonda D400 sürüşü 30 fps "oynanabilir".
- [ ] **10.4 Hata izleme + telemetri.** Yap: Sentry (ücretsiz katman) — hata + fps p50/p95
  özel olayı (yalnız anonim performans, konum verisi GÖNDERME). Kabul: test hatası panelde.
- [ ] **10.5 Yayın.** Yap: Cloudflare Pages'e deploy (CI'dan otomatik), özel alan adı,
  OG önizleme görseli (Faz 6 ekran görüntüsü), `KNOWN_ISSUES.md` ve `LICENSES.md` linkleri,
  README'ye gif. Kabul: canlı URL herkese açık, Lighthouse Performance > 80 (oyun sayfası
  için makul), attribution tam.

---

## 8. Tuş şeması

| Aksiyon | Tuş | Uçak | Araba | Gemi |
|---|---|---|---|---|
| W / S | | Gaz artır / azalt | Gaz / fren-geri | Gaz ileri / geri |
| A / D | | Roll sol / sağ | Direksiyon | Dümen |
| ↑ / ↓ | | Pitch aşağı / yukarı (ters ayarı menüde) | — | — |
| Q / E | | Yaw (rudder) | — | — |
| Space | | — | El freni (drift) | — |
| 1 / 2 / 3 | | Uçağa / arabaya / gemiye geç (Faz 5.2 kuralları) | | |
| C | | Kamera modu (yakın/uzak/kokpit-benzeri ileri faz) | | |
| R | | Reset (son güvenli konum / aracı düzelt) | | |
| T | | Yer arama / teleport | | |
| M | | Büyük harita (tıkla-ışınlan / rota editörü) | | |
| N | | Gündüz-akşam-gece döngüsü | | |
| H | | Yardım overlay | | |
| Esc | | Menü / ayarlar | | |

Gamepad: sol çubuk = ana eksenler, RT/LT = gaz/fren, butonlar ayarlardan atanır.

---

## 9. Riskler ve çözümleri

| Risk | Etki | Çözüm |
|---|---|---|
| **İmagery lisansı** (Esri doğrudan tile çekimi ToU gri alanı) | Yayında hukuki risk | Geliştirmede Esri; **yayında MapTiler/Mapbox anahtarlı plan + tam attribution**; proxy ile kota kontrolü. Yayın öncesi son kontrol maddesi |
| Overpass/Nominatim halka açık sunucu limitleri | Yol/lamba/arama kesilir | Agresif önbellek (IndexedDB), debounce, tek uçtan proxy; gerekirse kendi Overpass/Photon instance'ı (Faz 10 sonrası) |
| Float32 hassasiyeti (dünya ölçeği) | Titreme, z-fighting | §5.1 anchor + floating origin; Faz 1.8 kabul kriteri bunu test eder |
| Tile decode ana thread'i kilitler | Kasma | Worker havuzu + kare başına ekleme bütçesi (Faz 1.7) |
| Su tespiti yanlış (Hollanda, Lut Gölü, göller) | Gemi karada / araba denizde | v1'de bilinen sınırlama (dokümante); v2 OSM su poligonları |
| Terrain z15 çözünürlüğü yerden bakışta kaba (30 m SRTM) | Araba modunda "yumuşak" arazi | Beklenen ve kabul edilen (hop.earth'te de böyle); detay normal map (Faz 3.5) algıyı kurtarır |
| Rapier heightfield üretim maliyeti | Araba modunda takılma | Yalnız 3×3 tile, worker'da hazırla, ana thread'de yalnız collider ekle |
| Kapsam şişmesi | Hiçbir şey bitmez | Fazlar sıralı; her milestone yayınlanabilir durumda; multiplayer bilinçli olarak opsiyonel |

---

## 10. Devir talimatları

**Uygulayıcı ajan (Opus) için çalışma sözleşmesi:**

1. **Sıra:** Fazları numara sırasıyla uygula. Faz içinde adım sırası da bağlayıcı
   (bağımlılıklar buna göre dizildi). Faz 9 için önce kullanıcıya sor.
2. **Commit disiplini:** Her adım (örn. 1.4) = en az bir commit. Mesaj formatı:
   `faz1.4: tile mesh + skirt üretimi`. Çalışmayan kod commit'lenmez.
3. **Kabul kriteri = kapı.** Kriter doğrulanmadan sonraki adıma geçme. Doğrulama yöntemi:
   birim testler (`npm test`) + tarayıcıda elle senaryo + gerekirse ekran görüntüsü.
   Bu depoda Playwright + Chromium hazır; smoke testleri `tests/e2e/` altına ekle
   (sayfa yükleniyor, konsol hatasız, 5 sn'de ilk tile render).
4. **İlerleme işaretleme:** Bu dosyadaki `- [ ]` kutucuklarını adım bitince `- [x]` yap ve
   aynı commit'e dahil et. Sapma gerektiğinde (API değişti, kaynak kapandı) bu dosyaya
   kısa bir `> NOT (tarih):` düş.
5. **Bağımlılık ekleme kuralı:** §3'te listelenenler dışında paket eklemeden önce gerekçeyi
   commit mesajına yaz; büyük framework'ler (React vb.) ekleme.
6. **Ayar sabitleri:** Fizik/görsel sabitler daima `config.ts` dosyalarında; kod içine gömme.
   `?debug` panelinden canlı ayarlanabilir olsun (dat.gui/lil-gui kullanılabilir).
7. **Performans bütçesi her fazda geçerli:** yeni sistem eklerken FPS 60'ın altına kalıcı
   düşüyorsa önce onu çöz.
8. **Model/veri lisansları:** her eklenen asset `LICENSES.md`'ye kaynak URL'siyle işlenir.
9. **Dil:** Kod/yorum/commit İngilizce; UI metinleri TR+EN sözlük objesinde (Faz 7.3).
10. **İlk hedef:** M1'e (Faz 0→2) kesintisiz git — "dünyanın üzerinde uçmak" demosu, projenin
    kalbi. M1 çıktısını (ekran görüntüsü/kısa video) kullanıcıya göster.

---

## 11. Milestone'lar ve efor tahmini

| Milestone | Kapsam | Çıktı | Tahmini efor* |
|---|---|---|---|
| **M1 — Uç!** | Faz 0 + 1 + 2 | Dünyada serbest uçuş demosu | 3–5 yoğun oturum (işin ~%40'ı; Faz 1 en ağır parça) |
| **M2 — Üç araç** | Faz 3 + 4 + 5 | Uç → sür → yüz kesintisiz | 2–4 oturum |
| **M3 — Gece** | Faz 6 | Tweet estetiği ekran görüntüsü | 1–2 oturum |
| **M4 — Oyun** | Faz 7 + 8 | Arama, minimap, yarış modu | 2–3 oturum |
| **M5 — Birlikte** (ops.) | Faz 9 | Arkadaşla yarış | 2–3 oturum + sunucu |
| **M6 — Yayın** | Faz 10 | Canlı URL | 1–2 oturum |

\* "Oturum" = bir ajan çalışma seansı (birkaç saat eşdeğeri insan işi). Toplam: v1 (M1–M4+M6)
için kabaca 9–16 oturum; multiplayer hariç her milestone sonunda elde **çalışan, gösterilebilir**
bir ürün olur.

---

*Plan sonu. Sorular/sapma kararları için önce §9 ve §10'a bak; orada yoksa kullanıcıya sor.*

---

## Uygulama durumu (5 Ağustos 2026)

Bu plan **uygulandı**. Aşağıdaki kutucuklar gerçek duruma göre işaretlidir; sapmalar ve
yapılmayanlar burada toplu olarak yazılı.

### Plandan sapmalar ve gerekçeleri

> **NOT (2026-08-05) — Rapier yerine özel araç fiziği.** Plan araba için Rapier'i öngörüyordu.
> Bunun yerine üç araç da yükseklik örneklemesine dayanan hafif özel fizikle yazıldı: WASM
> bağımlılığı yok, üç araç aynı `heightAt` kaynağını okuduğu için arazi ile hiç çelişmiyor ve
> heightfield collider üretme/söküp takma maliyeti tamamen ortadan kalktı. Araba yine de eğim,
> yanal tutuş ve el freniyle drift yapıyor (`src/vehicles/car.ts`).

> **NOT (2026-08-05) — glTF model yerine prosedürel model.** Plan CC0 glTF modeller indirmeyi
> öngörüyordu. Modeller kod içinde ilkel geometrilerden üretildi (`src/vehicles/models.ts`):
> üçüncü taraf lisansı yok, bundle birkaç KB, pervane/far/stop lambası gibi parçalar tek tek
> adreslenebiliyor.

> **NOT (2026-08-05) — MapLibre yerine kendi minimap'imiz.** Minimap, zaten bellekte olan
> yükseklik verisinden gölgeli kabartma olarak çiziliyor (`src/ui/minimap.ts`). İkinci bir harita
> kütüphanesi ve ikinci bir tile trafiği yok; çevrimdışı da çalışıyor. Tarama kare başına
> parçalara bölünüyor.

> **NOT (2026-08-05) — Tile proxy fazından öne alındı.** Faz 10.2'deki proxy, Faz 1 sırasında
> yazıldı (`server/tileProxy.ts`): tarayıcısı dış ağa doğrudan çıkamayan ortamlarda (CI, kısıtlı
> ağlar) oyunun ve testlerin çalışabilmesi için gerekliydi. `?tiles=proxy` ile devreye girer;
> varsayılan hâlâ doğrudan istektir, yani statik dağıtım sunucusuz çalışır.

> **NOT (2026-08-05) — Stilize doku, planda olmayan bir katman.** Uydu sağlayıcısına erişilemediği
> durumlar için yükseklikten üretilen hipsometrik + gölgeli doku eklendi (`src/world/stylize.ts`).
> Hem sağlam bir yedek hem de ayarlardan seçilebilen bir sanat tarzı.

> **NOT (2026-08-05) — Yollar sürülebilir hale getirildi, binalar eklendi.** Plan yolları yalnızca
> görsel katman olarak öngörüyordu (6.4). Uygulamada yollar sorgulanabilir: `Roads.surfaceAt`
> hücre başına bir ızgara üzerinden "bu noktada yol var mı, yüksekliği ne, adı ne" sorusunu 2.4 µs'de
> yanıtlıyor. Araba asfalt üzerinde daha çok tutunuyor, daha az direnç görüyor ve daha hızlı
> gidiyor; yol adı ekranda görünüyor. Ayrıca planda hiç olmayan **binalar** eklendi
> (`src/world/buildings/`): OSM alanları kulak-kırpma üçgenlemesiyle katı kütleye dönüştürülüyor,
> pencereler şader deseni olarak çiziliyor. Yollar ve binalar ortak bir hücre akış motorunu ve tek
> bir istek sırasını paylaşıyor (`src/world/osm/cellStreamer.ts`).

### Yapılmayanlar

- **2.5 Havaalanı veritabanı (OurAirports CSV).** Onun yerine ~55 kayıtlık elle seçilmiş bir yer
  listesi var (`src/data/places.ts`): büyük havaalanları, Türkiye'den ve dünyadan doğal/kültürel
  noktalar, sürüş rotaları. Anında ve çevrimdışı çalışıyor; gerisi Nominatim'den geliyor.
- **3.1–3.2 Rapier ve heightfield collider.** Yukarıdaki sapma notuna bakın.
- **8.2 Rota editörü ve rota paylaşımı.** Yarış kapıları prosedürel diziliyor; elle rota çizme yok.
- **8.4 Hayalet (ghost).** Uygulanmadı; en iyi süre saklanıyor.
- **Faz 9 Multiplayer.** Planda da opsiyoneldi; sunucu gerektirdiği için kullanıcı kararına bırakıldı.
- **10.4 Sentry / telemetri.** Uygulanmadı.
- **10.5 Yayın.** Depo dağıtıma hazır (statik build), fakat canlı bir URL'ye deploy edilmedi.

### Doğrulama

- 82 birim testi: geo matematiği, Terrarium çözme, uçuş modeli (11 senaryo), yüzdürme, dalga,
  araç yerleştirme, Overpass ayrıştırma (yol + bina), yol şeridi, lamba dizilimi, yol profili
  düzleştirme, poligon üçgenleme ve bina ekstrüzyonu.
- Playwright smoke testi gerçek uygulamayı gerçek yükseklik servisine karşı açıyor, tile'ların
  çizildiğini doğruluyor ve konsol/WebGL hatası olmamasını şart koşuyor.
- Tarayıcıda uçtan uca senaryo: pistten kalkış → tırmanış → dönüş → arabaya geçiş → sürüş →
  gemiye geçiş → seyir; hatasız.
- Yol ve bina render/sürüş hattı `scripts/osmPreview.mjs` ile doğrulandı (sentetik veri; canlı
  Overpass bu ortamda engelli — bkz. KNOWN_ISSUES).
