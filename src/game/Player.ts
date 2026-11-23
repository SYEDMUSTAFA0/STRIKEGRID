import * as THREE from 'three';
import { getSurfaceFloorHeight, resolveCircleAABBs } from './rules';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { AABB2D, RampCollider } from './types';
import type { SoundEngine } from './Audio';

const STAND_EYE_HEIGHT = 1.72;
const CROUCH_EYE_HEIGHT = 1.08;
const SLIDE_EYE_HEIGHT = 0.88;
const PLAYER_RADIUS = 0.46;
const GRAVITY = 23.5;
const JUMP_SPEED = 8.4;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export interface PlayerSpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class Player {
  public readonly position = new THREE.Vector3(0, 0, 30);
  public readonly velocity = new THREE.Vector3();
  public readonly controls: PointerLockControls;

  public health = 100;
  public readonly maxHealth = 100;
  public isGrounded = true;
  public isCrouching = false;
  public isSprinting = false;
  public isSliding = false;
  public isAds = false;
  public sensitivity = 1.0;

  public lookDeltaX = 0;
  public lookDeltaY = 0;
  public trauma = 0;

  private currentEyeHeight = STAND_EYE_HEIGHT;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private walkDistance = 0;
  private stepThreshold = 2.15;
  private bobPhase = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private slideTimer = 0;
  private slideCooldown = 0;
  private slideDirX = 0;
  private slideDirZ = -1;
  private cameraRoll = 0;
  private impactFovOffset = 0;

  private readonly keys = new Set<string>();
  private mouseFireHeld = false;
  private mouseFireJustPressed = false;
  private mouseAdsHeld = false;
  private reloadJustPressed = false;
  private meleeJustPressed = false;
  private grenadeJustPressed = false;
  private interactJustPressed = false;
  private switchWeaponRequest: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null = null;
  private wheelDelta = 0;
  private isDraggingFallback = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lockTimestamp = 0;

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;
  private readonly onMouseDownBound: (e: MouseEvent) => void;
  private readonly onMouseUpBound: (e: MouseEvent) => void;
  private readonly onMouseMoveBound: (e: MouseEvent) => void;
  private readonly onMouseMoveCaptureBound: (e: MouseEvent) => void;
  private readonly onWheelBound: (e: WheelEvent) => void;
  private readonly onPointerLockChangeBound: () => void;
  private readonly onContextMenuBound: (e: MouseEvent) => void;
  private readonly onBlurBound: () => void;

  constructor(
    public readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    private readonly sound: SoundEngine,
    private readonly onEscapePause: () => void,
  ) {
    this.camera.rotation.order = 'YXZ';
    this.controls = new PointerLockControls(this.camera, this.domElement);

    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    this.onKeyUpBound = (e) => this.handleKeyUp(e);
    this.onMouseDownBound = (e) => this.handleMouseDown(e);
    this.onMouseUpBound = (e) => this.handleMouseUp(e);
    this.onMouseMoveBound = (e) => this.handleMouseMove(e);
    this.onWheelBound = (e) => this.handleWheel(e);
    this.onMouseMoveCaptureBound = (e) => {
      if (this.controls.isLocked) {
        const dx = e.movementX || 0;
        const dy = e.movementY || 0;
        if (
          performance.now() - this.lockTimestamp < 90 ||
          Math.abs(dx) > 150 ||
          Math.abs(dy) > 150
        ) {
          e.stopImmediatePropagation();
        }
      }
    };
    this.onPointerLockChangeBound = () => {
      if (document.pointerLockElement === this.domElement) {
        this.lockTimestamp = performance.now();
      }
    };
    this.onContextMenuBound = (e) => e.preventDefault();
    this.onBlurBound = () => this.clearInputs();

    document.addEventListener('pointerlockchange', this.onPointerLockChangeBound);
    document.addEventListener('mousemove', this.onMouseMoveCaptureBound, true);
    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    this.domElement.addEventListener('mousedown', this.onMouseDownBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('wheel', this.onWheelBound, { passive: false });
    this.domElement.addEventListener('contextmenu', this.onContextMenuBound);
  }

  reset(spawn: PlayerSpawnPoint = { x: 0, y: 0, z: 30, yaw: 0 }): void {
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.isGrounded = true;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isSliding = false;
    this.isAds = false;
    this.currentEyeHeight = STAND_EYE_HEIGHT;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.walkDistance = 0;
    this.bobPhase = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.slideTimer = 0;
    this.slideCooldown = 0;
    this.cameraRoll = 0;
    this.impactFovOffset = 0;
    this.trauma = 0;
    this.clearInputs();

    this.camera.position.set(this.position.x, this.position.y + STAND_EYE_HEIGHT, this.position.z);
    this.camera.rotation.set(0, spawn.yaw, 0, 'YXZ');
    this.camera.fov = 74;
    this.camera.updateProjectionMatrix();
  }

  clearInputs(): void {
    this.keys.clear();
    this.mouseFireHeld = false;
    this.mouseFireJustPressed = false;
    this.mouseAdsHeld = false;
    this.reloadJustPressed = false;
    this.meleeJustPressed = false;
    this.grenadeJustPressed = false;
    this.interactJustPressed = false;
    this.switchWeaponRequest = null;
    this.wheelDelta = 0;
    this.isDraggingFallback = false;
  }

  lockPointer(): void {
    try {
      if (!this.controls.isLocked) {
        this.controls.lock();
      }
    } catch {
      // Ignore PointerLock rejections in headless/sandbox environments
    }
  }

  unlockPointer(): void {
    try {
      if (this.controls.isLocked) {
        this.controls.unlock();
      }
    } catch {
      // Ignore
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const state = document.body.dataset.state;
    if (state !== 'playing') return;

    this.keys.add(e.code);

    if (e.code === 'Space') {
      e.preventDefault();
      this.jumpBufferTimer = 0.13;
    } else if (e.code === 'KeyR') {
      this.reloadJustPressed = true;
    } else if (e.code === 'KeyV') {
      this.meleeJustPressed = true;
    } else if (e.code === 'KeyG') {
      this.grenadeJustPressed = true;
    } else if (e.code === 'KeyE' || e.code === 'KeyF') {
      this.interactJustPressed = true;
    } else if (e.code === 'Digit1') {
      this.switchWeaponRequest = 1;
    } else if (e.code === 'Digit2') {
      this.switchWeaponRequest = 2;
    } else if (e.code === 'Digit3') {
      this.switchWeaponRequest = 3;
    } else if (e.code === 'Digit4') {
      this.switchWeaponRequest = 4;
    } else if (e.code === 'Digit5') {
      this.switchWeaponRequest = 5;
    } else if (e.code === 'Digit6') {
      this.switchWeaponRequest = 6;
    } else if (e.code === 'Digit7') {
      this.switchWeaponRequest = 7;
    } else if (e.code === 'Digit8') {
      this.switchWeaponRequest = 8;
    } else if (e.code === 'KeyC') {
      const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (
        !this.isSliding &&
        this.slideCooldown <= 0 &&
        this.isGrounded &&
        (this.isSprinting || horizSpeed > 7.2)
      ) {
        this.isSliding = true;
        this.slideTimer = 0.48;
        this.slideCooldown = 0.88;
        this.isCrouching = false;
        if (horizSpeed > 0.5) {
          this.slideDirX = this.velocity.x / horizSpeed;
          this.slideDirZ = this.velocity.z / horizSpeed;
        } else {
          _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
          _forward.y = 0;
          _forward.normalize();
          this.slideDirX = _forward.x;
          this.slideDirZ = _forward.z;
        }
        this.sound.playSlide();
      } else if (!this.isSliding) {
        this.isCrouching = !this.isCrouching;
      }
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      this.onEscapePause();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private handleWheel(e: WheelEvent): void {
    if (document.body.dataset.state !== 'playing') return;
    if (Math.abs(e.deltaY) < 2) return;
    e.preventDefault();
    this.wheelDelta = e.deltaY > 0 ? 1 : -1;
  }

  private handleMouseDown(e: MouseEvent): void {
    if (document.body.dataset.state !== 'playing') return;
    this.sound.unlock();
    if (!this.controls.isLocked) {
      this.lockPointer();
    }

    if (e.button === 0) {
      this.mouseFireHeld = true;
      this.mouseFireJustPressed = true;
      this.isDraggingFallback = !this.controls.isLocked;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    } else if (e.button === 2) {
      this.mouseAdsHeld = true;
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      this.mouseFireHeld = false;
      this.isDraggingFallback = false;
    } else if (e.button === 2) {
      this.mouseAdsHeld = false;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (document.body.dataset.state !== 'playing') return;
    const sensScale = 0.0021 * this.sensitivity * (this.isAds ? 0.58 : 1.0);

    if (this.controls.isLocked) {
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (Math.abs(dx) > 180 || Math.abs(dy) > 180) return;
      const extraFactor = this.sensitivity * (this.isAds ? 0.58 : 1.0) - 1.0;
      if (Math.abs(extraFactor) > 0.01) {
        _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
        _euler.y -= dx * 0.002 * extraFactor;
        _euler.x -= dy * 0.002 * extraFactor;
        _euler.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, _euler.x));
        this.camera.quaternion.setFromEuler(_euler);
      }
      this.lookDeltaX += dx * sensScale;
      this.lookDeltaY += dy * sensScale;
    } else if (this.isDraggingFallback) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
      _euler.y -= dx * sensScale;
      _euler.x -= dy * sensScale;
      _euler.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, _euler.x));
      this.camera.quaternion.setFromEuler(_euler);
      this.lookDeltaX += dx * sensScale;
      this.lookDeltaY += dy * sensScale;
    }
  }

  /** Throttle (-1..1), steer (-1..1), handbrake for vehicle control. */
  getVehicleInput(): { throttle: number; steer: number; handbrake: boolean } {
    const throttle =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const steer =
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) -
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0);
    return {
      throttle,
      steer,
      handbrake: this.keys.has('Space'),
    };
  }

  consumeInteractPressed(): boolean {
    const pressed = this.interactJustPressed;
    this.interactJustPressed = false;
    return pressed;
  }

  consumeWeaponInputs(): {
    fireHeld: boolean;
    fireJustPressed: boolean;
    adsHeld: boolean;
    reloadJustPressed: boolean;
    meleeJustPressed: boolean;
    grenadeJustPressed: boolean;
    switchWeapon: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null;
    wheelDelta: -1 | 0 | 1;
  } {
    const out = {
      fireHeld: this.mouseFireHeld,
      fireJustPressed: this.mouseFireJustPressed,
      adsHeld: this.mouseAdsHeld,
      reloadJustPressed: this.reloadJustPressed,
      meleeJustPressed: this.meleeJustPressed,
      grenadeJustPressed: this.grenadeJustPressed,
      switchWeapon: this.switchWeaponRequest,
      wheelDelta: (this.wheelDelta > 0 ? 1 : this.wheelDelta < 0 ? -1 : 0) as -1 | 0 | 1,
    };
    this.mouseFireJustPressed = false;
    this.reloadJustPressed = false;
    this.meleeJustPressed = false;
    this.grenadeJustPressed = false;
    this.switchWeaponRequest = null;
    this.wheelDelta = 0;
    return out;
  }

  applyRecoil(pitch: number, yaw: number): void {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    _euler.x = Math.min(Math.PI / 2 - 0.06, _euler.x + pitch);
    _euler.y += yaw;
    this.camera.quaternion.setFromEuler(_euler);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  triggerImpactPunch(fovDelta: number): void {
    this.impactFovOffset = THREE.MathUtils.clamp(this.impactFovOffset + fovDelta, -10, 10);
  }

  getForwardXZ(out: { x: number; z: number }): void {
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _forward.y = 0;
    const len = Math.hypot(_forward.x, _forward.z) || 1;
    out.x = _forward.x / len;
    out.z = _forward.z / len;
  }

  getYawRadians(): number {
    _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    return _euler.y;
  }

  takeDamage(amount: number): boolean {
    if (this.health <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.addTrauma(0.45);
    this.sound.playPlayerDamage();
    return this.health <= 0;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  update(
    dt: number,
    obstacles: readonly AABB2D[],
    ramps: readonly RampCollider[],
    targetAdsFov: number,
    isAds: boolean,
  ): { moveSpeedRatio: number; bobAmount: number; bobPhase: number } {
    this.isAds = isAds;

    const forwardInput =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const strafeInput =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    const sprintHeld = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    if (this.isSliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 || this.jumpBufferTimer > 0) {
        this.isSliding = false;
      }
    }

    this.isSprinting =
      sprintHeld && forwardInput > 0 && !this.isCrouching && !this.isSliding && !this.isAds;

    const maxSpeed = this.isCrouching
      ? 3.8
      : this.isSprinting
        ? 9.6
        : this.isAds
          ? 4.4
          : 6.7;

    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _forward.y = 0;
    if (_forward.lengthSq() > 1e-6) _forward.normalize();
    _right.crossVectors(_forward, THREE.Object3D.DEFAULT_UP).normalize();

    _moveDir.set(0, 0, 0);
    _moveDir.addScaledVector(_forward, forwardInput);
    _moveDir.addScaledVector(_right, strafeInput);
    if (_moveDir.lengthSq() > 1e-6) _moveDir.normalize();

    if (this.isSliding) {
      const t = Math.max(0, this.slideTimer / 0.48);
      const slideSpeed = THREE.MathUtils.lerp(5.8, 12.8, t);
      this.velocity.x = this.slideDirX * slideSpeed;
      this.velocity.z = this.slideDirZ * slideSpeed;
    } else {
      const accelRate = this.isGrounded ? 15.0 : 5.5;
      const decelRate = this.isGrounded ? 13.0 : 2.5;
      const rate = _moveDir.lengthSq() > 0 ? accelRate : decelRate;
      const blend = 1 - Math.exp(-rate * dt);

      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, _moveDir.x * maxSpeed, blend);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, _moveDir.z * maxSpeed, blend);
    }

    if (this.isGrounded) {
      this.coyoteTimer = 0.1;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);

    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.velocity.y = JUMP_SPEED;
      this.isGrounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.isCrouching = false;
      this.isSliding = false;
      this.sound.playFootstep(true);
    }

    // Gravity
    this.velocity.y -= GRAVITY * dt;

    // Integrate XZ & resolve sliding collisions using sloped ramp + step-up elevation probe
    const prevFloorY = getSurfaceFloorHeight(
      this.position.x,
      this.position.z,
      this.position.y,
      PLAYER_RADIUS,
      obstacles,
      ramps,
    );

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const actorHeight = this.isSliding
      ? SLIDE_EYE_HEIGHT + 0.15
      : this.isCrouching
        ? CROUCH_EYE_HEIGHT + 0.15
        : STAND_EYE_HEIGHT + 0.15;

    const probeFloorY = getSurfaceFloorHeight(
      this.position.x,
      this.position.z,
      Math.max(this.position.y, prevFloorY),
      PLAYER_RADIUS,
      obstacles,
      ramps,
    );
    const stepProbe = {
      x: this.position.x,
      y: Math.max(this.position.y, probeFloorY) + 0.6,
      z: this.position.z,
    };
    const resolved = resolveCircleAABBs(
      stepProbe,
      PLAYER_RADIUS,
      Math.max(0.45, actorHeight - 0.6),
      obstacles,
    );
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    // Integrate Y & evaluate exact floor / ramp / catwalk / perch surface
    const wasGrounded = this.isGrounded;
    const prevY = this.position.y;
    this.position.y += this.velocity.y * dt;

    const floorY = getSurfaceFloorHeight(
      this.position.x,
      this.position.z,
      Math.max(prevY, prevFloorY),
      PLAYER_RADIUS,
      obstacles,
      ramps,
    );

    if (this.position.y <= floorY) {
      if (!wasGrounded && this.velocity.y < -4) {
        this.sound.playFootstep(false);
        this.trauma = Math.min(1, this.trauma + 0.08);
      }
      this.position.y = floorY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else if (wasGrounded && this.velocity.y <= 0 && this.position.y - floorY < 0.34) {
      // Smoothly stick to sloped ramps when descending
      this.position.y = floorY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    const targetEye = this.isSliding
      ? SLIDE_EYE_HEIGHT
      : this.isCrouching
        ? CROUCH_EYE_HEIGHT
        : STAND_EYE_HEIGHT;
    this.currentEyeHeight = THREE.MathUtils.damp(this.currentEyeHeight, targetEye, 13, dt);

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moveSpeedRatio = horizSpeed / 6.7;
    let bobY = 0;
    let bobAmount = 0;

    if (this.isGrounded && horizSpeed > 0.45 && !this.isSliding) {
      const stepDist = horizSpeed * dt;
      this.walkDistance += stepDist;
      this.bobPhase += stepDist * 2.9;
      bobAmount = Math.min(1, horizSpeed / 7.0) * (this.isAds ? 0.25 : 1.0);
      bobY = Math.sin(this.bobPhase) * 0.045 * bobAmount;

      if (this.walkDistance >= this.stepThreshold) {
        this.walkDistance = 0;
        this.sound.playFootstep(this.isSprinting);
      }
    }

    if (Math.abs(this.recoilPitch) > 0.0002 || Math.abs(this.recoilYaw) > 0.0002) {
      const recStep = 1 - Math.exp(-10 * dt);
      const dPitch = this.recoilPitch * recStep;
      const dYaw = this.recoilYaw * recStep;
      this.recoilPitch -= dPitch;
      this.recoilYaw -= dYaw;
      _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
      _euler.x = Math.max(-Math.PI / 2 + 0.05, _euler.x - dPitch);
      _euler.y -= dYaw;
      this.camera.quaternion.setFromEuler(_euler);
    }

    const targetRoll = (this.isSliding ? -0.055 : 0) + strafeInput * -0.016;
    this.cameraRoll = THREE.MathUtils.damp(this.cameraRoll, targetRoll, 11, dt);
    _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    if (Math.abs(_euler.z - this.cameraRoll) > 0.0002) {
      _euler.z = this.cameraRoll;
      this.camera.quaternion.setFromEuler(_euler);
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const shake = this.trauma * this.trauma * 0.06;
    const shakeX = (Math.random() * 2 - 1) * shake;
    const shakeY = (Math.random() * 2 - 1) * shake;

    this.camera.position.set(
      this.position.x + shakeX,
      this.position.y + this.currentEyeHeight + bobY + shakeY,
      this.position.z,
    );

    this.impactFovOffset = THREE.MathUtils.damp(this.impactFovOffset, 0, 11, dt);
    const targetFov =
      (this.isAds ? targetAdsFov : this.isSliding ? 85 : this.isSprinting ? 83 : 74) +
      this.impactFovOffset;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 13, dt);
      this.camera.updateProjectionMatrix();
    }

    this.lookDeltaX = THREE.MathUtils.damp(this.lookDeltaX, 0, 14, dt);
    this.lookDeltaY = THREE.MathUtils.damp(this.lookDeltaY, 0, 14, dt);

    return { moveSpeedRatio, bobAmount, bobPhase: this.bobPhase };
  }

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onPointerLockChangeBound);
    document.removeEventListener('mousemove', this.onMouseMoveCaptureBound, true);
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    this.domElement.removeEventListener('mousedown', this.onMouseDownBound);
    window.removeEventListener('mouseup', this.onMouseUpBound);
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    window.removeEventListener('wheel', this.onWheelBound);
    this.domElement.removeEventListener('contextmenu', this.onContextMenuBound);
    this.controls.dispose();
  }
}
