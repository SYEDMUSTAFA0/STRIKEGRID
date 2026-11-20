# STRIKEGRID (SECTOR 09) — 3D Tactical FPS

A browser-based 3D tactical first-person shooter built with **Three.js**, **WebGL**, **TypeScript**, and the **Web Audio API**, developed in **Google AI Studio**.

## Overview

**STRIKEGRID (SECTOR 09)** pits the player against wave-based tactical enemy squads across three distinct 3D environments and four named combat zones. It combines custom procedural canvas PBR textures, multi-part 3D character and vehicle models, customizable weapon finishes, and real-time synthesized audio without requiring external sound or texture assets.

## Key Features

- **Three Playable Arenas** (`src/game/World.ts`):
  - **Sector 09 (`dusk_yard`):** Industrial shipping container compound at dusk with overhead catwalks, steel ramps, gantry crane, and hazard barrels.
  - **Arctic Outpost (`arctic_outpost`):** Snow-covered military research base with radar domes, bunkers, snowbank ramps, falling snow, and cool directional lighting.
  - **Desert Compound (`desert_compound`):** Sun-baked sandstone fortress with walkable arches, sniper perches/ramps, sandbag barricades, and warm daylight atmosphere.
- **Named Tactical Zones** (`src/game/rules.ts`, `src/game/World.ts`, `src/components/GameHUD.tsx`):
  - **Landing Area (`LZ-01`)**
  - **Building Zone (`OPS-BLDG`)**
  - **Forest Area (`BIO-WOODS`)**
  - **Restriction Area (`SEC-MAX`)**
- **Expanded Arsenal & Ordnance** (`src/game/Weapons.ts`, `src/game/Player.ts`):
  - **Firearms:** *MK-18 Carbine*, *P226 Tactical*, *M870 Breacher* (shotgun), and *MK-14 Marksman* rifle.
  - **Melee & Throwables:** *Combat Knife* (`V` or slot `5`) for slashes/stabs and *Frag Grenades* (`G`) with bounce and explosion physics.
- **Arsenal Finishes & Live Menu Preview** (`src/game/textures.ts`, `src/game/Weapons.ts`, `src/components/Menus.tsx`):
  - Switch between **Standard Issue**, **Desert Tan / FDE**, **Arctic Camo**, and **Carbon & Gold** finishes with live preview updates on the deploy screen and active viewmodels.
- **3D Vehicles & Articulated Squad AI** (`src/game/vehicles.ts`, `src/game/Enemies.ts`):
  - Multi-part 3D vehicles (cars, patrol trucks, and motorcycles) alongside destructible supply crates and explosive barrels.
  - Articulated 3D human-proportioned soldiers with distinct roles (*rusher*, *rifleman*, *marksman*), hitbox multipliers (including 2.5x headshots), laser sightlines, and wave progression.
- **Procedural Web Audio** (`src/game/Audio.ts`):
  - Synthesized gunshots, bolt/pump/reload clicks, shell clinks, melee slashes, grenade blasts, hitmarkers, and ambient audio via the Web Audio API.

## Controls

| Action | Key / Input |
| :--- | :--- |
| Move | `W A S D` or Arrow Keys |
| Sprint | `Shift` |
| Crouch / Sprint-Slide | `C` (`Shift + C` to slide) |
| Jump | `Space` |
| Fire / Melee Slash | `Left Click` |
| Aim Down Sights (ADS) / Heavy Stab | `Right Click` |
| Switch Weapons | `1` – `5` or Mouse Wheel |
| Quick Knife | `V` |
| Throw Frag Grenade | `G` |
| Reload | `R` |
| Pause | `Esc` or `P` |

## Project Structure

```text
├── index.html
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── GameHUD.tsx
│   │   └── Menus.tsx
│   └── game/
│       ├── Audio.ts
│       ├── Enemies.ts
│       ├── Engine.ts
│       ├── Player.ts
│       ├── rules.ts
│       ├── rules.test.ts
│       ├── textures.ts
│       ├── types.ts
│       ├── vehicles.ts
│       ├── Weapons.ts
│       └── World.ts


Getting Started
Install dependencies:

Bash
npm install
Run the development server:

Bash
npm run dev
Run unit tests & type checks:

Bash
npx --yes tsx --test src/game/rules.test.ts
npx tsc --noEmit
URL Query Parameters
?map=dusk_yard|arctic_outpost|desert_compound — Pre-select an arena.

?skin=standard|desert_tan|arctic_camo|carbon_gold — Pre-select a weapon finish.

?autostart=1 — Jump straight into active gameplay.
