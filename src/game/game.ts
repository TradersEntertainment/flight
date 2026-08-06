/**
 * The game: world, vehicles, camera, UI and modes wired together.
 *
 * Everything that needs to happen in a fixed order each frame happens here, in
 * one place: step the vehicle, follow it with the camera, re-anchor the world if
 * the player has strayed, then stream terrain and draw.
 */

import { Vector3 } from 'three';
import { Engine } from '../core/engine';
import { Input } from '../core/input';
import { loadSettings, quality, saveSettings, type Settings } from '../core/settings';
import { World } from './world';
import { DEFAULT_SPAWN, readSpawnFromUrl, writeUrlState, type UrlState } from './spawn';
import { VehicleManager } from '../vehicles/manager';
import type { VehicleKind } from '../vehicles/types';
import { ChaseCamera } from '../camera/chase';
import {
  ActionChips,
  Attribution,
  Hud,
  LoadingBadge,
  PlaceBadge,
  RoadLabel,
  Toasts,
} from '../ui/hud';
import { Minimap } from '../ui/minimap';
import { SearchPanel, type SearchResult } from '../ui/search';
import { HelpPanel, SettingsPanel } from '../ui/menu';
import { RaceMode, formatTime } from '../modes/race';
import { TouchControls, hasTouch } from '../ui/touch';
import { AudioSystem } from '../audio';
import { isTimeOfDay, type TimeOfDay } from '../world/sky';

const TIME_LABEL: Record<TimeOfDay, string> = {
  dawn: 'Sabah',
  day: 'Gündüz',
  sunset: 'Gün batımı',
  night: 'Gece',
};
import { PlaneVehicle } from '../vehicles/plane';
import { CarVehicle } from '../vehicles/car';

export class Game {
  readonly world: World;
  readonly engine = new Engine();
  readonly input = new Input();
  readonly vehicles: VehicleManager;
  readonly camera = new ChaseCamera();
  readonly race = new RaceMode();
  readonly audio: AudioSystem;

  private settings: Settings;
  private readonly ui: HTMLElement;
  private readonly hud: Hud;
  private readonly toasts: Toasts;
  private readonly minimap: Minimap;
  private readonly search: SearchPanel;
  private readonly settingsPanel: SettingsPanel;
  private readonly help: HelpPanel;
  private readonly badge: PlaceBadge;
  private readonly attribution: Attribution;
  private readonly roadLabel: RoadLabel;
  private readonly actions: ActionChips;
  private readonly loading: LoadingBadge;
  private readonly touch: TouchControls | null;
  private readonly raceHud = document.createElement('div');
  private readonly countdown = document.createElement('div');
  private placeName: string;
  private booted = false;
  private bootElapsed = 0;
  /**
   * A teleport that is still waiting for terrain.
   *
   * Placement needs to know how high the ground is, and right after a jump the
   * elevation for the destination has not arrived — every sample reads sea
   * level. Placing then puts an aeroplane inside a mountain and a boat on dry
   * land, so the destination is re-applied once real data shows up.
   */
  private pendingArrival: { place: SearchResult; deadline: number } | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settings = loadSettings();
    this.audio = new AudioSystem(this.settings.audio);
    const spawn = readSpawnFromUrl();
    this.placeName = spawn.name ?? DEFAULT_SPAWN.name ?? '';
    this.ui = uiRoot;

    this.world = new World({ canvas, settings: this.settings, spawn });
    this.vehicles = new VehicleManager(this.world);
    this.world.scene.add(this.vehicles.group);
    this.world.scene.add(this.race.group);

    this.hud = new Hud(uiRoot);
    this.badge = new PlaceBadge(uiRoot);
    this.minimap = new Minimap(uiRoot);
    this.toasts = new Toasts(uiRoot);
    this.search = new SearchPanel(uiRoot);
    this.settingsPanel = new SettingsPanel(uiRoot, this.settings);
    this.help = new HelpPanel(uiRoot);
    this.attribution = new Attribution(uiRoot);
    this.roadLabel = new RoadLabel(uiRoot);
    this.actions = new ActionChips(uiRoot);
    this.loading = new LoadingBadge(uiRoot);
    this.touch = hasTouch() ? new TouchControls(uiRoot, this.input) : null;

    this.raceHud.className = 'race-hud panel';
    this.raceHud.style.display = 'none';
    uiRoot.appendChild(this.raceHud);
    this.countdown.className = 'countdown';
    this.countdown.style.display = 'none';
    uiRoot.appendChild(this.countdown);

    this.applyStartState(spawn);
    this.wireEvents();
    this.wireLoop();
  }

  private applyStartState(spawn: UrlState): void {
    if (spawn.time && isTimeOfDay(spawn.time)) this.world.sky.setTimeOfDay(spawn.time, true);
    const requested = spawn.vehicle ?? DEFAULT_SPAWN.vehicle;
    const kind: VehicleKind =
      requested === 'car' || requested === 'boat' || requested === 'plane' ? requested : 'car';
    const heading = ((spawn.heading ?? 0) * Math.PI) / 180;
    // The anchor is the spawn point, so the world origin is where we start.
    this.vehicles.start(kind, {
      position: new Vector3(0, spawn.altitude ?? 0, 0),
      heading,
      speed: 0,
      // A spawn with no altitude starts on the ground: the runway at Istanbul.
      airborne: (spawn.altitude ?? 0) > 5,
    });
    this.hud.setVehicle(kind);
    // The ground under the spawn has not loaded yet, so this first placement
    // uses sea level. Re-apply it once real elevation arrives — Mecidiyeköy is
    // 113 m up, and without this the car spends its first seconds underground.
    this.pendingArrival = {
      place: {
        lon: spawn.lon,
        lat: spawn.lat,
        name: this.placeName,
        kind: 'city',
        vehicle: kind,
      },
      deadline: performance.now() + 20_000,
    };
    this.minimap.setVisible(this.settings.showMinimap);
    this.applyInvertPitch();
    this.attribution.set(this.world.attribution);
  }

  private wireEvents(): void {
    this.world.onNotice = (message) => this.toasts.show(message);

    // Browsers only allow audio to start from a gesture, so the first key or
    // tap builds the graph; until then the game is silent.
    const startAudio = (): void => this.audio.start();
    window.addEventListener('keydown', startAudio, { once: true });
    window.addEventListener('pointerdown', startAudio, { once: true });

    this.vehicles.onRelocate = (kind, distance) => {
      const km = distance > 1200 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
      const what = kind === 'boat' ? 'En yakın suya' : 'En yakın karaya';
      this.toasts.show(`${what} taşındınız (${km}).`);
    };

    this.hud.onSelectVehicle = (kind) => this.switchVehicle(kind);
    this.actions.onHome = () => this.goHome();
    this.actions.onShare = () => void this.shareLocation();
    this.actions.onSearch = () => {
      this.search.open();
      this.input.captured = true;
    };
    this.input.on('vehiclePlane', () => this.switchVehicle('plane'));
    this.input.on('vehicleCar', () => this.switchVehicle('car'));
    this.input.on('vehicleBoat', () => this.switchVehicle('boat'));

    this.input.on('camera', () => {
      const mode = this.camera.cycleMode();
      this.toasts.show(`Kamera: ${mode === 'chase' ? 'yakın' : mode === 'far' ? 'uzak' : 'burun'}`, 1600);
    });
    this.input.on('reset', () => {
      this.vehicles.active.reset(this.world);
      this.camera.reset();
    });
    this.input.on('timeOfDay', () => {
      this.toasts.show(TIME_LABEL[this.world.sky.cycle()], 1600);
    });
    this.input.on('help', () => this.help.toggle());
    this.input.on('menu', () => {
      if (this.search.isOpen) this.search.close();
      else if (this.help.isOpen) this.help.close();
      else this.settingsPanel.toggle();
    });
    this.input.on('search', () => {
      this.search.toggle();
      this.input.captured = this.search.isOpen;
    });
    this.input.on('race', () => this.toggleRace());

    this.search.onClose = () => {
      this.input.captured = false;
    };
    this.search.onPick = (place) => this.teleportTo(place);

    this.settingsPanel.onChange = (settings) => this.applySettings(settings);

    this.race.onCountdown = (value) => {
      this.countdown.style.display = value > 0 ? '' : 'none';
      this.countdown.textContent = value > 0 ? String(value) : '';
      if (value === 0) setTimeout(() => (this.countdown.style.display = 'none'), 400);
    };
    this.race.onCheckpoint = (remaining) => {
      this.toasts.show(`Kapı geçildi — ${remaining} kaldı`, 1200);
    };
    this.race.onFinish = (result) => {
      this.raceHud.style.display = 'none';
      const best = result.improved ? 'Yeni rekor!' : `En iyi: ${formatTime(result.best)}`;
      this.toasts.show(`Yarış bitti — ${formatTime(result.time)} · ${best}`, 6000);
    };
  }

  private wireLoop(): void {
    this.engine.onStep((dt) => {
      this.input.pollGamepad();
      this.touch?.apply();
      this.vehicles.step(dt, this.input);
      this.input.clearVirtual();
    });

    this.engine.onFrame((dt) => {
      const target = this.vehicles.active.getCameraTarget();
      this.vehicles.frame(dt);
      this.camera.update(dt, this.world.camera, target, this.world);

      // Re-anchoring keeps float precision usable; everything holding world
      // coordinates has to move with it.
      const delta = this.world.maybeReanchor(this.world.camera.position);
      if (delta) {
        this.vehicles.shift(delta);
        this.camera.shift(delta);
        this.race.shift(delta);
        this.world.camera.position.x += delta.x;
        this.world.camera.position.z += delta.z;
      }

      // Headlights follow the sky, and go out with the car.
      const car = this.vehicles.active;
      if (car instanceof CarVehicle) car.headlightPower = this.world.sky.nightAmount;

      this.world.update(dt);
      this.audio.update({ kind: this.vehicles.kind, ...this.vehicles.active.getAudio() });
      this.updatePendingArrival();
      this.race.update(dt, this.vehicles.active.getState().position);
      this.updateUi(dt);
    });

    this.engine.onRender((_alpha, frameDt) => this.world.render(frameDt));
  }

  /**
   * Puts a link to right here on the clipboard.
   *
   * The address bar used to be rewritten as the player moved, which made
   * sharing free but meant reopening the game dropped you wherever you last
   * wandered off to — usually somewhere unrecognisable, in the dark. Sharing is
   * now something you ask for.
   */
  private async shareLocation(): Promise<void> {
    const state = this.vehicles.active.getState();
    const ll = this.world.lonLatOf(state.position);
    writeUrlState({
      lon: ll.lon,
      lat: ll.lat,
      name: this.placeName,
      vehicle: this.vehicles.kind,
      heading: (state.heading * 180) / Math.PI,
      altitude: state.position.y - this.world.heightAt(state.position.x, state.position.z),
      time: this.world.sky.timeOfDay,
    });
    try {
      await navigator.clipboard.writeText(location.href);
      this.toasts.show('Bağlantı kopyalandı — bu noktada açılır.', 3500);
    } catch {
      // Clipboard permission denied: the address bar now holds the link anyway.
      this.toasts.show('Bağlantı adres çubuğunda — kopyalayıp paylaşabilirsiniz.', 4500);
    }
  }

  /** Back to where the game starts. */
  private goHome(): void {
    this.teleportTo({
      lon: DEFAULT_SPAWN.lon,
      lat: DEFAULT_SPAWN.lat,
      name: DEFAULT_SPAWN.name ?? 'Başlangıç',
      kind: 'city',
      vehicle: 'car',
    });
  }

  private updateUi(dt: number): void {
    const state = this.vehicles.active.getState();
    this.loading.set(!this.world.hasDetailAt(state.position.x, state.position.z, 12));
    const reading = this.vehicles.active.getHud();
    this.hud.update(reading);
    this.roadLabel.set(reading.surface);

    if (this.settings.showMinimap) {
      this.minimap.setNight(this.world.sky.nightAmount);
      this.minimap.update(
        this.world,
        { x: state.position.x, z: state.position.z },
        state.heading,
        this.vehicles.kind,
        this.race.markers,
      );
    }

    if (this.race.isActive && this.race.elapsed > 0) {
      this.raceHud.style.display = '';
      this.raceHud.innerHTML = `<div class="time">${formatTime(this.race.elapsed)}</div>
        <div class="sub">${this.race.remaining} kapı kaldı</div>`;
    }

    const ll = this.world.lonLatOf(state.position);
    this.badge.set(this.placeName, ll.lon, ll.lat);

    if (!this.booted) this.checkBoot(dt);
  }

  /**
   * Hides the loading screen once there is a world to look at.
   *
   * With a hard deadline: if the elevation service cannot be reached the player
   * would otherwise sit in front of "loading" forever. Better to say what is
   * wrong and let them in — the game runs, it is just flat.
   */
  private checkBoot(dt: number): void {
    this.bootElapsed += dt;
    const stats = this.world.terrain.stats;
    const status = document.querySelector('.boot-status');
    const stalled = this.bootElapsed > 20 && stats.maxZoom < 10;
    if (status) {
      status.textContent = stalled
        ? 'arazi verisine ulaşılamıyor — bağlantınızı kontrol edin'
        : `arazi yükleniyor — ${stats.drawn} parça, z${stats.maxZoom}`;
    }
    // The ground under the player has to be real before the world is revealed.
    // Terrain reads as sea level until its tile arrives, so letting the player
    // in early drops them inside the hill they are standing on.
    const position = this.vehicles.active.getState().position;
    const ready =
      stats.maxZoom >= 12 && stats.drawn > 4 && this.world.hasDetailAt(position.x, position.z, 12);
    if (!ready && this.bootElapsed < 35) return;

    this.booted = true;
    const boot = document.getElementById('boot');
    boot?.classList.add('hidden');
    setTimeout(() => boot?.remove(), 700);
    this.toasts.show(
      ready
        ? 'H tuşu kontroller · T tuşu dünyada ara · 1/2/3 araç değiştir'
        : 'Arazi verisi gelmedi; oyun düz bir dünyada çalışıyor.',
      7000,
    );
  }

  private switchVehicle(kind: VehicleKind): void {
    if (!this.vehicles.switchTo(kind)) return;
    this.hud.setVehicle(kind);
    this.camera.reset();
    if (this.race.isActive) {
      this.race.clear();
      this.raceHud.style.display = 'none';
      this.toasts.show('Araç değişti — yarış iptal edildi.', 2600);
    }
  }

  private toggleRace(): void {
    if (this.race.isActive) {
      this.race.clear();
      this.raceHud.style.display = 'none';
      this.toasts.show('Yarış iptal edildi.', 2000);
      return;
    }
    const state = this.vehicles.active.getState();
    this.race.start(this.world, state.position, state.heading, this.vehicles.kind);
    this.toasts.show('Yarış: kapılardan sırayla geçin.', 3000);
  }

  private teleportTo(place: SearchResult): void {
    // Re-anchor to the destination so the local plane is centred there, then
    // place the vehicle at the new origin.
    this.world.anchor.moveTo(place.lon, place.lat);
    this.world.warmUpAt(place.lon, place.lat);
    this.placeName = place.name;

    const kind = place.vehicle ?? this.vehicles.kind;
    if (kind !== this.vehicles.kind) {
      this.vehicles.switchTo(kind);
      this.hud.setVehicle(kind);
    }
    this.applyArrival(place);
    this.camera.reset();
    this.race.clear();
    this.raceHud.style.display = 'none';
    this.toasts.show(`${place.name} — ışınlandınız.`, 3000);
    // Terrain for the destination is still streaming; re-place once it lands.
    this.pendingArrival = { place, deadline: performance.now() + 12_000 };
  }

  private applyArrival(place: SearchResult): void {
    const state = this.vehicles.active.getState();
    this.vehicles.teleport({
      position: new Vector3(0, 0, 0),
      heading: state.heading,
      speed: state.speed,
      airborne: this.vehicles.kind === 'plane' ? true : undefined,
    });
    void place;
  }

  /** Re-applies a teleport once the destination's elevation has loaded. */
  private updatePendingArrival(): void {
    if (!this.pendingArrival) return;
    const ready = this.world.hasDetailAt(0, 0, 11);
    if (!ready && performance.now() < this.pendingArrival.deadline) return;
    const { place } = this.pendingArrival;
    this.pendingArrival = null;
    if (!ready) return; // gave up waiting; leave the player where they are
    this.applyArrival(place);
    this.camera.reset();
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    saveSettings(settings);
    this.world.applySettings(settings);
    this.audio.setEnabled(settings.audio);
    if (settings.audio) this.audio.start();
    this.minimap.setVisible(settings.showMinimap);
    this.applyInvertPitch();
    this.attribution.set(this.world.attribution);
    this.toasts.show(`Ayarlar güncellendi (${quality(settings).meshSegments} segment).`, 2000);
  }

  private applyInvertPitch(): void {
    // The aeroplane keeps the setting whether or not it is the active vehicle;
    // reading it off the active one meant the preference silently did nothing
    // when it was changed while driving.
    const plane = this.vehicles.get('plane');
    if (plane instanceof PlaneVehicle) plane.invertPitch = this.settings.invertPitch;
  }

  start(): void {
    this.engine.start();
  }

  dispose(): void {
    this.engine.stop();
    this.audio.dispose();
    this.vehicles.dispose();
    this.race.clear();
    this.world.dispose();
    this.ui.innerHTML = '';
  }
}
