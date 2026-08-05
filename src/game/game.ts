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
import { Attribution, Hud, PlaceBadge, Toasts } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import { SearchPanel, type SearchResult } from '../ui/search';
import { HelpPanel, SettingsPanel } from '../ui/menu';
import { RaceMode, formatTime } from '../modes/race';
import { PlaneVehicle } from '../vehicles/plane';

const URL_UPDATE_INTERVAL = 5;

export class Game {
  readonly world: World;
  readonly engine = new Engine();
  readonly input = new Input();
  readonly vehicles: VehicleManager;
  readonly camera = new ChaseCamera();
  readonly race = new RaceMode();

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
  private readonly raceHud = document.createElement('div');
  private readonly countdown = document.createElement('div');
  private placeName: string;
  private urlTimer = 0;
  private booted = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settings = loadSettings();
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
    if (spawn.time === 'day' || spawn.time === 'sunset' || spawn.time === 'night') {
      this.world.sky.setTimeOfDay(spawn.time, true);
    }
    const kind: VehicleKind =
      spawn.vehicle === 'car' || spawn.vehicle === 'boat' ? spawn.vehicle : 'plane';
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
    this.minimap.setVisible(this.settings.showMinimap);
    this.applyInvertPitch();
    this.attribution.set(this.world.attribution);
  }

  private wireEvents(): void {
    this.world.onNotice = (message) => this.toasts.show(message);

    this.vehicles.onRelocate = (kind, distance) => {
      const km = distance > 1200 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
      const what = kind === 'boat' ? 'En yakın suya' : 'En yakın karaya';
      this.toasts.show(`${what} taşındınız (${km}).`);
    };

    this.hud.onSelectVehicle = (kind) => this.switchVehicle(kind);
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
      const next = this.world.sky.cycle();
      this.toasts.show(
        next === 'day' ? 'Gündüz' : next === 'sunset' ? 'Gün batımı' : 'Gece',
        1600,
      );
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

      this.world.update(dt);
      this.race.update(dt, this.vehicles.active.getState().position);
      this.updateUi(dt);
    });

    this.engine.onRender(() => this.world.render());
  }

  private updateUi(dt: number): void {
    const state = this.vehicles.active.getState();
    this.hud.update(this.vehicles.active.getHud());

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

    this.urlTimer += dt;
    if (this.urlTimer > URL_UPDATE_INTERVAL) {
      this.urlTimer = 0;
      writeUrlState({
        lon: ll.lon,
        lat: ll.lat,
        name: this.placeName,
        vehicle: this.vehicles.kind,
        heading: (state.heading * 180) / Math.PI,
        altitude: state.position.y - this.world.heightAt(state.position.x, state.position.z),
        time: this.world.sky.timeOfDay,
      });
    }

    if (!this.booted) this.checkBoot();
  }

  private checkBoot(): void {
    const stats = this.world.terrain.stats;
    const status = document.querySelector('.boot-status');
    if (status) status.textContent = `arazi yükleniyor — ${stats.drawn} parça, z${stats.maxZoom}`;
    if (stats.maxZoom >= 12 && stats.drawn > 4) {
      this.booted = true;
      const boot = document.getElementById('boot');
      boot?.classList.add('hidden');
      setTimeout(() => boot?.remove(), 700);
      this.toasts.show('H tuşu kontroller · T tuşu dünyada ara · 1/2/3 araç değiştir', 7000);
    }
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
    const state = this.vehicles.active.getState();
    this.vehicles.teleport({
      position: new Vector3(0, 0, 0),
      heading: state.heading,
      speed: state.speed,
      airborne: this.vehicles.kind === 'plane' ? true : undefined,
    });
    this.camera.reset();
    this.race.clear();
    this.raceHud.style.display = 'none';
    this.toasts.show(`${place.name} — ışınlandınız.`, 3000);
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    saveSettings(settings);
    this.world.applySettings(settings);
    this.minimap.setVisible(settings.showMinimap);
    this.applyInvertPitch();
    this.attribution.set(this.world.attribution);
    this.toasts.show(`Ayarlar güncellendi (${quality(settings).meshSegments} segment).`, 2000);
  }

  private applyInvertPitch(): void {
    const plane = this.vehicles.active;
    if (plane instanceof PlaneVehicle) plane.invertPitch = this.settings.invertPitch;
  }

  start(): void {
    this.engine.start();
  }

  dispose(): void {
    this.engine.stop();
    this.vehicles.dispose();
    this.race.clear();
    this.world.dispose();
    this.ui.innerHTML = '';
  }
}
