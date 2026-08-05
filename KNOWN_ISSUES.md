# Bilinen sınırlar

Bunlar hata değil, bilinçli takaslar ya da veri kaynaklarının doğal sınırları. Her biri için
sebep ve (varsa) çözüm yolu yazılı.

## Denizin dibi yok, su tespiti yükseklikten yapılıyor

Terrarium veri setinde **batimetri yok**: açık deniz her yerde tam olarak 0.0 m okunur (ölçüldü —
Ege, Marmara, Akdeniz, Atlantik hepsi 0.0). Bu yüzden su testi "yükseklik ≤ 0", kara testi
"yükseklik > 1 m" olarak tanımlandı. Sonuçları:

- **Deniz tabanı düzdür.** Derinlik yoktur; su rengi derinliğe göre değişmez, sığ/derin ayrımı
  yapılamaz. Su yüzeyi altındaki arazi, z-fighting'i önlemek için 2.5 m aşağı çekilir.
- **Deniz seviyesinin altındaki karalar su sayılır.** Hollanda polderleri, Lut Gölü çevresi,
  Death Valley. Buralarda gemiyle "yüzülebilir".
- **Yükseltideki göller su sayılmaz.** Van Gölü (1640 m), Salda, Sapanca — deniz düzlemi yalnızca
  y=0'dadır, dolayısıyla bu göller kara olarak render edilir ve gemi karaya oturur.
- **Nehirler yok.** Terrarium çözünürlüğünde (z15 ≈ 23–30 m) çoğu nehir yatağı zaten görünmez.

Çözüm yolu: OSM su poligonlarını (`water-polygons`) tile'layıp maske olarak kullanmak, derinlik
için ayrı bir batimetri seti (GEBCO) eklemek. Plan dışında bırakıldı: her ikisi de kendi tile
pipeline'ını gerektiriyor.

## Araç, gördüğü yüzeyde durur — o yüzey her zaman en ince veri değildir

Araçların zemin yüksekliği, arazinin **o an çizdiği** üçgenden hesaplanır (`Terrain.surfaceHeightAt`),
en ince yükseklik verisinden değil. Sebebi: LOD henüz yetişmemişken çizilen yüzey bir-iki kademe
kaba olur ve ince veriye oturtulan araç, oyuncunun açıkça gördüğü sırtın içinde kalır — dağda
1.9 m'ye kadar ölçüldü.

Bunun kabul edilen sonucu: arazi kabayken tümsekler yumuşaktır, LOD inceldikçe zemin altınızda
biraz değişir. Doğru olan takas bu; alternatifi aracın yere gömülmüş görünmesi.
`scripts/sinkCheck.mjs` bu farkı ölçer (`sank` değeri pozitifse gömülme var).

## Arazi çözünürlüğü z15'te biter

Terrarium verisi z15'e kadar var; bu ekvatorda ~30 m, Türkiye enlemlerinde ~23 m örnek aralığı
demek. Uydu görüntüsü z19'a kadar inebildiği için görüntü keskinleşmeye devam eder ama **geometri
yumuşak kalır**: tek tek binalar, kaldırımlar, dar vadi tabanları yoktur. Yerden bakışta bunu
telafi etmek için şaderde mesafeyle sönümlenen prosedürel detay var.

Araba modunda pratik sonucu: tepeler ve virajlar gerçek, ama yol yatağı gerçek yol yüzeyi değil —
arazi yüzeyidir. OSM yol şeritleri bunun üzerine 45 cm yükseltilerek çizilir.

## Yollar, lambalar ve binalar Overpass'a bağlı

Yol ve bina geometrisi genel Overpass sunucularından çekilir. Sunucu yoğunsa, engelliyse ya da
çevrimdışıysa o hücre boş kalır ve oyun bu katmanlar olmadan devam eder — hiçbiri oynanış için
zorunlu değildir. Her iki katman tek bir istek sırasından geçer (aynı anda tek sorgu), çünkü
Overpass gönüllü işletilen paylaşımlı bir servistir.

Yoğun kullanım için kendi Overpass instance'ınızı ya da önceden hazırlanmış bir vektör tile
setini koymak gerekir.

**Bu depoda canlı Overpass yolu doğrulanamadı:** geliştirme ortamının ağ politikası tüm Overpass
sunucularını engelliyor. Ayrıştırma, üçgenleme, şerit ve lamba geometrisi birim testlerle;
render + sürüş hattı ise `scripts/osmPreview.mjs` ile sentetik veri enjekte edilerek doğrulandı.
Ağ isteğinin kendisi gerçek bir sunucuya karşı denenmedi.

## Köprüler basit tabliyedir

`bridge` etiketli yollar iki ucu arasında düz bir tabliye olarak kurulur ve yeterince yüksekse
altına ayak konur. Askı halatları, kule direkleri ve kemerler yoktur — Boğaz Köprüsü'nden
geçebilirsiniz ama uzaktan bakınca asma köprü gibi görünmez. Tüneller hiç çizilmez.

## Binaların sınırları

- **Sadece kapalı yollar (way).** Avlulu binalar ve bazı büyük kompleksler OSM'de multipolygon
  ilişkisi olarak tutulur; delik destekli üçgenleme gerektirdiği için bunlar çizilmez.
- **Çatılar düz.** `roof:shape` etiketi kullanılmaz; kırma/beşik çatı yoktur.
- **İç mekân yok, kapı/giriş yok.** Binalar katı kütlelerdir.
- **Çarpışma yok.** Araba binaların içinden geçer; çarpışma yalnızca zeminledir.
- **Yükseklik çoğu zaman tahmindir.** `height` etiketi varsa aynen kullanılır; yoksa
  `building:levels` bina tipine göre kat yüksekliğiyle çarpılır (ofis 3.9 m, konut 3.1 m,
  sanayi 5.5 m) ve zemin kat biraz daha yüksek sayılır. OSM'de `height` ya da `building:levels` etiketi olan bina
  Hiçbiri yoksa bina tipine göre makul bir varsayılan alır (ev 6.5 m, apartman 16 m, ofis 22 m).

## Uydu görüntüsü sağlayıcıları

Esri World Imagery kullanım koşulları doğrudan tile çekimi için gri alandır; yayına çıkarken
kendi anahtarınızla MapTiler/Mapbox kullanmanız önerilir (`?maptiler=ANAHTAR` ya da proxy
tarafında `MAPTILER_KEY`). Hiçbiri yoksa oyun stilize dokuya düşer ve tam olarak çalışmaya devam
eder.

## Re-anchor sırasında ölçek mikro-değişimi

Sahne, oyuncunun enlemine göre `cos(lat)` ile ölçeklenen yerel bir düzlemdir. Çapa taşındığında bu
katsayı değişir (0.3° enlem ≈ %0.5). Coğrafi olarak sabit her şey (arazi, yollar) konumunu
lon/lat'tan yeniden hesapladığı için yerinde kalır; yalnızca mutlak metre ölçeği bu kadar kayar.
Görsel olarak fark edilmez. Tam doğruluk için ECEF/elipsoit koordinatlara geçmek gerekir.

## Çarpışma yalnızca zeminle

Araçlar birbirine ve yapılara çarpmaz; 3B bina yoktur. Uçak "çarpma" durumu yalnızca zeminle
temas testidir (dik açı ya da yüksek dikey hız).

## Yarış rotaları prosedürel

Kapılar oyuncunun önüne, gidiş yönü boyunca hafif kıvrımla dizilir. Elle rota çizme editörü
(planın 8.2 maddesi) uygulanmadı; rota paylaşımı da bu yüzden yok. Konum paylaşımı (adres
çubuğundaki bağlantı) çalışıyor.

## Performans

Hedef, orta seviye bir dizüstünde 60 fps'tir. Geliştirme ortamındaki ölçümler yazılım
rasterizasyonuyla (SwiftShader) alındığı için gerçek GPU performansını temsil etmez; kare bütçesi
CPU tarafında ölçüldü (arazi güncellemesi ~0.25 ms, yükseklik örneği ~1.6 µs).

Mobilde otomatik olarak "Düşük" kalite seçilir; dokunmatik kontroller çalışır ama uzun süreli
mobil testi yapılmadı.
