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

## Online Play — Sign-In, Presence & Custom Lobbies

SECTOR 09 ships with a full online layer that degrades gracefully:

- **Player Sign-In** (`src/game/auth.ts`): email/password and Google sign-in via
  **Supabase Auth** or **Firebase Auth** REST APIs (no SDK dependency), plus an
  instant **Quick Callsign / Guest** flow persisted in `localStorage`. Every
  player gets a unique Player ID and a 6-character **Friend Code**.
- **Live Presence** (`src/game/onlinePresence.ts`): an adapter that polls
  Supabase PostgREST (`strikegrid_players` table) or Firebase Realtime
  Database (`/strikegrid/presence` node). Statuses: `ONLINE` / `IN LOBBY` /
  `IN MATCH` with mode and ping.
- **Custom Lobby** (`src/components/FriendsLobby.tsx`): friend list with
  add-by-Friend-Code, live room invites, shareable 6-character room codes, and
  full **host controls** — match mode (Co-op Squad Survival, Team Deathmatch,
  Free-For-All, Zone Control), arena (all six maps), difficulty tier
  (Easy/Medium/Hard), squad roster with ready checks, and START MATCH sync.
- **In-Match Sync** (`src/game/multiplayer.ts`, `src/game/Engine.ts`): remote
  operator rigs with name tags, weapon-finish tints, death poses, pose/anim
  relay, gunfire & grenade events, live scoreboard (`Tab`), and kill feed.

### Offline / demo fallback

With **no env vars set**, everything still works locally: `BroadcastChannel`
rooms sync across browser tabs, presence runs over a local heartbeat channel,
and email/Google sign-in is replaced by Quick Callsign guest play.

### Connecting a live backend

Copy `.env.example` → `.env.local` and fill in ONE provider:

- **Supabase**: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, then run the
  schema below in the SQL editor.
- **Firebase**: `VITE_FIREBASE_API_KEY` (+ `VITE_FIREBASE_PROJECT_ID` or
  `VITE_FIREBASE_DATABASE_URL`), enable Email/Password auth, and allow RTDB
  access to `/strikegrid/presence`.

#### Supabase schema (SQL editor)

```sql
create table if not exists public.strikegrid_players (
  id text primary key,
  callsign text not null,
  friend_code text,
  status text default 'online',
  mode text,
  room_code text,
  ping int default 30,
  last_seen timestamptz default now()
);
alter table public.strikegrid_players enable row level security;
-- Demo-friendly open policies (tighten for production):
create policy "players read" on public.strikegrid_players for select using (true);
create policy "players write" on public.strikegrid_players for all using (true) with check (true);

create table if not exists public.strikegrid_invites (
  id bigint generated always as identity primary key,
  "to" text not null,
  from_id text,
  from_callsign text,
  room_code text not null,
  mode text,
  created_at timestamptz default now()
);
alter table public.strikegrid_invites enable row level security;
create policy "invites read" on public.strikegrid_invites for select using (true);
create policy "invites write" on public.strikegrid_invites for all using (true) with check (true);
```

#### Firebase RTDB rules (database rules tab)

```json
{
  "rules": {
    "strikegrid": {
      "presence": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```
(Tighten `.write` to `auth != null` once email/Google auth is enabled.)

### Testing multiplayer locally

Open two browser tabs on the dev server — each tab sees the other in **Active
Now**, can join rooms by 6-char code, invite by Friend Code, ready up, and sync
poses/scoreboards in-match.
