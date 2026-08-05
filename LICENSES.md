# Lisanslar ve atıflar

## Veri

| Veri | Kaynak | Lisans / koşul |
|---|---|---|
| Yükseklik (Terrarium) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen) | Açık veri. Atıf: "Terrain: Mapzen / AWS Open Data". Altında SRTM, GMTED, NED gibi kamu veri setleri var |
| Uydu görüntüsü | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Atıf zorunlu: "Imagery © Esri, Maxar, Earthstar Geographics". Yayın öncesi kullanım koşullarını doğrulayın |
| Uydu görüntüsü (alternatif) | [Sentinel-2 cloudless](https://s2maps.eu) — EOX IT Services | 2020 katmanı CC BY-NC-SA 4.0; ticari kullanım için EOX ile anlaşma gerekir |
| Uydu görüntüsü (anahtarlı) | [MapTiler](https://www.maptiler.com/) | Kendi anahtarınız ve planınızın koşulları geçerli |
| Yollar, sokak lambaları | [OpenStreetMap](https://www.openstreetmap.org/) — Overpass API | ODbL 1.0. Atıf: "© OpenStreetMap katkıcıları" |
| Yer arama | [Nominatim](https://nominatim.org/) | OSM verisi, ODbL. [Kullanım politikası](https://operations.osmfoundation.org/policies/nominatim/): saniyede en fazla 1 istek — istemci bunu uygular |

Atıf metni oyun ekranının sağ altında sürekli görünür ve o an hangi kaynakların kullanıldığına
göre güncellenir.

## Kod ve varlıklar

- Oyun kodu bu deponun lisansına tabidir.
- **3B modeller indirilmez.** Uçak, araba ve gemi `src/vehicles/models.ts` içinde ilkel
  geometrilerden kod olarak üretilir; üçüncü taraf model lisansı yoktur.
- **Doku dosyası yoktur.** Arazinin stilize dokusu yükseklik verisinden çalışma anında üretilir.
- Yazı tipi olarak yalnızca sistem yazı tipleri kullanılır.

## Bağımlılıklar

| Paket | Lisans |
|---|---|
| [three](https://threejs.org/) | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Zlib |
| vite, typescript, vitest, @playwright/test (geliştirme) | MIT / Apache-2.0 |
