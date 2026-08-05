/**
 * Built-in places.
 *
 * A curated list rather than a bundled gazetteer: it loads instantly, works with
 * no network, and covers the places people actually want to fly over. Anything
 * else is found through the online geocoder in ui/search.ts.
 */

export type PlaceKind = 'airport' | 'city' | 'landmark' | 'nature' | 'route';

export interface Place {
  name: string;
  lon: number;
  lat: number;
  kind: PlaceKind;
  /** Country or region, shown as the secondary line. */
  region?: string;
  /** IATA code or similar short tag. */
  code?: string;
  /** Suggested vehicle when arriving. */
  vehicle?: 'plane' | 'car' | 'boat';
  /** Keywords for search, in addition to the name. */
  alt?: string[];
}

export const PLACES: Place[] = [
  // Türkiye — airports
  { name: 'İstanbul Havalimanı', code: 'IST', lon: 28.7519, lat: 41.2619, kind: 'airport', region: 'İstanbul', vehicle: 'plane' },
  { name: 'Sabiha Gökçen', code: 'SAW', lon: 29.3092, lat: 40.8986, kind: 'airport', region: 'İstanbul', vehicle: 'plane' },
  { name: 'Antalya Havalimanı', code: 'AYT', lon: 30.8005, lat: 36.8987, kind: 'airport', region: 'Antalya', vehicle: 'plane' },
  { name: 'Esenboğa', code: 'ESB', lon: 32.9951, lat: 40.1281, kind: 'airport', region: 'Ankara', vehicle: 'plane' },
  { name: 'Adnan Menderes', code: 'ADB', lon: 27.1568, lat: 38.2924, kind: 'airport', region: 'İzmir', vehicle: 'plane' },
  { name: 'Milas-Bodrum', code: 'BJV', lon: 27.6643, lat: 37.2506, kind: 'airport', region: 'Muğla', vehicle: 'plane' },
  { name: 'Kapadokya Havalimanı', code: 'NAV', lon: 34.5347, lat: 38.7692, kind: 'airport', region: 'Nevşehir', vehicle: 'plane' },
  { name: 'Trabzon Havalimanı', code: 'TZX', lon: 39.7897, lat: 40.9951, kind: 'airport', region: 'Trabzon', vehicle: 'plane' },

  // Türkiye — cities and landmarks
  { name: 'Boğaziçi Köprüsü', lon: 29.0339, lat: 41.0451, kind: 'landmark', region: 'İstanbul', alt: ['bogazici', 'bosphorus'] },
  { name: 'Kız Kulesi', lon: 29.0041, lat: 41.0211, kind: 'landmark', region: 'İstanbul', alt: ['maiden tower'] },
  { name: 'Ayasofya', lon: 28.978, lat: 41.0086, kind: 'landmark', region: 'İstanbul', alt: ['hagia sophia'] },
  { name: 'Antalya (Konyaaltı)', lon: 30.6503, lat: 36.8579, kind: 'city', region: 'Antalya', vehicle: 'car' },
  { name: 'Mersin', lon: 34.6415, lat: 36.8121, kind: 'city', region: 'Mersin', vehicle: 'car' },
  { name: 'Antalya–Mersin sahil yolu (D400)', lon: 32.0, lat: 36.55, kind: 'route', region: 'Akdeniz', vehicle: 'car', alt: ['d400', 'sahil yolu'] },
  { name: 'Kapadokya (Göreme)', lon: 34.8289, lat: 38.6431, kind: 'nature', region: 'Nevşehir', alt: ['cappadocia', 'goreme'] },
  { name: 'Pamukkale', lon: 29.1246, lat: 37.9203, kind: 'nature', region: 'Denizli' },
  { name: 'Uludağ', lon: 29.1333, lat: 40.0833, kind: 'nature', region: 'Bursa' },
  { name: 'Ağrı Dağı', lon: 44.2803, lat: 39.7025, kind: 'nature', region: 'Ağrı', alt: ['ararat'] },
  { name: 'Nemrut Dağı', lon: 38.7411, lat: 37.9808, kind: 'nature', region: 'Adıyaman' },
  { name: 'Ölüdeniz', lon: 29.1204, lat: 36.5497, kind: 'nature', region: 'Muğla', vehicle: 'boat' },
  { name: 'Van Gölü', lon: 43.0, lat: 38.6333, kind: 'nature', region: 'Van', vehicle: 'boat' },
  { name: 'Salda Gölü', lon: 29.6833, lat: 37.55, kind: 'nature', region: 'Burdur', vehicle: 'boat' },
  { name: 'Sümela Manastırı', lon: 39.6586, lat: 40.6903, kind: 'landmark', region: 'Trabzon' },
  { name: 'Marmaris', lon: 28.2717, lat: 36.855, kind: 'city', region: 'Muğla', vehicle: 'boat' },
  { name: 'Ankara', lon: 32.8597, lat: 39.9334, kind: 'city', region: 'Türkiye' },
  { name: 'İzmir', lon: 27.1428, lat: 38.4237, kind: 'city', region: 'Türkiye' },

  // World — airports
  { name: 'Heathrow', code: 'LHR', lon: -0.4543, lat: 51.4706, kind: 'airport', region: 'London', vehicle: 'plane' },
  { name: 'Charles de Gaulle', code: 'CDG', lon: 2.5479, lat: 49.0097, kind: 'airport', region: 'Paris', vehicle: 'plane' },
  { name: 'JFK', code: 'JFK', lon: -73.7781, lat: 40.6413, kind: 'airport', region: 'New York', vehicle: 'plane' },
  { name: 'San Francisco', code: 'SFO', lon: -122.379, lat: 37.6213, kind: 'airport', region: 'California', vehicle: 'plane' },
  { name: 'Haneda', code: 'HND', lon: 139.7798, lat: 35.5494, kind: 'airport', region: 'Tokyo', vehicle: 'plane' },
  { name: 'Dubai', code: 'DXB', lon: 55.3644, lat: 25.2532, kind: 'airport', region: 'BAE', vehicle: 'plane' },
  { name: 'Innsbruck', code: 'INN', lon: 11.344, lat: 47.2602, kind: 'airport', region: 'Avusturya', vehicle: 'plane', alt: ['alps landing'] },
  { name: 'Queenstown', code: 'ZQN', lon: 168.7392, lat: -45.0211, kind: 'airport', region: 'Yeni Zelanda', vehicle: 'plane' },
  { name: 'Lukla', code: 'LUA', lon: 86.7297, lat: 27.6869, kind: 'airport', region: 'Nepal', vehicle: 'plane', alt: ['everest'] },

  // World — nature and landmarks worth flying
  { name: 'Everest', lon: 86.925, lat: 27.9881, kind: 'nature', region: 'Nepal / Tibet' },
  { name: 'Matterhorn', lon: 7.6586, lat: 45.9763, kind: 'nature', region: 'İsviçre / İtalya' },
  { name: 'Mont Blanc', lon: 6.8652, lat: 45.8326, kind: 'nature', region: 'Fransa / İtalya' },
  { name: 'Grand Canyon', lon: -112.1401, lat: 36.0544, kind: 'nature', region: 'Arizona' },
  { name: 'Yosemite Vadisi', lon: -119.5383, lat: 37.7456, kind: 'nature', region: 'California' },
  { name: 'Fuji Dağı', lon: 138.7274, lat: 35.3606, kind: 'nature', region: 'Japonya' },
  { name: 'Kilimanjaro', lon: 37.3556, lat: -3.0674, kind: 'nature', region: 'Tanzanya' },
  { name: 'Denali', lon: -151.0074, lat: 63.0692, kind: 'nature', region: 'Alaska' },
  { name: 'Torres del Paine', lon: -72.9884, lat: -50.9423, kind: 'nature', region: 'Şili' },
  { name: 'Milford Sound', lon: 167.8974, lat: -44.6414, kind: 'nature', region: 'Yeni Zelanda', vehicle: 'boat' },
  { name: 'Geiranger Fiyordu', lon: 7.2053, lat: 62.1008, kind: 'nature', region: 'Norveç', vehicle: 'boat' },
  { name: 'Santorini', lon: 25.4615, lat: 36.3932, kind: 'nature', region: 'Yunanistan', vehicle: 'boat' },
  { name: 'Golden Gate', lon: -122.4783, lat: 37.8199, kind: 'landmark', region: 'San Francisco', vehicle: 'car' },
  { name: 'Manhattan', lon: -73.9712, lat: 40.7831, kind: 'city', region: 'New York' },
  { name: 'Stelvio Geçidi', lon: 10.4543, lat: 46.5286, kind: 'route', region: 'İtalya', vehicle: 'car', alt: ['stelvio pass'] },
  { name: 'Transfăgărășan', lon: 24.6172, lat: 45.6017, kind: 'route', region: 'Romanya', vehicle: 'car' },
  { name: 'Büyük Okyanus Yolu', lon: 143.6, lat: -38.68, kind: 'route', region: 'Avustralya', vehicle: 'car', alt: ['great ocean road'] },
  { name: 'Amalfi Sahili', lon: 14.6027, lat: 40.634, kind: 'route', region: 'İtalya', vehicle: 'car' },
  { name: 'Ölü Deniz (Lut Gölü)', lon: 35.4732, lat: 31.5, kind: 'nature', region: 'Ürdün / İsrail' },
  { name: 'Rio de Janeiro', lon: -43.1729, lat: -22.9068, kind: 'city', region: 'Brezilya' },
  { name: 'Kapadokya balon rotası', lon: 34.8, lat: 38.65, kind: 'route', region: 'Nevşehir', vehicle: 'plane' },
];

const KIND_ICON: Record<PlaceKind, string> = {
  airport: '✈',
  city: '🏙',
  landmark: '◈',
  nature: '⛰',
  route: '⇄',
};

export function placeIcon(kind: PlaceKind): string {
  return KIND_ICON[kind];
}

function normalise(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');
}

/** Ranked substring search over the built-in places. */
export function searchPlaces(query: string, limit = 8): Place[] {
  const q = normalise(query.trim());
  if (!q) return [];
  const scored: Array<{ place: Place; score: number }> = [];
  for (const place of PLACES) {
    const name = normalise(place.name);
    const code = place.code ? normalise(place.code) : '';
    const region = place.region ? normalise(place.region) : '';
    const alt = (place.alt ?? []).map(normalise);

    let score = -1;
    if (code && code === q) score = 100;
    else if (name.startsWith(q)) score = 80 - name.length * 0.1;
    else if (alt.some((a) => a.startsWith(q))) score = 70;
    else if (name.includes(q)) score = 50;
    else if (alt.some((a) => a.includes(q))) score = 40;
    else if (region.includes(q)) score = 25;
    if (score >= 0) scored.push({ place, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.place);
}
