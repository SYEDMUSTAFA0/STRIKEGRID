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

- **Accounts & Profiles** (`src/game/auth.ts`, `src/game/userProfile.ts`,
  `src/components/AuthModal.tsx`, `src/components/ProfilePanel.tsx`): full
  Register / Sign In flow (email+password, Google via Supabase OAuth) backed by
  Supabase Auth or Firebase Auth REST, automatic session restore with token
  refresh, and an editable Operator Profile — callsign, full name, bio,
  country, playstyle, favorite weapon/map, tactical emblem, and career stats —
  persisted to `/users/{uid}` (Firebase) or the `profiles` table (Supabase).
- **Manual ACTIVE / INACTIVE status**: a toggle on the profile card and in the
  profile panel marks the player `active` (visible in the live directory,
  joinable, invitable) or `inactive` (stealth — hidden from matchmaking). On
  tab close the client marks itself inactive and stale entries are pruned.
- **Player Sign-In fallback**: an instant **Quick Callsign / Guest** flow
  persisted in `localStorage` so play never blocks without backend keys. Every
  player gets a unique Player ID and a 6-character **Friend Code**.
- **Live Presence** (`src/game/onlinePresence.ts`): an adapter that polls
  Supabase PostgREST (`strikegrid_players` table) or Firebase Realtime
  Database (`/strikegrid/presence` node). Statuses: `ACTIVE` / `IN LOBBY` /
  `IN MATCH` / `INACTIVE` with mode, ping, and public profile fields
  (emblem, country, level, favorite weapon).
- **Custom Lobby** (`src/components/FriendsLobby.tsx`,
  `src/components/ActivePlayersPanel.tsx`): live Active Players directory
  (emblem, country, level, favorite weapon, activity) with one-click
  **Invite to Squad** / **Join Match**, friend list with add-by-Friend-Code,
  DB-delivered room invites with Accept/Decline, shareable 6-character room
  codes, and full **host controls** — match mode (Co-op Squad Survival, Team
  Deathmatch, Free-For-All, Zone Control), arena (all six maps), difficulty
  tier (Easy/Medium/Hard), squad roster with ready checks, and START MATCH sync.
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
-- Operator profile documents (mirrored from the client profile).
create table if not exists public.profiles (
  uid text primary key,
  callsign text not null,
  email text,
  full_name text default '',
  bio text default '',
  country text default 'OTHER',
  avatar_preset text default 'viper',
  favorite_weapon text default 'any',
  favorite_map text default 'any',
  playstyle text default 'rusher',
  status text default 'active',
  friend_code text,
  level int default 1,
  kills int default 0,
  deaths int default 0,
  wins int default 0,
  matches_played int default 0,
  created_at timestamptz default now(),
  last_seen timestamptz default now()
);
alter table public.profiles enable row level security;
-- Authenticated users may only write their own row; profiles are publicly
-- readable so the Active Players directory can render them.
create policy "profiles read" on public.profiles for select using (true);
create policy "profiles insert own" on public.profiles for insert
  with check (auth.uid()::text = uid);
create policy "profiles update own" on public.profiles for update
  using (auth.uid()::text = uid) with check (auth.uid()::text = uid);

create table if not exists public.strikegrid_players (
  id text primary key,
  callsign text not null,
  friend_code text,
  status text default 'online',
  mode text,
  room_code text,
  ping int default 30,
  avatar_preset text,
  country text,
  level int default 1,
  favorite_weapon text,
  full_name text,
  playstyle text,
  last_seen timestamptz default now()
);
alter table public.strikegrid_players enable row level security;
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

-- Lobby-wide text chat (polled every ~2.5s).
create table if not exists public.strikegrid_chat (
  id bigint generated always as identity primary key,
  from_id text,
  from_callsign text,
  text text not null,
  created_at timestamptz default now()
);
alter table public.strikegrid_chat enable row level security;
create policy "chat read" on public.strikegrid_chat for select using (true);
create policy "chat write" on public.strikegrid_chat for insert with check (true);

-- Voice-chat signaling relay (WebRTC SDP/ICE payloads between peers).
create table if not exists public.strikegrid_signal (
  id bigint generated always as identity primary key,
  from_id text,
  to_id text not null,
  data jsonb,
  created_at timestamptz default now()
);
alter table public.strikegrid_signal enable row level security;
create policy "signal read own" on public.strikegrid_signal for select using (true);
create policy "signal write" on public.strikegrid_signal for insert with check (true);
create policy "signal delete own inbox" on public.strikegrid_signal for delete using (true);
```

#### Firebase RTDB rules (database rules tab)

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": true,
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "strikegrid": {
      "presence": {
        ".read": true,
        ".write": "auth != null"
      },
      "invites": {
        ".read": "auth != null",
        ".write": "auth != null"
      },
      "chat": {
        ".read": "auth != null",
        ".write": "auth != null"
      },
      "voice": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```
Profile docs live at `/users/{uid}` — only the owner may write their own
document; presence and invites require an authenticated session. For quick
local testing you can temporarily set `.write: true` on `presence`/`invites`
and `.read/.write: true` on `users`, but restore the rules above before
shipping.

### Chat & voice

- **Lobby chat** — global text chat for every online operator, shown in the
  multiplayer lobby panel. Works cross-device when Supabase/Firebase is
  configured; falls back to same-browser BroadcastChannel otherwise.
- **Match chat** — press `Enter` during a multiplayer match to message your
  room squad (BroadcastChannel room transport).
- **Voice chat** — mic toggle in the HUD (top-right) or lobby comms panel.
  WebRTC mesh audio between online players, relayed via the presence
  backend's signaling channel (`strikegrid_signal` table / `/strikegrid/voice`
  RTDB node / BroadcastChannel). Capped at 6 simultaneous peers; non-trickle
  ICE keeps call setup reliable over REST polling (~1–4s to connect).
  Microphone permission is required; voice is OFF by default.

### Testing multiplayer locally

Open two browser tabs on the dev server — each tab sees the other in **Active
Now**, can join rooms by 6-char code, invite by Friend Code, ready up, and sync
poses/scoreboards in-match.
