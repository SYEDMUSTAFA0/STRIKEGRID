import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  ENEMY_SPECS,
  MAP_LIGHTING_PROFILES,
  MAP_SPECS,
  computeDirectionalDamageAngle,
  computeExplosionSplashDamage,
  getZoneAt,
} from './rules';
import { SoundEngine } from './Audio';
import { World } from './World';
import type { FragDetonationEvent, PropDamageOutcome } from './World';
import { Player } from './Player';
import { Weapons } from './Weapons';
import { Enemies } from './Enemies';
import type {
  GamePhase,
  GameSettings,
  HudRadarBlip,
  HudSnapshot,
  KillFeedEntry,
  MapId,
  WeaponId,
} from './types';

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class Engine {
  public readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private readonly sound: SoundEngine;
  private readonly world: World;
  private readonly player: Player;
  private readonly weapons: Weapons;
  private readonly enemies: Enemies;

  private phase: GamePhase = 'title';
  private settings: GameSettings;
  private wave = 1;
  private waveClearDelay = 0;
  private waveBannerTimer = 0;
  private waveClearBannerTimer = 0;
  private kills = 0;
  private headshots = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private killFeed: KillFeedEntry[] = [];
  private nextKillId = 1;

  private hitstopTimer = 0;
  private slowMoTimer = 0;
  private hitmarkerTimer = 0;
  private hitmarkerCrit = false;
  private hitmarkerKill = false;
  private damageFlash = 0;
  private heartbeatTimer = 0;
  private damageIndicators: Array<{ id: number; angleRad: number; life: number }> = [];
  private nextDamageId = 1;
  private readonly _playerFwdXZ = { x: 0, z: -1 };
  private defeatBeatTimer = 0;
  private isDefeatPending = false;

  private frameId = 0;
  private isDisposed = false;
  private lastTimestamp = 0;
  private elapsed = 0;
  private hudEmitAccum = 0;
  private titleTourAngle: number;
  private previewWeapon: WeaponId = 'rifle';
  private resizeObserver: ResizeObserver;

  private readonly onHudUpdate: (snapshot: HudSnapshot) => void;

  constructor(
    private readonly container: HTMLElement,
    initialSettings: GameSettings,
    onHudUpdate: (snapshot: HudSnapshot) => void,
  ) {
    this.settings = { ...initialSettings };
    this.titleTourAngle = MAP_LIGHTING_PROFILES[this.settings.mapId].tourStartAngle;
    this.onHudUpdate = onHudUpdate;
    this.isSoftwareGl = detectSoftwareGl();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = MAP_LIGHTING_PROFILES[this.settings.mapId].exposure;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, width / height, 0.05, 280);
    this.scene.add(this.camera);

    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const profile = MAP_LIGHTING_PROFILES[this.settings.mapId];
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        profile.bloomStrength,
        profile.bloomRadius,
        profile.bloomThreshold,
      );
      this.composer.addPass(this.bloomPass);
    }

    this.sound = new SoundEngine();
    this.sound.setMuted(this.settings.muted);

    this.world = new World(this.scene, this.renderer, this.isSoftwareGl, this.settings.mapId);
    this.applyMapLightingProfile(this.settings.mapId);
    this.world.setShadowQuality(this.settings.quality);
    this.world.setShellBounceHandler(() => this.sound.playShellClink());
    this.world.setGrenadeSoundHandlers(
      () => this.sound.playGrenadeBounce(),
      (urgent) => this.sound.playGrenadeBeep(urgent),
    );
    document.body.dataset.map = this.settings.mapId;

    this.player = new Player(this.camera, this.renderer.domElement, this.sound, () => {
      if (this.phase === 'playing') {
        this.pauseGame();
      }
    });
    this.player.sensitivity = this.settings.sensitivity;

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.weapons = new Weapons(
      this.camera,
      this.world,
      this.sound,
      maxAniso,
      this.settings.weaponSkin,
    );
    this.enemies = new Enemies(
      this.scene,
      this.world,
      this.sound,
      maxAniso,
      this.settings.weaponSkin,
    );

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.enterTitleMode();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this.handleResizeBound);

    this.lastTimestamp = performance.now();
    this.scheduleNextFrame();
  }

  private handleResizeBound = () => this.handleResize();

  private handleResize(): void {
    if (this.isDisposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    if (width <= 0 || height <= 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  }

  private applyMapLightingProfile(mapId: MapId): void {
    const profile = MAP_LIGHTING_PROFILES[mapId];
    this.renderer.toneMappingExposure = profile.exposure;
    this.scene.environmentIntensity = profile.envIntensity;
    if (this.bloomPass) {
      this.bloomPass.strength = profile.bloomStrength;
      this.bloomPass.radius = profile.bloomRadius;
      this.bloomPass.threshold = profile.bloomThreshold;
    }
  }

  setPreviewWeapon(weaponId: WeaponId): void {
    this.previewWeapon = weaponId;
    if (this.phase === 'title') {
      this.weapons.setShowcaseState(true, this.previewWeapon);
      this.renderNow();
    }
  }

  updateSettings(next: Partial<GameSettings>): void {
    const prevMapId = this.settings.mapId;
    const prevSkin = this.settings.weaponSkin;
    this.settings = { ...this.settings, ...next };
    this.player.sensitivity = this.settings.sensitivity;
    this.sound.setMuted(this.settings.muted);
    if (next.quality) {
      this.world.setShadowQuality(next.quality);
    }
    let needsRender = false;
    if (this.settings.weaponSkin !== prevSkin) {
      this.weapons.setSkin(this.settings.weaponSkin);
      this.enemies.setWeaponSkin(this.settings.weaponSkin);
      needsRender = true;
    }
    if (this.settings.mapId !== prevMapId) {
      this.world.loadMap(this.settings.mapId);
      this.applyMapLightingProfile(this.settings.mapId);
      this.titleTourAngle = MAP_LIGHTING_PROFILES[this.settings.mapId].tourStartAngle;
      document.body.dataset.map = this.settings.mapId;
      if (this.phase === 'title') {
        this.enemies.spawnTitleTourUnits();
        this.updateTitleTour(0);
      }
      needsRender = true;
    }
    if (needsRender) {
      this.renderNow();
      this.emitHudSnapshot();
    }
  }

  private renderNow(): void {
    if (this.isDisposed) return;
    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  enterTitleMode(): void {
    this.phase = 'title';
    document.body.dataset.state = 'title';
    document.body.dataset.map = this.settings.mapId;
    this.player.unlockPointer();
    this.player.clearInputs();
    this.sound.setWindActive(false);
    this.weapons.reset();
    this.weapons.setVisible(false);
    this.weapons.setShowcaseState(true, this.previewWeapon);
    this.world.clearPickups();
    this.world.clearDecals();
    this.enemies.spawnTitleTourUnits();
    this.titleTourAngle = MAP_LIGHTING_PROFILES[this.settings.mapId].tourStartAngle;
    this.updateTitleTour(0);
    this.renderNow();
    this.emitHudSnapshot();
  }

  deploy(requestLock = true): void {
    if (requestLock) {
      this.sound.unlock();
      this.sound.setWindActive(true);
    }

    if (this.world.currentMapId !== this.settings.mapId) {
      this.world.loadMap(this.settings.mapId);
    }
    this.applyMapLightingProfile(this.settings.mapId);
    document.body.dataset.map = this.settings.mapId;

    this.phase = 'playing';
    document.body.dataset.state = 'playing';
    this.wave = 1;
    this.waveClearDelay = 0;
    this.waveBannerTimer = 2.4;
    this.waveClearBannerTimer = 0;
    this.kills = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.killFeed = [];
    this.hitstopTimer = 0;
    this.slowMoTimer = 0;
    this.hitmarkerTimer = 0;
    this.hitmarkerCrit = false;
    this.hitmarkerKill = false;
    this.damageFlash = 0;
    this.heartbeatTimer = 0;
    this.damageIndicators = [];
    this.isDefeatPending = false;
    this.defeatBeatTimer = 0;

    this.player.reset(MAP_SPECS[this.settings.mapId].playerSpawn);
    this.weapons.reset();
    this.weapons.setShowcaseState(false);
    this.weapons.setVisible(true);
    this.world.clearPickups();
    this.world.clearDecals();
    this.enemies.spawnWave(1, this.player.position);

    if (requestLock) {
      this.player.lockPointer();
    }
    this.renderNow();
    this.emitHudSnapshot();
  }

  pauseGame(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    document.body.dataset.state = 'paused';
    this.player.unlockPointer();
    this.player.clearInputs();
    this.sound.setWindActive(false);
    this.emitHudSnapshot();
  }

  resumeGame(): void {
    if (this.phase !== 'paused') return;
    this.sound.unlock();
    this.sound.setWindActive(true);
    this.phase = 'playing';
    document.body.dataset.state = 'playing';
    this.player.clearInputs();
    this.player.lockPointer();
    this.emitHudSnapshot();
  }

  private triggerGameOver(): void {
    this.phase = 'gameover';
    document.body.dataset.state = 'gameover';
    this.player.unlockPointer();
    this.player.clearInputs();
    this.sound.setWindActive(false);
    this.emitHudSnapshot();
  }

  private scheduleNextFrame(): void {
    if (this.isDisposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.isDisposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick(): void {
    if (this.isDisposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    this.elapsed += dt;

    if (this.phase === 'title') {
      this.updateTitleTour(dt);
    } else if (this.phase === 'playing') {
      this.updatePlaying(dt);
    }

    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.scheduleNextFrame();
  }

  private updateTitleTour(dt: number): void {
    const profile = MAP_LIGHTING_PROFILES[this.settings.mapId];
    this.titleTourAngle += dt * 0.14;
    this.camera.position.set(
      Math.sin(this.titleTourAngle) * profile.tourRadius,
      profile.tourHeight + Math.sin(this.titleTourAngle * 1.7) * 0.9,
      Math.cos(this.titleTourAngle) * profile.tourRadius - 2,
    );
    this.camera.lookAt(
      profile.tourTarget[0],
      profile.tourTarget[1],
      profile.tourTarget[2],
    );
    this.camera.updateMatrixWorld();
    this.weapons.updateShowcase(dt, this.elapsed);
    this.world.update(dt, this.elapsed);
    this.enemies.update(dt, this.player, true, () => {});
  }

  private addDamageIndicator(attackerPos: THREE.Vector3): void {
    this.player.getForwardXZ(this._playerFwdXZ);
    const angleRad = computeDirectionalDamageAngle(
      this.player.position,
      this._playerFwdXZ,
      attackerPos,
    );
    this.damageIndicators.unshift({ id: this.nextDamageId++, angleRad, life: 1.15 });
    if (this.damageIndicators.length > 4) this.damageIndicators.length = 4;
  }

  private applyPlayerHit(dmg: number, attackerPos: THREE.Vector3): void {
    if (this.isDefeatPending) return;
    this.damageFlash = Math.min(0.95, this.damageFlash + 0.55);
    this.player.triggerImpactPunch(-3.4);
    this.addDamageIndicator(attackerPos);
    const died = this.player.takeDamage(dmg);
    this.emitHudSnapshot();
    if (died) {
      this.isDefeatPending = true;
      this.defeatBeatTimer = 0.48;
    }
  }

  private handlePropOutcome(outcome: PropDamageOutcome): void {
    if (!outcome.destroyed || outcome.kind !== 'barrel') return;

    const distToPlayer = Math.hypot(
      outcome.position.x - this.player.position.x,
      outcome.position.z - this.player.position.z,
    );
    this.sound.playExplosion(distToPlayer);
    this.player.addTrauma(
      Math.max(0.2, 0.72 * (1 - Math.min(1, distToPlayer / 24))),
    );
    this.player.triggerImpactPunch(-4.8);

    const blastResults = this.enemies.applyExplosionDamage(
      outcome.position,
      outcome.explosionRadius,
      outcome.explosionDamage,
    );
    let blastKills = 0;
    for (const br of blastResults) {
      if (br.killed) {
        blastKills++;
        this.kills++;
        const label = ENEMY_SPECS[br.archetype].label;
        this.killFeed.unshift({
          id: this.nextKillId++,
          text: `BARREL BLAST // ${label}`,
          headshot: false,
          archetype: br.archetype,
          timestamp: this.elapsed,
        });
      }
    }
    if (this.killFeed.length > 4) this.killFeed.length = 4;
    if (blastKills > 0) {
      this.hitmarkerTimer = 0.24;
      this.hitmarkerCrit = false;
      this.hitmarkerKill = true;
      if (this.enemies.getAliveCount() === 0) {
        this.slowMoTimer = 0.42;
      }
    }

    const playerSplash = computeExplosionSplashDamage(
      distToPlayer,
      outcome.explosionRadius,
      46,
    );
    if (playerSplash > 0) {
      this.applyPlayerHit(playerSplash, outcome.position);
    }
    this.emitHudSnapshot();
  }

  private handleFragDetonation(evt: FragDetonationEvent): void {
    const distToPlayer = Math.hypot(
      evt.position.x - this.player.position.x,
      evt.position.y - (this.player.position.y + 0.9),
      evt.position.z - this.player.position.z,
    );
    this.sound.playExplosion(distToPlayer);
    this.player.addTrauma(
      Math.max(0.26, 0.85 * (1 - Math.min(1, distToPlayer / 26))),
    );
    this.player.triggerImpactPunch(-5.2);

    const blastResults = this.enemies.applyExplosionDamage(
      evt.position,
      evt.radius,
      evt.maxDamage,
    );
    let fragKills = 0;
    for (const br of blastResults) {
      if (br.killed) {
        fragKills++;
        this.kills++;
        const label = ENEMY_SPECS[br.archetype].label;
        this.killFeed.unshift({
          id: this.nextKillId++,
          text: `FRAG // ${label}`,
          headshot: false,
          archetype: br.archetype,
          timestamp: this.elapsed,
        });
      }
    }
    if (this.killFeed.length > 4) this.killFeed.length = 4;
    if (blastResults.length > 0) {
      this.sound.playHitmarker(false, fragKills > 0);
      this.hitmarkerTimer = fragKills > 0 ? 0.26 : 0.18;
      this.hitmarkerCrit = false;
      this.hitmarkerKill = fragKills > 0;
      if (fragKills > 0 && this.enemies.getAliveCount() === 0) {
        this.slowMoTimer = 0.42;
      }
    }

    const propOutcomes = this.world.damagePropsInRadius(evt.position, evt.radius, evt.maxDamage);
    for (const o of propOutcomes) {
      this.handlePropOutcome(o);
    }

    const playerSplash = computeExplosionSplashDamage(distToPlayer, evt.radius, 52);
    if (playerSplash > 0) {
      this.applyPlayerHit(playerSplash, evt.position);
    }
    this.emitHudSnapshot();
  }

  private updatePlaying(rawDt: number): void {
    if (this.isDefeatPending) {
      this.defeatBeatTimer -= rawDt;
      this.damageFlash = Math.min(1, this.damageFlash + rawDt * 1.5);
      this.camera.rotation.z = THREE.MathUtils.damp(this.camera.rotation.z, 0.28, 8, rawDt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, 0.55, 7, rawDt);
      this.world.update(rawDt, this.elapsed, (evt) => this.handleFragDetonation(evt));
      if (this.defeatBeatTimer <= 0) {
        this.isDefeatPending = false;
        this.triggerGameOver();
      }
      return;
    }

    this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - rawDt);
    this.damageFlash = Math.max(0, this.damageFlash - rawDt * 1.85);
    this.waveBannerTimer = Math.max(0, this.waveBannerTimer - rawDt);
    this.waveClearBannerTimer = Math.max(0, this.waveClearBannerTimer - rawDt);
    for (let i = this.damageIndicators.length - 1; i >= 0; i--) {
      this.damageIndicators[i].life -= rawDt;
      if (this.damageIndicators[i].life <= 0) {
        this.damageIndicators.splice(i, 1);
      }
    }

    if (this.player.health <= 30 && this.player.health > 0) {
      this.heartbeatTimer -= rawDt;
      if (this.heartbeatTimer <= 0) {
        this.sound.playHeartbeat();
        this.heartbeatTimer = 0.92;
      }
    } else {
      this.heartbeatTimer = 0;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= rawDt;
      this.world.update(rawDt * 0.15, this.elapsed, (evt) => this.handleFragDetonation(evt));
      return;
    }

    let dt = rawDt;
    if (this.slowMoTimer > 0) {
      this.slowMoTimer = Math.max(0, this.slowMoTimer - rawDt);
      dt = rawDt * 0.36;
    }

    const weaponInputs = this.player.consumeWeaponInputs();
    const spec = this.weapons.getActiveSpec();
    const isAds =
      weaponInputs.adsHeld &&
      !this.player.isSprinting &&
      !this.weapons.isReloading &&
      !spec.isMelee &&
      !this.weapons.grenadeThrowing;

    const moveMetrics = this.player.update(
      dt,
      this.world.obstacles,
      this.world.ramps,
      spec.adsFov,
      isAds,
    );

    const weaponOut = this.weapons.update(
      dt,
      this.player,
      weaponInputs,
      moveMetrics,
      this.enemies.getHitboxMeshes(),
      (hit) => {
        if (!hit.isMelee) this.shotsHit++;
        const res = this.enemies.applyDamage(hit.enemyId, hit.damage, hit.isCrit);
        const killed = Boolean(res?.killed);
        this.sound.playHitmarker(hit.isCrit, killed);
        this.hitmarkerTimer = killed ? 0.22 : 0.16;
        this.hitmarkerCrit = hit.isCrit;
        this.hitmarkerKill = killed;

        if (killed && res) {
          this.kills++;
          if (hit.isCrit) this.headshots++;
          const waveFinished = this.enemies.getAliveCount() === 0;
          this.hitstopTimer = waveFinished ? 0.05 : 0.036;
          if (waveFinished) {
            this.slowMoTimer = 0.42;
          }
          this.player.addTrauma(0.14);

          const label = ENEMY_SPECS[res.archetype].label;
          this.killFeed.unshift({
            id: this.nextKillId++,
            text: hit.isMelee
              ? `KNIFE // ${label}`
              : hit.isCrit
                ? `HEADSHOT // ${label}`
                : `ELIMINATED ${label}`,
            headshot: hit.isCrit || hit.isMelee,
            archetype: res.archetype,
            timestamp: this.elapsed,
          });
          if (this.killFeed.length > 4) this.killFeed.length = 4;
          this.emitHudSnapshot(undefined);
        }
      },
      () => {
        this.shotsFired++;
      },
      (outcome) => this.handlePropOutcome(outcome),
      (origin, vel) => this.world.spawnFragGrenade(origin, vel),
    );

    this.enemies.update(dt, this.player, false, (dmg, attackerPos) => {
      this.applyPlayerHit(dmg, attackerPos);
    });

    for (let i = this.world.pickups.length - 1; i >= 0; i--) {
      const p = this.world.pickups[i];
      if (!p.active) continue;
      const dx = p.position.x - this.player.position.x;
      const dz = p.position.z - this.player.position.z;
      if (dx * dx + dz * dz < 1.85 * 1.85) {
        if (p.kind === 'health' && this.player.health >= this.player.maxHealth) {
          continue;
        }
        if (p.kind === 'health') {
          this.player.heal(30);
        } else {
          this.weapons.addAmmo(1);
        }
        this.sound.playPickup();
        p.active = false;
        this.scene.remove(p.mesh);
        this.world.pickups.splice(i, 1);
        this.emitHudSnapshot();
      }
    }

    const alive = this.enemies.getAliveCount();
    if (alive === 0) {
      if (this.waveClearDelay <= 0) {
        this.waveClearDelay = 2.2;
        this.waveClearBannerTimer = 1.65;
        this.sound.playWaveSwell();
        this.emitHudSnapshot(weaponOut.crosshairSpreadPx);
      } else {
        this.waveClearDelay -= rawDt;
        if (this.waveClearDelay <= 0) {
          this.wave++;
          this.waveBannerTimer = 2.4;
          this.player.heal(15);
          this.weapons.addAmmo(0.5);
          this.enemies.spawnWave(this.wave, this.player.position);
          this.emitHudSnapshot(weaponOut.crosshairSpreadPx);
        }
      }
    }

    this.world.update(dt, this.elapsed, (evt) => this.handleFragDetonation(evt));

    this.killFeed = this.killFeed.filter((k) => this.elapsed - k.timestamp < 4.5);

    this.hudEmitAccum += rawDt;
    if (this.hudEmitAccum >= 0.055) {
      this.hudEmitAccum = 0;
      this.emitHudSnapshot(weaponOut.crosshairSpreadPx);
    }
  }

  private emitHudSnapshot(crosshairSpread = 12): void {
    const spec = this.weapons.getActiveSpec();
    const ammo = this.weapons.getActiveAmmo();

    this.player.getForwardXZ(this._playerFwdXZ);
    const fx = this._playerFwdXZ.x;
    const fz = this._playerFwdXZ.z;
    const rx = -fz;
    const rz = fx;
    const radarRange = 38;
    const radarUnits = this.enemies.getRadarUnits();
    const radarBlips: HudRadarBlip[] = [];
    for (let i = 0; i < radarUnits.length; i++) {
      const u = radarUnits[i];
      const wx = u.x - this.player.position.x;
      const wz = u.z - this.player.position.z;
      let dx = (wx * rx + wz * rz) / radarRange;
      let dz = -(wx * fx + wz * fz) / radarRange;
      const mag = Math.hypot(dx, dz);
      if (mag > 0.92) {
        dx = (dx / mag) * 0.92;
        dz = (dz / mag) * 0.92;
      }
      radarBlips.push({ id: u.id, dx, dz, role: u.role, firing: u.firing });
    }

    this.onHudUpdate({
      phase: this.phase,
      mapId: this.settings.mapId,
      currentZone: getZoneAt(
        this.player.position.x,
        this.player.position.z,
        this.settings.mapId,
      ),
      weaponSkin: this.settings.weaponSkin,
      health: Math.round(this.player.health),
      maxHealth: this.player.maxHealth,
      wave: this.wave,
      enemiesRemaining: this.enemies.getAliveCount(),
      waveBannerTimer: this.waveBannerTimer,
      waveClearBannerTimer: this.waveClearBannerTimer,
      activeWeapon: this.weapons.activeId,
      ammoInMag: ammo.mag,
      magSize: spec.magSize,
      ammoReserve: ammo.reserve,
      isMeleeActive: Boolean(spec.isMelee),
      grenades: this.weapons.grenades,
      maxGrenades: this.weapons.maxGrenades,
      grenadeThrowing: this.weapons.grenadeThrowing,
      isReloading: this.weapons.isReloading,
      reloadProgress: this.weapons.isReloading
        ? Math.min(1, this.weapons.reloadElapsed / spec.reloadTime)
        : 0,
      isAds: this.player.isAds,
      isSprinting: this.player.isSprinting,
      isCrouching: this.player.isCrouching,
      isSliding: this.player.isSliding,
      crosshairSpread,
      hitmarkerTimer: this.hitmarkerTimer,
      hitmarkerCrit: this.hitmarkerCrit,
      hitmarkerKill: this.hitmarkerKill,
      damageFlash: this.damageFlash,
      damageIndicators: this.damageIndicators.map((d) => ({
        id: d.id,
        angleRad: d.angleRad,
        intensity: Math.max(0, Math.min(1, d.life / 1.15)),
      })),
      radarBlips,
      playerYaw: this.player.getYawRadians(),
      pointerLocked: this.player.controls.isLocked,
      killFeed: [...this.killFeed],
      stats: {
        wave: this.wave,
        kills: this.kills,
        headshots: this.headshots,
        shotsFired: this.shotsFired,
        shotsHit: this.shotsHit,
      },
    });
  }

  dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.handleResizeBound);

    this.enemies.dispose();
    this.weapons.dispose();
    this.player.dispose();
    this.world.dispose();
    this.sound.dispose();
    if (this.composer) {
      this.composer.dispose();
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
