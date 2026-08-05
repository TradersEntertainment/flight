# flight ✈🚗⛵

Tarayıcıda çalışan, **gerçek dünya haritası** üzerinde geçen açık dünya oyunu. Gerçek yükseklik
verisi ve uydu görüntüleri üzerinde **uçakla uç, arabayla sür, gemiyle yüz** — istediğin yere
ışınlan, gece moduna geç, kapılardan geçerek yarış.

İlham: [hop.earth](https://hop.earth) · Plan: [PLAN.md](./PLAN.md)

```bash
npm install
npm run dev          # http://localhost:5173
```

Uydu görüntüsü sağlayıcısına doğrudan erişilemeyen ağlarda (ya da CI'da):

```bash
npm run dev -- --open '/?tiles=proxy'
```

## Kontroller

| Tuş | İşlev |
|---|---|
| `W` / `S` | Gaz — uçakta motor, arabada gaz/fren, gemide ileri/geri |
| `A` / `D` | Uçakta yatış, arabada direksiyon, gemide dümen |
| `↑` / `↓` | Uçakta burun aşağı / yukarı |
| `Q` / `E` | Uçakta yön dümeni |
| `Boşluk` | Arabada el freni (drift), uçakta tekerlek freni, gemide demir |
| `1` `2` `3` | Uçak / araba / gemi |
| `C` `R` `T` `G` `N` `H` `Esc` | Kamera · sıfırla · ara · yarış · gündüz-gece · yardım · ayarlar |

Gamepad ve dokunmatik de destekleniyor.

## Nasıl çalışıyor

**Arazi.** Dünya, Web Mercator tile'larından oluşan bir quadtree olarak akıtılır. Bir tile ekranda
belli bir piksel boyutunu aştığında dörde bölünür; çocuklar hazır olmadan çizilmez, bu yüzden
yüzeyde hiç delik açılmaz. LOD sınırlarındaki çatlaklar "etek" (skirt) geometrisiyle kapatılır.
Yükseklikler [Terrarium](https://registry.opendata.aws/terrain-tiles/) PNG'lerinden worker'da
çözülür ve global piksel uzayında bilinear örneklenir — komşu tile'lar ortak kenarda birebir aynı
yüksekliği okur.

**Koordinatlar.** Sahne, oyuncunun etrafına çapalanmış yerel bir düzlemdir ve birimi gerçek
metredir. Oyuncu 40 km uzaklaşınca çapa taşınır (float32 hassasiyeti için); araçlar, yollar ve
yarış kapıları bu kaymayı birlikte uygular.

**Görüntü.** Uydu görüntüsü opsiyoneldir: sağlayıcıya erişilemezse (çevrimdışı, kota dolmuş,
engellenmiş) yükseklik verisinden üretilen **stilize kabartma dokusu** devreye girer. Dünya hiçbir
koşulda boş kalmaz.

**Araçlar.** Fizik motoru yok. Uçak; kaldırma, sürükleme ve kontrol otoritesi hız fonksiyonları
olan bir arcade modeliyle uçar (perdövites, iniş/çarpma ayrımı, pistten kalkış dahil). Araba
araziyi dört nokta örneklemesiyle takip eder; el freniyle yanal tutuş düşer ve arka taraf kayar.
Gemi, şaderin çizdiği Gerstner dalgalarına gövdesini oturtur — CPU ve GPU aynı dalga tablosunu
kullanır.

**Gece.** Tweet'teki NFS Carbon havası: bloom, ay ışığı tonlaması, gerçek far ışıkları,
OpenStreetMap'ten akıtılan yollar ve boyunca dizilen sokak lambaları.

## Veri kaynakları

| Katman | Kaynak | Not |
|---|---|---|
| Yükseklik | AWS Terrain Tiles (Terrarium) | Ücretsiz, anahtarsız, z15'e kadar |
| Uydu görüntüsü | Esri World Imagery / Sentinel-2 cloudless / MapTiler | Opsiyonel; `?maptiler=ANAHTAR` |
| Yollar, lambalar | OpenStreetMap (Overpass) | Opsiyonel; erişilemezse atlanır |
| Yer arama | Yerleşik liste + Nominatim | Yerleşik liste çevrimdışı çalışır |

Attribution ekranda sürekli görünür. Lisans ayrıntıları: [LICENSES.md](./LICENSES.md).

## Komutlar

```bash
npm run dev        # geliştirme sunucusu (tile proxy dahil)
npm run build      # tip kontrolü + üretim derlemesi
npm test           # birim testler (vitest)
npm run test:e2e   # tarayıcı smoke testi (playwright)
```

## Bilinen sınırlar

[KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — deniz seviyesi altındaki karalar, göllerin su sayılmaması,
z15 arazi çözünürlüğü ve diğerleri.
