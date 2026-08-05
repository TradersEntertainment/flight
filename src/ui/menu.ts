/**
 * Settings and help panels.
 */

import { QUALITY, type QualityName, type Settings } from '../core/settings';
import { availableProviders } from '../world/imagery/providers';

type Modal = { backdrop: HTMLElement; close: () => void };

function createModal(parent: HTMLElement, title: string): Modal & { body: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal panel';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const closeButton = document.createElement('button');
  closeButton.className = 'close';
  closeButton.type = 'button';
  closeButton.textContent = '✕';
  const body = document.createElement('div');
  modal.append(closeButton, heading, body);
  backdrop.appendChild(modal);
  backdrop.style.display = 'none';
  parent.appendChild(backdrop);

  const close = (): void => {
    backdrop.style.display = 'none';
  };
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  return { backdrop, body, close };
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text, control);
  return row;
}

const QUALITY_LABEL: Record<QualityName, string> = {
  low: 'Düşük — akıcılık önce',
  medium: 'Orta — dengeli',
  high: 'Yüksek — detay önce',
};

export class SettingsPanel {
  private readonly modal: ReturnType<typeof createModal>;
  onChange: ((settings: Settings) => void) | null = null;

  constructor(parent: HTMLElement, private settings: Settings) {
    this.modal = createModal(parent, 'Ayarlar');
    this.build();
  }

  get isOpen(): boolean {
    return this.modal.backdrop.style.display !== 'none';
  }

  toggle(): void {
    this.modal.backdrop.style.display = this.isOpen ? 'none' : '';
  }

  close(): void {
    this.modal.close();
  }

  private build(): void {
    const body = this.modal.body;

    const quality = document.createElement('select');
    for (const name of Object.keys(QUALITY) as QualityName[]) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = QUALITY_LABEL[name];
      quality.appendChild(option);
    }
    quality.value = this.settings.quality;
    quality.addEventListener('change', () => this.patch({ quality: quality.value as QualityName }));

    const imagery = document.createElement('select');
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'Otomatik';
    imagery.appendChild(auto);
    for (const provider of availableProviders()) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.label;
      imagery.appendChild(option);
    }
    imagery.value = this.settings.imagery;
    imagery.addEventListener('change', () => this.patch({ imagery: imagery.value }));

    const invert = checkbox(this.settings.invertPitch, (v) => this.patch({ invertPitch: v }));
    const minimap = checkbox(this.settings.showMinimap, (v) => this.patch({ showMinimap: v }));
    const audio = checkbox(this.settings.audio, (v) => this.patch({ audio: v }));

    body.append(
      field('Grafik kalitesi', quality),
      field('Uydu görüntüsü', imagery),
      field('Uçakta ↑/↓ ters (uçuş simülatörü tarzı)', invert),
      field('Minimap', minimap),
      field('Ses', audio),
    );

    const note = document.createElement('p');
    note.style.cssText = 'color:var(--dim);font-size:.78rem;line-height:1.5;margin-top:1rem';
    note.textContent =
      'Uydu görüntüsü sağlayıcıya erişilemezse yükseklik verisinden üretilen stilize doku ' +
      'kullanılır — oyun her koşulda çalışır. Kendi MapTiler anahtarınızı ?maptiler=ANAHTAR ' +
      'ile ekleyebilirsiniz.';
    body.appendChild(note);
  }

  private patch(change: Partial<Settings>): void {
    this.settings = { ...this.settings, ...change };
    this.onChange?.(this.settings);
  }
}

function checkbox(value: boolean, onChange: (value: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

const KEYS: Array<[string, string]> = [
  ['W / S', 'Gaz — uçakta motor gücü, arabada gaz/fren, gemide ileri/geri'],
  ['A / D', 'Uçakta yatış (roll), arabada direksiyon, gemide dümen'],
  ['↑ / ↓', 'Uçakta tırmanış / alçalma'],
  ['Q / E', 'Uçakta yön dümeni (yaw)'],
  ['Boşluk', 'Arabada el freni (drift), uçakta tekerlek freni, gemide demir'],
  ['1 / 2 / 3', 'Uçak / araba / gemi — uygun zemin otomatik bulunur'],
  ['C', 'Kamera: yakın, uzak, burun'],
  ['R', 'Sıfırla — son güvenli konuma dön'],
  ['T', 'Dünyada yer ara ve ışınlan'],
  ['G', 'Yarış: rotayı başlat / bitir'],
  ['N', 'Sabah → gündüz → gün batımı → gece'],
  ['H', 'Bu yardım ekranı'],
  ['Esc', 'Ayarlar'],
];

export class HelpPanel {
  private readonly modal: ReturnType<typeof createModal>;

  constructor(parent: HTMLElement) {
    this.modal = createModal(parent, 'Kontroller');
    const grid = document.createElement('div');
    grid.className = 'keys';
    for (const [key, description] of KEYS) {
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = description;
      grid.append(kbd, desc);
    }
    this.modal.body.appendChild(grid);

    const tip = document.createElement('p');
    tip.style.cssText = 'color:var(--dim);font-size:.8rem;line-height:1.6;margin-top:1.2rem';
    tip.innerHTML =
      'Uçakta kalkış: gazı <b>W</b> ile açın, hız 130 km/s civarına gelince <b>↑</b> ile ' +
      'tırmanışa geçin. Uçak kendini toparlar: tuşu bıraktığınızda kanatlar düzelir, ' +
      'burun da aşırı dikleşmez. Dönüş için <b>A/D</b> ile yatın, sonra <b>↑</b> ile ' +
      'çekin — dönüşü uçak tamamlar.<br>Bulunduğunuz yerin bağlantısı adres çubuğunda: ' +
      'kopyalayıp paylaşınca aynı noktada açılır.';
    this.modal.body.appendChild(tip);
  }

  get isOpen(): boolean {
    return this.modal.backdrop.style.display !== 'none';
  }

  toggle(): void {
    this.modal.backdrop.style.display = this.isOpen ? 'none' : '';
  }

  close(): void {
    this.modal.close();
  }
}
