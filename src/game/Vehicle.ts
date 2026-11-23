import * as THREE from 'three';
import { getSurfaceFloorHeight, resolveCircleAABBs } from './rules';
import type { AABB2D, RampCollider } from './types';
import type { DrivableVehicle } from './World';

const _fwd = new THREE.Vector3();
const _desiredCam = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export interface VehicleInput {
  throttle: number; // -1..1 (W/S)
  steer: number; // -1..1 (A/D)
  handbrake: boolean;
}

const TUNING = {
  car: {
    maxSpeed: 21,
    maxReverse: 8,
    accel: 11.5,
    brake: 18,
    drag: 0.55,
    rollDrag: 2.2,
    steerRate: 2.1,
    camDist: 7.4,
    camHeight: 3.1,
    radius: 1.55,
    height: 1.9,
  },
  bike: {
    maxSpeed: 26,
    maxReverse: 7,
    accel: 13.5,
    brake: 20,
    drag: 0.4,
    rollDrag: 1.4,
    steerRate: 2.9,
    camDist: 5.6,
    camHeight: 2.4,
    radius: 1.0,
    height: 1.5,
  },
} as const;

/**
 * Arcade vehicle controller for parked drivable cars / bikes.
 * Model forward is +Z; heading yaw uses the same convention as patrolVehicle.
 */
export class VehicleController {
  public readonly vehicle: DrivableVehicle;
  public heading = 0;
  public speed = 0;
  public steerVisual = 0;
  public wheelSpin = 0;
  public readonly position = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private camInitialized = false;

  constructor(vehicle: DrivableVehicle) {
    this.vehicle = vehicle;
    this.heading = vehicle.group.rotation.y;
    this.position.set(vehicle.group.position.x, vehicle.group.position.y, vehicle.group.position.z);
  }

  get maxSpeed(): number {
    return TUNING[this.vehicle.kind].maxSpeed;
  }

  /** Returns true if the vehicle hit something this frame. */
  update(
    dt: number,
    input: VehicleInput,
    obstacles: readonly AABB2D[],
    ramps: readonly RampCollider[],
    onCollision?: () => void,
  ): boolean {
    const t = TUNING[this.vehicle.kind];
    let collided = false;

    // Longitudinal
    const throttle = input.throttle;
    if (throttle > 0) {
      this.speed += t.accel * throttle * dt * (this.speed < 0 ? 2.2 : 1);
    } else if (throttle < 0) {
      if (this.speed > 0.6) {
        this.speed -= t.brake * dt; // braking
      } else {
        this.speed = Math.max(-t.maxReverse, this.speed + t.accel * 0.62 * throttle * dt);
      }
    }
    if (input.handbrake) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), t.brake * 1.5 * dt);
    }
    // Drag
    const drag = input.handbrake ? t.drag * 2.4 : t.drag;
    this.speed -= this.speed * drag * dt;
    if (Math.abs(this.speed) < 0.12 && throttle === 0) this.speed = 0;
    this.speed = THREE.MathUtils.clamp(this.speed, -t.maxReverse, t.maxSpeed);

    // Steering — effectiveness scales with speed, flips in reverse
    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.speed) / 6.5, 0, 1);
    const dir = this.speed >= 0 ? 1 : -1;
    const targetSteer = input.steer * 0.55;
    this.steerVisual = THREE.MathUtils.damp(this.steerVisual, targetSteer, 10, dt);
    this.heading += this.steerVisual * t.steerRate * speedFactor * dir * dt;

    // Integrate
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.position.x += _fwd.x * this.speed * dt;
    this.position.z += _fwd.z * this.speed * dt;

    // Collision vs static obstacles (exclude this vehicle's own AABB)
    const probe = {
      x: this.position.x,
      y: this.position.y + 0.4,
      z: this.position.z,
    };
    const resolved = resolveCircleAABBs(probe, t.radius, t.height, obstacles);
    if (resolved.collided) {
      const pushX = resolved.x - this.position.x;
      const pushZ = resolved.z - this.position.z;
      this.position.x = resolved.x;
      this.position.z = resolved.z;
      if (Math.abs(this.speed) > 4) onCollision?.();
      this.speed *= -0.28;
      collided = true;
      void pushX;
      void pushZ;
    }

    // Floor height (ramps / catwalk tops the vehicle can mount)
    const floorY = getSurfaceFloorHeight(
      this.position.x,
      this.position.z,
      this.position.y,
      t.radius,
      obstacles,
      ramps,
    );
    this.position.y = THREE.MathUtils.damp(this.position.y, floorY, 14, dt);

    // Write back to scene graph + live collider
    this.vehicle.group.position.copy(this.position);
    this.vehicle.group.rotation.set(0, this.heading, this.vehicle.kind === 'bike' ? this.steerVisual * -0.35 : 0);

    this.wheelSpin += (this.speed / 0.42) * dt;
    for (const w of this.vehicle.wheels) {
      w.rotation.x = this.wheelSpin;
    }

    const ob = this.vehicle.obstacle;
    if (ob) {
      const c = Math.abs(Math.cos(this.heading));
      const s = Math.abs(Math.sin(this.heading));
      const halfX = this.vehicle.halfX * c + this.vehicle.halfZ * s;
      const halfZ = this.vehicle.halfX * s + this.vehicle.halfZ * c;
      ob.minX = this.position.x - halfX;
      ob.maxX = this.position.x + halfX;
      ob.minZ = this.position.z - halfZ;
      ob.maxZ = this.position.z + halfZ;
      ob.minY = 0;
      ob.maxY = t.height;
    }

    return collided;
  }

  /** Chase/cockpit camera behind the vehicle. */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    const t = TUNING[this.vehicle.kind];
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _desiredCam
      .copy(this.position)
      .addScaledVector(_fwd, -t.camDist)
      .add(_upVec.set(0, t.camHeight, 0));

    if (!this.camInitialized) {
      this.camPos.copy(_desiredCam);
      this.camInitialized = true;
    } else {
      const k = 1 - Math.exp(-7.5 * dt);
      this.camPos.lerp(_desiredCam, k);
    }
    camera.position.copy(this.camPos);
    _lookTarget
      .copy(this.position)
      .addScaledVector(_fwd, 6.5)
      .add(_upVec.set(0, this.vehicle.kind === 'bike' ? 1.15 : 1.5, 0));
    camera.lookAt(_lookTarget);
    // Subtle speed FOV kick
    const targetFov = 74 + Math.min(10, (Math.abs(this.speed) / t.maxSpeed) * 10);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
      camera.updateProjectionMatrix();
    }
  }
}

const _upVec = new THREE.Vector3();
