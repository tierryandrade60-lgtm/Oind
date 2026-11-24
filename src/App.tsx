/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AbilityBar,
  AbilityBarHandle,
  AbilitySoundKind,
  StolenAbilitySlotState,
} from './components/AbilityBar';
import { AbilityIcon } from './components/AbilityIcon';
import { CharacterSelector } from './components/CharacterSelector';
import { CoinHud, CoinHudHandle } from './components/CoinHud';
import {
  CombatOverlayHud,
  CombatOverlayHudHandle,
} from './components/CombatOverlayHud';
import { DeathScreen } from './components/DeathScreen';
import { GraphicsSettingsPanel } from './components/GraphicsSettingsPanel';
import { KeybindBadge } from './components/KeybindBadge';
import { MainMenu } from './components/MainMenu';
import { MapSelector } from './components/MapSelector';
import {
  PlayerCombatHud,
  PlayerCombatHudHandle,
} from './components/PlayerCombatHud';
import { PlayerProfileHud, PlayerProfileHudHandle } from './components/PlayerProfileHud';
import { ReticleHud, ReticleHudHandle } from './components/ReticleHud';
import { ScreenFxOverlay, ScreenFxOverlayHandle } from './components/ScreenFxOverlay';
import { ScreenTransition, TransitionPhase } from './components/ScreenTransition';
import { GameEngine } from './game/GameEngine';
import { MapId } from './game/maps';
import { useIsPc } from './utils/platform';
import {
  restoreServerSession,
  SyncedGameState,
  validateServerState,
} from './game/serverSync';
import {
  AbilityId,
  DARK_PHOENIX_DIVE_ABILITY,
  EMMA_DIAMOND_PROJECTILE,
  HELA_CROWN_DURATION_MS,
  HELA_CROWN_FORM,
  HELA_SWORD_SLASH,
  HELA_SWORD_SLASH_COOLDOWN_MS,
  HELA_SWORD_THROW_READY_MS,
  HELA_THROW_SWORD,
  MYSTIC_SHIELD_ABILITY,
  PHOENIX_DIVE_ABILITY,
  SILVER_SURFER_SONIC_BLAST,
  SILVER_SURFER_SONIC_UNLOCK,
  STORM_LIGHTNING_STRIKE,
  STRANGE_SHIELD_MAX_DURATION_MS,
  THOR_LIGHTNING_SLAM,
  VAMPIRE_GROUND_STOMP,
  VISION_INTANGIBILITY,
  VISION_INTANGIBLE_MAX_DURATION_MS,
  WHITE_HELA_CROWN_FORM,
  WHITE_HELA_SWORD_SLASH,
  WHITE_HELA_SWORD_SLASH_COOLDOWN_MS,
  WHITE_HELA_SWORD_THROW_READY_MS,
  WHITE_HELA_THROW_SWORD,
  WHITE_PHOENIX_DIVE_ABILITY,
} from './game/abilityConfig';
import {
  CHARACTER_REGISTRY,
  type CharacterGender,
  DARK_PHOENIX_SKIN_ID,
  WHITE_HELA_SKIN_ID,
  WHITE_PHOENIX_SKIN_ID,
  getCharacterById,
  resolveCharacterWithSkin,
} from './game/characters';
import {
  GraphicsSettings,
  loadGraphicsSettings,
  saveGraphicsSettings,
} from './game/graphicsSettings';
import { SoundEngine } from './game/soundEngine';

const OUTER_RADIUS = 44;
const KNOB_RADIUS = 16;
const INNER_PADDING = 3;
const MAX_KNOB_TRAVEL = OUTER_RADIUS - KNOB_RADIUS - INNER_PADDING; // 25px
const JOYSTICK_DEADZONE = 0.06;

const COINS_STORAGE_KEY = 'pixel_stride_coins_v1';
const UNLOCKED_SKINS_STORAGE_KEY = 'pixel_stride_unlocked_skins_v1';
const SELECTED_SKINS_STORAGE_KEY = 'pixel_stride_selected_skins_v1';
const SELECTED_MAP_STORAGE_KEY = 'pixel_stride_map_v1';

const PURPLE_DOT_PATTERN =
  'radial-gradient(circle, rgba(142, 145, 218, 0.36) 1.45px, transparent 1.55px), radial-gradient(circle, rgba(142, 145, 218, 0.36) 1.45px, transparent 1.55px)';

const EMPTY_LOCKED_ABILITIES: ReadonlyArray<AbilityId> = [];

type MenuScreen = 'menu' | 'maps' | 'selecting';
type GamePhase = MenuScreen | 'transitioning' | 'playing' | 'dead' | 'respawning';

function loadSelectedMapId(): MapId {
  try {
    const raw = window.localStorage.getItem(SELECTED_MAP_STORAGE_KEY);
    if (raw === 'test' || raw === 'existing') {
      return raw;
    }
  } catch {
    // Ignore storage read restrictions
  }
  return 'existing';
}

function saveSelectedMapId(mapId: MapId): void {
  try {
    window.localStorage.setItem(SELECTED_MAP_STORAGE_KEY, mapId);
  } catch {
    // Ignore storage write restrictions
  }
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type OrientationWithLock = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
};

type LegacyScreen = Screen & {
  lockOrientation?: (orientation: string) => boolean;
  mozLockOrientation?: (orientation: string) => boolean;
  msLockOrientation?: (orientation: string) => boolean;
};

function loadCoinBalance(): number {
  try {
    const raw = window.localStorage.getItem(COINS_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage read restrictions
  }
  return 0;
}

function saveCoinBalance(coins: number): void {
  try {
    window.localStorage.setItem(COINS_STORAGE_KEY, String(Math.max(0, Math.floor(coins))));
  } catch {
    // Ignore storage write restrictions
  }
}

function loadUnlockedSkins(): string[] {
  try {
    const raw = window.localStorage.getItem(UNLOCKED_SKINS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    }
  } catch {
    // Ignore storage read restrictions
  }
  return [];
}

function saveUnlockedSkins(skins: ReadonlyArray<string>): void {
  try {
    window.localStorage.setItem(UNLOCKED_SKINS_STORAGE_KEY, JSON.stringify(skins));
  } catch {
    // Ignore storage write restrictions
  }
}

function loadSelectedSkins(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SELECTED_SKINS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, string>;
      }
    }
  } catch {
    // Ignore storage read restrictions
  }
  return {};
}

function saveSelectedSkins(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(SELECTED_SKINS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage write restrictions
  }
}

async function requestDocumentFullscreen(): Promise<void> {
  const candidates = [
    document.documentElement as FullscreenElement,
    document.body as FullscreenElement,
  ];

  for (const el of candidates) {
    if (!el) continue;
    try {
      if (el.requestFullscreen) {
        try {
          await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
          return;
        } catch {
          await el.requestFullscreen();
          return;
        }
      }
      if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
        return;
      }
      if (el.mozRequestFullScreen) {
        await el.mozRequestFullScreen();
        return;
      }
      if (el.msRequestFullscreen) {
        await el.msRequestFullscreen();
        return;
      }
    } catch {
      // Try next fallback element
    }
  }
}

async function lockLandscapeOrientation(): Promise<void> {
  try {
    const orientation = window.screen?.orientation as OrientationWithLock | undefined;
    if (orientation?.lock) {
      try {
        await orientation.lock('landscape');
        return;
      } catch {
        await orientation.lock('landscape-primary');
        return;
      }
    }
  } catch {
    // Try legacy vendor orientation lock APIs below
  }

  try {
    const legacyScreen = window.screen as LegacyScreen | undefined;
    if (legacyScreen?.lockOrientation) {
      legacyScreen.lockOrientation('landscape');
    } else if (legacyScreen?.mozLockOrientation) {
      legacyScreen.mozLockOrientation('landscape');
    } else if (legacyScreen?.msLockOrientation) {
      legacyScreen.msLockOrientation('landscape');
    }
  } catch {
    // Orientation lock unsupported by browser/iframe; CSS landscape fallback handles it
  }
}

export default function App() {
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const soundEngineRef = useRef<SoundEngine | null>(null);
  const combatHudRef = useRef<CombatOverlayHudHandle | null>(null);
  const playerCombatHudRef = useRef<PlayerCombatHudHandle | null>(null);
  const reticleRef = useRef<ReticleHudHandle | null>(null);
  const abilityBarRef = useRef<AbilityBarHandle | null>(null);
  const profileHudRef = useRef<PlayerProfileHudHandle | null>(null);
  const coinHudRef = useRef<CoinHudHandle | null>(null);
  const screenFxRef = useRef<ScreenFxOverlayHandle | null>(null);
  const canvasBlurAppliedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const pendingStaminaRestoreRef = useRef<{
    stamina: number;
    regenDelayRemaining: number;
    sprintEnabled: boolean;
  } | null>(null);
  const lastStaminaSyncMsRef = useRef(0);
  const lastSyncedStaminaValRef = useRef<number>(100);
  const latestTelemetryRef = useRef<{ hp: number; killStreak: number }>({
    hp: CHARACTER_REGISTRY[0].maxHp,
    killStreak: 0,
  });

  const isPc = useIsPc();
  const isPcRef = useRef(isPc);
  isPcRef.current = isPc;

  const [needsFullscreenStart, setNeedsFullscreenStart] = useState(true);
  const [isPortrait, setIsPortrait] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false,
  );

  const [gamePhase, setGamePhaseState] = useState<GamePhase>('menu');
  const gamePhaseRef = useRef<GamePhase>('menu');
  const setGamePhase = useCallback((next: GamePhase) => {
    gamePhaseRef.current = next;
    setGamePhaseState(next);
  }, []);

  const [activeMenuScreen, setActiveMenuScreen] = useState<MenuScreen>('menu');
  const [selectedMapId, setSelectedMapId] = useState<MapId>(() => loadSelectedMapId());
  const selectedMapIdRef = useRef<MapId>(selectedMapId);
  selectedMapIdRef.current = selectedMapId;
  const [testBotEnabled, setTestBotEnabled] = useState(false);
  const testBotEnabledRef = useRef(false);
  testBotEnabledRef.current = testBotEnabled;
  const [testAiEnabled, setTestAiEnabled] = useState(false);
  const testAiEnabledRef = useRef(false);
  testAiEnabledRef.current = testAiEnabled;

  const [engineActive, setEngineActive] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>('idle');
  const [deathPanelVisible, setDeathPanelVisible] = useState(false);
  const [respawnKey, setRespawnKey] = useState(0);
  const [spawnLocked, setSpawnLocked] = useState(false);
  const spawnLockedRef = useRef(false);
  spawnLockedRef.current = spawnLocked;
  const [teleportLocked, setTeleportLocked] = useState(false);
  const [painChanneling, setPainChanneling] = useState(false);
  const [darkholdActive, setDarkholdActive] = useState(false);
  const [autoShieldActive, setAutoShieldActive] = useState(false);
  const autoShieldActiveRef = useRef(false);
  const [flightActive, setFlightActive] = useState(false);
  const [flightCancelCd, setFlightCancelCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const flightCancelCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  flightCancelCdRef.current = flightCancelCd;
  const flightCancelVeilRef = useRef<HTMLDivElement | null>(null);

  // Emma Frost ability states
  const [mindControlPhase, setMindControlPhase] = useState<
    'idle' | 'choosing' | 'paralysis' | 'sleep' | 'mental-damage'
  >('idle');
  const [astralActive, setAstralActive] = useState(false);
  const [astralPhase, setAstralPhase] = useState<'idle' | 'projecting' | 'returning'>(
    'idle',
  );
  const astralPhaseRef = useRef<'idle' | 'projecting' | 'returning'>('idle');
  astralPhaseRef.current = astralPhase;
  const [diamondActive, setDiamondActive] = useState(false);
  const [telepathicWaveActive, setTelepathicWaveActive] = useState(false);
  const [diamondProjCd, setDiamondProjCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const diamondProjCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  diamondProjCdRef.current = diamondProjCd;
  const diamondProjVeilRef = useRef<HTMLDivElement | null>(null);

  // Hela ability states (Crown Form 5th button + Sword Summon Throw button)
  const [crownActive, setCrownActive] = useState(false);
  const crownActiveRef = useRef(false);
  crownActiveRef.current = crownActive;
  const crownStartMsRef = useRef<number>(0);
  const crownBarRef = useRef<HTMLDivElement | null>(null);
  const [crownCd, setCrownCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const crownCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  crownCdRef.current = crownCd;
  const crownVeilRef = useRef<HTMLDivElement | null>(null);

  const [swordSummonActive, setSwordSummonActive] = useState(false);
  const [swordThrowReady, setSwordThrowReady] = useState(false);
  const [swordThrowCd, setSwordThrowCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const swordThrowCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  swordThrowCdRef.current = swordThrowCd;
  const swordThrowVeilRef = useRef<HTMLDivElement | null>(null);

  const [swordSlashCd, setSwordSlashCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const swordSlashCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  swordSlashCdRef.current = swordSlashCd;
  const swordSlashVeilRef = useRef<HTMLDivElement | null>(null);

  // Magneto, Quicksilver, Doctor Strange, and Vision active states
  const [magnetoTornadoActive, setMagnetoTornadoActive] = useState(false);
  const [superSpeedActive, setSuperSpeedActive] = useState(false);
  const [rapidPunchActive, setRapidPunchActive] = useState(false);
  const [speedBlitzActive, setSpeedBlitzActive] = useState(false);
  const [windTornadoActive, setWindTornadoActive] = useState(false);
  const [strangeShieldActive, setStrangeShieldActive] = useState(false);
  const strangeShieldActiveRef = useRef(false);
  strangeShieldActiveRef.current = strangeShieldActive;
  const strangeShieldStartMsRef = useRef<number>(0);
  const strangeShieldBarRef = useRef<HTMLDivElement | null>(null);
  const [strangeShieldCd, setStrangeShieldCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const strangeShieldCdRef = useRef<{ startMs: number; durationMs: number } | null>(
    null,
  );
  strangeShieldCdRef.current = strangeShieldCd;
  const strangeShieldVeilRef = useRef<HTMLDivElement | null>(null);

  // Agatha Harkness, Scarlet Witch Supreme Sorceress, and Wanda Zombie states
  const [supremeDrainActive, setSupremeDrainActive] = useState(false);
  const [supremeStacks, setSupremeStacks] = useState(0);
  const [zombieBeamActive, setZombieBeamActive] = useState(false);
  const [zombieStoneActive, setZombieStoneActive] = useState(false);
  const [agathaDarkholdActive, setAgathaDarkholdActive] = useState(false);
  const [agathaAutoShieldActive, setAgathaAutoShieldActive] = useState(false);
  const agathaAutoShieldActiveRef = useRef(false);
  const [agathaShieldActive, setAgathaShieldActive] = useState(false);

  const [visionIntangibleActive, setVisionIntangibleActive] = useState(false);
  const visionIntangibleActiveRef = useRef(false);
  visionIntangibleActiveRef.current = visionIntangibleActive;
  const visionIntangibleStartMsRef = useRef<number>(0);
  const visionIntangibleBarRef = useRef<HTMLDivElement | null>(null);
  const [visionPhaseCd, setVisionPhaseCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const visionPhaseCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  visionPhaseCdRef.current = visionPhaseCd;
  const visionPhaseVeilRef = useRef<HTMLDivElement | null>(null);
  const [visionLaserActive, setVisionLaserActive] = useState(false);
  const [visionHeadGripActive, setVisionHeadGripActive] = useState(false);
  // Invisible Woman ability states
  const [invisibilityActive, setInvisibilityActive] = useState(false);
  const [forcefieldShieldActive, setForcefieldShieldActive] = useState(false);
  const [forcefieldTransferPhase, setForcefieldTransferPhase] = useState<
    'idle' | 'choosing' | 'protection' | 'suffocation'
  >('idle');
  const [forcefieldBarrierLocked, setForcefieldBarrierLocked] = useState(false);
  // Phoenix Force / Dark Phoenix / White Phoenix flight-only Solar Dive states
  const [phoenixDivePhase, setPhoenixDivePhase] = useState<
    'idle' | 'ascending' | 'hovering' | 'diving'
  >('idle');
  const phoenixDivePhaseRef = useRef<'idle' | 'ascending' | 'hovering' | 'diving'>(
    'idle',
  );
  phoenixDivePhaseRef.current = phoenixDivePhase;
  const phoenixHoverStartMsRef = useRef<number>(0);
  const phoenixHoverBarRef = useRef<HTMLDivElement | null>(null);
  const [phoenixDiveCd, setPhoenixDiveCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const phoenixDiveCdRef = useRef<{ startMs: number; durationMs: number } | null>(
    null,
  );
  phoenixDiveCdRef.current = phoenixDiveCd;
  const phoenixDiveVeilRef = useRef<HTMLDivElement | null>(null);
  // Vampire ability states
  const [vampireAbsorbing, setVampireAbsorbing] = useState(false);
  const [stolenAbility, setStolenAbility] = useState<StolenAbilitySlotState | null>(null);
  const [vampireStompDiving, setVampireStompDiving] = useState(false);
  const vampireStompDivingRef = useRef(false);
  vampireStompDivingRef.current = vampireStompDiving;
  const [vampireStompCd, setVampireStompCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const vampireStompCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  vampireStompCdRef.current = vampireStompCd;
  const vampireStompVeilRef = useRef<HTMLDivElement | null>(null);
  // Captain America & Thor ability states
  const [capShieldAway, setCapShieldAway] = useState(false);
  const [capShieldDefenseActive, setCapShieldDefenseActive] = useState(false);
  const [capShieldChargeActive, setCapShieldChargeActive] = useState(false);
  const [magnetoMeteorActive, setMagnetoMeteorActive] = useState(false);
  const [thorMjolnirAway, setThorMjolnirAway] = useState(false);
  const [thorSlamActive, setThorSlamActive] = useState(false);
  const thorSlamActiveRef = useRef(false);
  thorSlamActiveRef.current = thorSlamActive;
  const [thorSlamCd, setThorSlamCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const thorSlamCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  thorSlamCdRef.current = thorSlamCd;
  const thorSlamVeilRef = useRef<HTMLDivElement | null>(null);
  const [thorStormBeamPhase, setThorStormBeamPhase] = useState<'idle' | 'channel' | 'beam'>('idle');
  // Silver Surfer & Storm ability states
  const [damageAbsorptionActive, setDamageAbsorptionActive] = useState(false);
  const [silverEnergy, setSilverEnergy] = useState(0);
  const [dualCosmicBeamActive, setDualCosmicBeamActive] = useState(false);
  const [stormLightningActive, setStormLightningActive] = useState(false);
  const stormLightningActiveRef = useRef(false);
  stormLightningActiveRef.current = stormLightningActive;
  const [stormLightningCd, setStormLightningCd] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const stormLightningCdRef = useRef<{ startMs: number; durationMs: number } | null>(null);
  stormLightningCdRef.current = stormLightningCd;
  const stormLightningVeilRef = useRef<HTMLDivElement | null>(null);
  const [stormTornadoActive, setStormTornadoActive] = useState(false);
  const [stormIceSpearActive, setStormIceSpearActive] = useState(false);
  const [windBlastActive, setWindBlastActive] = useState(false);
  const [abilityFeedback, setAbilityFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number>(0);

  const handleTriggerDeathRef = useRef<() => void>(() => {});

  const [selectedCharacterId, setSelectedCharacterId] = useState(
    CHARACTER_REGISTRY[0].id,
  );
  const selectedCharacterIdRef = useRef(selectedCharacterId);
  selectedCharacterIdRef.current = selectedCharacterId;

  const [unlockedSkins, setUnlockedSkins] = useState<string[]>(() =>
    loadUnlockedSkins(),
  );
  const unlockedSkinsRef = useRef(unlockedSkins);
  unlockedSkinsRef.current = unlockedSkins;

  const [selectedSkinsByChar, setSelectedSkinsByChar] = useState<
    Record<string, string>
  >(() => loadSelectedSkins());
  const selectedSkinsByCharRef = useRef(selectedSkinsByChar);
  selectedSkinsByCharRef.current = selectedSkinsByChar;

  const activeVoiceGenderRef = useRef<CharacterGender>('female');

  const [coins, setCoins] = useState<number>(() => loadCoinBalance());
  const coinsRef = useRef(coins);
  coinsRef.current = coins;

  const [playerHealth, setPlayerHealth] = useState<{ hp: number; maxHp: number }>(
    () => ({
      hp: CHARACTER_REGISTRY[0].maxHp,
      maxHp: CHARACTER_REGISTRY[0].maxHp,
    }),
  );
  const healKeyRef = useRef(0);
  const [healEvent, setHealEvent] = useState<{ key: number; amount: number } | null>(
    null,
  );

  const [sprintEnabled, setSprintEnabled] = useState(false);
  const sprintEnabledRef = useRef(false);

  const [wingsEnabled, setWingsEnabled] = useState(false);
  const wingsEnabledRef = useRef(false);
  const [jumpBtnPressed, setJumpBtnPressed] = useState(false);

  const [graphicsSettings, setGraphicsSettings] = useState<GraphicsSettings>(() =>
    loadGraphicsSettings(isPc),
  );
  const graphicsSettingsRef = useRef(graphicsSettings);
  graphicsSettingsRef.current = graphicsSettings;

  useEffect(() => {
    const platformSettings = loadGraphicsSettings(isPc);
    setGraphicsSettings(platformSettings);
    soundEngineRef.current?.setMasterVolume(platformSettings.masterVolume);
    engineRef.current?.applyGraphicsSettings(platformSettings);
    if (!platformSettings.screenEffects) {
      screenFxRef.current?.reset();
      if (canvasMountRef.current && canvasBlurAppliedRef.current) {
        canvasMountRef.current.style.filter = 'none';
        canvasBlurAppliedRef.current = false;
      }
    }
  }, [isPc]);

  // Rotate stage automatically into landscape only on mobile/touch portrait viewports
  const forcedLandscape = !needsFullscreenStart && isPortrait && !isPc;

  // Virtual joystick DOM refs for zero-latency, zero-rerender pointer updates
  const joyRingRef = useRef<HTMLDivElement | null>(null);
  const joyKnobRef = useRef<HTMLDivElement | null>(null);
  const joyStateRef = useRef<{
    pointerId: number | null;
    originX: number;
    originY: number;
  }>({
    pointerId: null,
    originX: 0,
    originY: 0,
  });

  // Right-side camera look drag ref (mobile touch) & RMB free-look ref (PC mouse)
  const lookStateRef = useRef<{
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({
    pointerId: null,
    lastX: 0,
    lastY: 0,
  });
  const pcRightDragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const lastMouseClientRef = useRef<{ x: number; y: number } | null>(null);
  const shiftSprintHeldRef = useRef(false);

  // Active stage touch pointers (pinch strictly isolated to 2 right-zone fingers)
  const stagePointersRef = useRef<
    Map<number, { x: number; y: number; zone: 'left' | 'right' }>
  >(new Map());
  const tapTrackRef = useRef<
    Map<number, { startX: number; startY: number; startMs: number }>
  >(new Map());
  const lastTapEndMsRef = useRef<number>(0);
  const pinchStateRef = useRef<{
    active: boolean;
    startDist: number;
    lastDist: number;
    deadbandCleared: boolean;
  }>({
    active: false,
    startDist: 0,
    lastDist: 0,
    deadbandCleared: false,
  });

  const scheduleTimer = useCallback((fn: () => void, delayMs: number): number => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      fn();
    }, delayMs);
    timersRef.current.push(id);
    return id;
  }, []);

  const clearAllTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const stageSizeRef = useRef({
    winW: typeof window !== 'undefined' ? window.innerWidth : 800,
    winH: typeof window !== 'undefined' ? window.innerHeight : 600,
    localW: typeof window !== 'undefined' ? window.innerHeight : 600,
    localH: typeof window !== 'undefined' ? window.innerWidth : 800,
  });

  const resetAbilityStates = useCallback(
    (resetPersistentCooldowns = true) => {
      spawnLockedRef.current = false;
      setSpawnLocked(false);
      setTeleportLocked(false);
      setPainChanneling(false);
      setDarkholdActive(false);
      autoShieldActiveRef.current = false;
      setAutoShieldActive(false);
      setFlightActive(false);
      if (resetPersistentCooldowns) {
        flightCancelCdRef.current = null;
        setFlightCancelCd(null);
      }
      setMindControlPhase('idle');
      setAstralActive(false);
      astralPhaseRef.current = 'idle';
      setAstralPhase('idle');
      setDiamondActive(false);
      setTelepathicWaveActive(false);
      diamondProjCdRef.current = null;
      setDiamondProjCd(null);
      setCrownActive(false);
      if (resetPersistentCooldowns) {
        crownCdRef.current = null;
        setCrownCd(null);
      }
      setSwordSummonActive(false);
      setSwordThrowReady(false);
      swordThrowCdRef.current = null;
      setSwordThrowCd(null);
      swordSlashCdRef.current = null;
      setSwordSlashCd(null);
      setMagnetoTornadoActive(false);
      setMagnetoMeteorActive(false);
      setSuperSpeedActive(false);
      setRapidPunchActive(false);
      setSpeedBlitzActive(false);
      setWindTornadoActive(false);
      setStrangeShieldActive(false);
      strangeShieldCdRef.current = null;
      setStrangeShieldCd(null);
      setSupremeDrainActive(false);
      setSupremeStacks(0);
      setZombieBeamActive(false);
      setZombieStoneActive(false);
      setAgathaDarkholdActive(false);
      agathaAutoShieldActiveRef.current = false;
      setAgathaAutoShieldActive(false);
      setAgathaShieldActive(false);
      setVisionIntangibleActive(false);
      visionPhaseCdRef.current = null;
      setVisionPhaseCd(null);
      setVisionLaserActive(false);
      setVisionHeadGripActive(false);
      setInvisibilityActive(false);
      setForcefieldShieldActive(false);
      setForcefieldTransferPhase('idle');
      setForcefieldBarrierLocked(false);
      phoenixDivePhaseRef.current = 'idle';
      setPhoenixDivePhase('idle');
      phoenixDiveCdRef.current = null;
      setPhoenixDiveCd(null);
      setVampireAbsorbing(false);
      setStolenAbility(null);
      vampireStompDivingRef.current = false;
      setVampireStompDiving(false);
      vampireStompCdRef.current = null;
      setVampireStompCd(null);
      setCapShieldAway(false);
      setCapShieldDefenseActive(false);
      setCapShieldChargeActive(false);
      setThorMjolnirAway(false);
      thorSlamActiveRef.current = false;
      setThorSlamActive(false);
      thorSlamCdRef.current = null;
      setThorSlamCd(null);
      setThorStormBeamPhase('idle');
      setDamageAbsorptionActive(false);
      setSilverEnergy(0);
      setDualCosmicBeamActive(false);
      stormLightningActiveRef.current = false;
      setStormLightningActive(false);
      stormLightningCdRef.current = null;
      setStormLightningCd(null);
      setStormTornadoActive(false);
      setStormIceSpearActive(false);
      setWindBlastActive(false);
      window.clearTimeout(feedbackTimerRef.current);
      setAbilityFeedback(null);
    },
    [],
  );

  // Lifecycle: SoundEngine, Orientation listeners, Stage Size cache, and Timer cleanup
  useEffect(() => {
    const sound = new SoundEngine();
    sound.setMasterVolume(graphicsSettingsRef.current.masterVolume);
    soundEngineRef.current = sound;

    const syncStageMetrics = () => {
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const root = appRootRef.current;
      stageSizeRef.current.winW = winW;
      stageSizeRef.current.winH = winH;
      stageSizeRef.current.localW = root?.clientWidth || winH;
      stageSizeRef.current.localH = root?.clientHeight || winW;
      setIsPortrait(winH > winW);
    };

    syncStageMetrics();

    const ro =
      typeof ResizeObserver !== 'undefined' && appRootRef.current
        ? new ResizeObserver(syncStageMetrics)
        : null;
    if (appRootRef.current) ro?.observe(appRootRef.current);

    window.addEventListener('resize', syncStageMetrics);
    window.addEventListener('orientationchange', syncStageMetrics);
    document.addEventListener('fullscreenchange', syncStageMetrics);

    return () => {
      clearAllTimers();
      ro?.disconnect();
      window.removeEventListener('resize', syncStageMetrics);
      window.removeEventListener('orientationchange', syncStageMetrics);
      document.removeEventListener('fullscreenchange', syncStageMetrics);
      sound.setFlightAmbience(false);
      sound.setPainChannelAmbience(false);
      sound.dispose();
      soundEngineRef.current = null;
    };
  }, [clearAllTimers]);

  useEffect(() => {
    const root = appRootRef.current;
    stageSizeRef.current.winW = window.innerWidth;
    stageSizeRef.current.winH = window.innerHeight;
    stageSizeRef.current.localW = root?.clientWidth || window.innerHeight;
    stageSizeRef.current.localH = root?.clientHeight || window.innerWidth;
  }, [forcedLandscape]);

  // Restore authoritative server session state on mount
  useEffect(() => {
    let cancelled = false;
    restoreServerSession().then((serverState: SyncedGameState | null) => {
      if (cancelled || !serverState) return;

      const localCoins = loadCoinBalance();
      const localUnlocked = loadUnlockedSkins();
      const localSelectedSkins = loadSelectedSkins();
      const serverIsFresh =
        serverState.coins === 0 &&
        serverState.unlockedSkins.length === 0 &&
        Object.keys(serverState.selectedSkinsByChar).length === 0;

      if (
        serverIsFresh &&
        (localCoins > 0 ||
          localUnlocked.length > 0 ||
          Object.keys(localSelectedSkins).length > 0)
      ) {
        void validateServerState({
          selectedCharacterId: selectedCharacterIdRef.current,
          coins: localCoins,
          unlockedSkins: localUnlocked,
          selectedSkinsByChar: localSelectedSkins,
        });
        return;
      }

      if (serverState.coins !== coinsRef.current) {
        coinsRef.current = serverState.coins;
        setCoins(serverState.coins);
        saveCoinBalance(serverState.coins);
      }
      if (serverState.unlockedSkins.length > 0) {
        unlockedSkinsRef.current = serverState.unlockedSkins;
        setUnlockedSkins(serverState.unlockedSkins);
        saveUnlockedSkins(serverState.unlockedSkins);
      }
      if (Object.keys(serverState.selectedSkinsByChar).length > 0) {
        selectedSkinsByCharRef.current = serverState.selectedSkinsByChar;
        setSelectedSkinsByChar(serverState.selectedSkinsByChar);
        saveSelectedSkins(serverState.selectedSkinsByChar);
      }
      if (
        serverState.selectedCharacterId &&
        serverState.selectedCharacterId !== selectedCharacterIdRef.current
      ) {
        setSelectedCharacterId(serverState.selectedCharacterId);
      }

      if (engineRef.current) {
        engineRef.current.restoreStaminaState(
          serverState.stamina,
          serverState.staminaRegenDelayRemaining,
          serverState.sprintEnabled,
        );
        profileHudRef.current?.setStamina(serverState.stamina, serverState.maxStamina);
      } else {
        pendingStaminaRestoreRef.current = {
          stamina: serverState.stamina,
          regenDelayRemaining: serverState.staminaRegenDelayRemaining,
          sprintEnabled: serverState.sprintEnabled,
        };
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Smooth RAF wipe for Scarlet Witch Flight Cancellation 5s cooldown
  useEffect(() => {
    if (!flightCancelCd) return;
    let rafId = 0;

    const tick = () => {
      const cd = flightCancelCdRef.current;
      if (!cd) return;
      const elapsed = performance.now() - cd.startMs;
      const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
      if (flightCancelVeilRef.current) {
        flightCancelVeilRef.current.style.transform = `scaleY(${1 - progress})`;
      }
      if (elapsed >= cd.durationMs) {
        flightCancelCdRef.current = null;
        setFlightCancelCd(null);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [flightCancelCd]);

  // Smooth RAF wipe for Emma Frost Diamond Shard projectile cooldown
  useEffect(() => {
    if (!diamondProjCd) return;
    let rafId = 0;

    const tick = () => {
      const cd = diamondProjCdRef.current;
      if (!cd) return;
      const elapsed = performance.now() - cd.startMs;
      const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
      if (diamondProjVeilRef.current) {
        diamondProjVeilRef.current.style.transform = `scaleY(${1 - progress})`;
      }
      if (elapsed >= cd.durationMs) {
        diamondProjCdRef.current = null;
        setDiamondProjCd(null);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [diamondProjCd]);

  // Smooth RAF progress bar & cooldown wipe for Hela Crown Form (5th button)
  useEffect(() => {
    if (!crownActive && !crownCd) return;
    if (crownActive) {
      crownStartMsRef.current = performance.now();
    }
    let rafId = 0;

    const tick = () => {
      const now = performance.now();
      let keepGoing = false;
      if (crownActiveRef.current && crownBarRef.current) {
        const rem = Math.max(0, 1 - (now - crownStartMsRef.current) / HELA_CROWN_DURATION_MS);
        crownBarRef.current.style.transform = `scaleX(${rem})`;
        keepGoing = true;
      }
      const cd = crownCdRef.current;
      if (cd) {
        const elapsed = now - cd.startMs;
        const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
        if (crownVeilRef.current) {
          crownVeilRef.current.style.transform = `scaleY(${1 - progress})`;
        }
        if (elapsed >= cd.durationMs) {
          crownCdRef.current = null;
          setCrownCd(null);
        } else {
          keepGoing = true;
        }
      }
      if (keepGoing) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [crownActive, crownCd]);

  // Smooth RAF wipe for Hela Throw Sword 2s reload cooldown
  useEffect(() => {
    if (!swordThrowCd) return;
    let rafId = 0;

    const tick = () => {
      const cd = swordThrowCdRef.current;
      if (!cd) return;
      const elapsed = performance.now() - cd.startMs;
      const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
      if (swordThrowVeilRef.current) {
        swordThrowVeilRef.current.style.transform = `scaleY(${1 - progress})`;
      }
      if (elapsed >= cd.durationMs) {
        swordThrowCdRef.current = null;
        setSwordThrowCd(null);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [swordThrowCd]);

  // Smooth RAF wipe for Hela Close-Range Slash 0.8s cooldown
  useEffect(() => {
    if (!swordSlashCd) return;
    let rafId = 0;

    const tick = () => {
      const cd = swordSlashCdRef.current;
      if (!cd) return;
      const elapsed = performance.now() - cd.startMs;
      const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
      if (swordSlashVeilRef.current) {
        swordSlashVeilRef.current.style.transform = `scaleY(${1 - progress})`;
      }
      if (elapsed >= cd.durationMs) {
        swordSlashCdRef.current = null;
        setSwordSlashCd(null);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [swordSlashCd]);

  // Smooth RAF progress bar & cooldown wipe for Vision Intangibility (Flight-only button)
  useEffect(() => {
    if (!visionIntangibleActive && !visionPhaseCd) return;
    if (visionIntangibleActive) {
      visionIntangibleStartMsRef.current = performance.now();
    }
    let rafId = 0;

    const tick = () => {
      const now = performance.now();
      let keepGoing = false;
      if (visionIntangibleActiveRef.current && visionIntangibleBarRef.current) {
        const rem = Math.max(
          0,
          1 -
            (now - visionIntangibleStartMsRef.current) /
              VISION_INTANGIBLE_MAX_DURATION_MS,
        );
        visionIntangibleBarRef.current.style.transform = `scaleX(${rem})`;
        keepGoing = true;
      }
      const cd = visionPhaseCdRef.current;
      if (cd) {
        const elapsed = now - cd.startMs;
        const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
        if (visionPhaseVeilRef.current) {
          visionPhaseVeilRef.current.style.transform = `scaleY(${1 - progress})`;
        }
        if (elapsed >= cd.durationMs) {
          visionPhaseCdRef.current = null;
          setVisionPhaseCd(null);
        } else {
          keepGoing = true;
        }
      }
      if (keepGoing) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [visionIntangibleActive, visionPhaseCd]);

  // Smooth RAF progress bar & cooldown wipe for Doctor Strange Mystic Shield (Flight-only button)
  useEffect(() => {
    if (!strangeShieldActive && !strangeShieldCd) return;
    if (strangeShieldActive) {
      strangeShieldStartMsRef.current = performance.now();
    }
    let rafId = 0;

    const tick = () => {
      const now = performance.now();
      let keepGoing = false;
      if (strangeShieldActiveRef.current && strangeShieldBarRef.current) {
        const rem = Math.max(
          0,
          1 - (now - strangeShieldStartMsRef.current) / STRANGE_SHIELD_MAX_DURATION_MS,
        );
        strangeShieldBarRef.current.style.transform = `scaleX(${rem})`;
        keepGoing = true;
      }
      const cd = strangeShieldCdRef.current;
      if (cd) {
        const elapsed = now - cd.startMs;
        const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
        if (strangeShieldVeilRef.current) {
          strangeShieldVeilRef.current.style.transform = `scaleY(${1 - progress})`;
        }
        if (elapsed >= cd.durationMs) {
          strangeShieldCdRef.current = null;
          setStrangeShieldCd(null);
        } else {
          keepGoing = true;
        }
      }
      if (keepGoing) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [strangeShieldActive, strangeShieldCd]);

  // Smooth RAF 3.0s hover countdown bar & cooldown wipe for Phoenix Flight Dive
  useEffect(() => {
    if (phoenixDivePhase !== 'hovering' && !phoenixDiveCd) return;
    if (phoenixDivePhase === 'hovering') {
      phoenixHoverStartMsRef.current = performance.now();
    }
    let rafId = 0;

    const tick = () => {
      const now = performance.now();
      let keepGoing = false;
      if (phoenixDivePhaseRef.current === 'hovering' && phoenixHoverBarRef.current) {
        const rem = Math.max(0, 1 - (now - phoenixHoverStartMsRef.current) / 3000);
        phoenixHoverBarRef.current.style.transform = `scaleX(${rem})`;
        keepGoing = true;
      }
      const cd = phoenixDiveCdRef.current;
      if (cd) {
        const elapsed = now - cd.startMs;
        const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
        if (phoenixDiveVeilRef.current) {
          phoenixDiveVeilRef.current.style.transform = `scaleY(${1 - progress})`;
        }
        if (elapsed >= cd.durationMs) {
          phoenixDiveCdRef.current = null;
          setPhoenixDiveCd(null);
        } else {
          keepGoing = true;
        }
      }
      if (keepGoing) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [phoenixDivePhase, phoenixDiveCd]);

  // Smooth RAF cooldown wipe for Vampire Flight-Only Ground Stomp
  useEffect(() => {
    if (!vampireStompCd) return;
    let rafId = 0;

    const tick = () => {
      const cd = vampireStompCdRef.current;
      if (!cd) return;
      const elapsed = performance.now() - cd.startMs;
      const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
      if (vampireStompVeilRef.current) {
        vampireStompVeilRef.current.style.transform = `scaleY(${1 - progress})`;
      }
      if (elapsed >= cd.durationMs) {
        vampireStompCdRef.current = null;
        setVampireStompCd(null);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [vampireStompCd]);

  // Smooth RAF cooldown wipe for Storm Flight-Only Lightning Strike
  useEffect(() => {
    if (!stormLightningCd) return;
    let rafId = 0;

    const tick = () => {
      const cd = stormLightningCdRef.current;
      if (!cd) return;
      const elapsed = performance.now() - cd.startMs;
      const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
      if (stormLightningVeilRef.current) {
        stormLightningVeilRef.current.style.transform = `scaleY(${1 - progress})`;
      }
      if (elapsed >= cd.durationMs) {
        stormLightningCdRef.current = null;
        setStormLightningCd(null);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [stormLightningCd]);

  // Smooth RAF cooldown wipe for Thor Flight-Only Lightning Slam
  useEffect(() => {
    if (!thorSlamCd) return;
    let rafId = 0;

    const tick = () => {
      const cd = thorSlamCdRef.current;
      if (!cd) return;
      const elapsed = performance.now() - cd.startMs;
      const progress = Math.min(Math.max(elapsed / cd.durationMs, 0), 1);
      if (thorSlamVeilRef.current) {
        thorSlamVeilRef.current.style.transform = `scaleY(${1 - progress})`;
      }
      if (elapsed >= cd.durationMs) {
        thorSlamCdRef.current = null;
        setThorSlamCd(null);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [thorSlamCd]);

  // Lifecycle: Mount GameEngine ONLY while in gameplay (single active WebGL context)
  useEffect(() => {
    if (!engineActive) return;
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const selectedChar = getCharacterById(selectedCharacterIdRef.current);
    const activeSkinId = selectedSkinsByCharRef.current[selectedChar.id] ?? null;
    const resolved = resolveCharacterWithSkin(selectedChar, activeSkinId);
    activeVoiceGenderRef.current = resolved.gender;
    soundEngineRef.current?.stopSelectionVoice();

    setPlayerHealth({ hp: resolved.maxHp, maxHp: resolved.maxHp });
    setHealEvent(null);
    setTestBotEnabled(false);
    setTestAiEnabled(false);
    resetAbilityStates(true);

    const engine = new GameEngine(
      mountEl,
      {
        onJump: () => {
          soundEngineRef.current?.playJump();
        },
        onLandDust: (intensity) => {
          soundEngineRef.current?.playLandDust(intensity);
        },
        onHitTarget: () => {
          soundEngineRef.current?.playMagicHit();
          reticleRef.current?.triggerHitMarker();
        },
        onTeleportArrive: () => {
          soundEngineRef.current?.playTeleportArrive();
        },
        onSpawnLockChange: (locked) => {
          spawnLockedRef.current = locked;
          setSpawnLocked(locked);
        },
        onTeleportLockChange: (locked) => {
          setTeleportLocked(locked);
        },
        onChaosImplosionAbsorb: () => {
          soundEngineRef.current?.playChaosImplosionAbsorb();
        },
        onScarletFlightCancelShockwave: () => {
          soundEngineRef.current?.playScarletFlightCancelShockwave();
        },
        onDarkholdChange: (active, triggerCooldown) => {
          setDarkholdActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playDarkholdClose();
            abilityBarRef.current?.startCooldown('darkhold');
          }
        },
        onAutoShieldChange: (active) => {
          const wasActive = autoShieldActiveRef.current;
          autoShieldActiveRef.current = active;
          setAutoShieldActive(active);
          if (wasActive && !active) {
            abilityBarRef.current?.startCooldown('auto-shield');
          }
        },
        onAutoShieldDeflect: () => {
          soundEngineRef.current?.playAutoShieldDeflect();
        },
        onPhoenixWaveCast: () => {
          soundEngineRef.current?.playPhoenixWaveCast();
        },
        onPhoenixWaveStep: (stepIdx) => {
          soundEngineRef.current?.playPhoenixWaveExplosion(stepIdx);
        },
        onPhoenixFireballHit: () => {
          soundEngineRef.current?.playPhoenixFireballImpact();
        },
        onBurnTick: () => {
          soundEngineRef.current?.playBurnTick();
        },
        onPainInflictionTick: () => {
          soundEngineRef.current?.playPainInflictionTick();
        },
        onPainInflictionExplosion: () => {
          soundEngineRef.current?.playPainInflictionExplosion();
        },
        onPainInflictionChange: (active) => {
          setPainChanneling(active);
          soundEngineRef.current?.setPainChannelAmbience(active);
          if (!active) {
            abilityBarRef.current?.startCooldown('pain-infliction');
          }
        },
        onRevivalStart: () => {
          soundEngineRef.current?.playRevival(
            selectedCharacterIdRef.current === 'phoenix-force',
          );
        },
        onPhoenixSpecialRevival: (phase) => {
          if (phase === 'rise') {
            soundEngineRef.current?.playPhoenixSpecialRise();
          } else if (phase === 'manifest') {
            soundEngineRef.current?.playPhoenixSpecialManifest();
          }
        },
        onFlightForceChange: (active) => {
          setFlightActive(active);
          abilityBarRef.current?.syncFlightState(active);
          soundEngineRef.current?.setFlightAmbience(active);
        },
        onMindControlChange: (phase, triggerCooldown) => {
          setMindControlPhase(phase);
          if (triggerCooldown) {
            abilityBarRef.current?.startCooldown('mind-control');
          }
        },
        onMentalAttackImpact: () => {
          soundEngineRef.current?.playMentalImpact();
        },
        onDiamondFormChange: (active, triggerCooldown) => {
          setDiamondActive(active);
          if (!active) {
            diamondProjCdRef.current = null;
            setDiamondProjCd(null);
          }
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playDiamondForm(false);
            abilityBarRef.current?.startCooldown('diamond-form');
          }
        },
        onTelepathicWaveChange: (active, triggerCooldown) => {
          setTelepathicWaveActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('telepathic-wave');
          }
        },
        onAstralProjectionChange: (active, triggerCooldown) => {
          setAstralActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playAstralToggle(false);
            abilityBarRef.current?.startCooldown('astral-projection');
          }
        },
        onAstralPhaseChange: (phase) => {
          astralPhaseRef.current = phase;
          setAstralPhase(phase);
        },
        onDiamondProjectileImpact: () => {
          soundEngineRef.current?.playDiamondShardImpact();
        },
        onPhoenixDiveChange: (phase, triggerCooldown) => {
          phoenixDivePhaseRef.current = phase;
          setPhoenixDivePhase(phase);
          if (phase === 'ascending') {
            soundEngineRef.current?.playPhoenixDiveLaunch();
          } else if (phase === 'diving') {
            soundEngineRef.current?.playPhoenixDiveDive();
          } else if (phase === 'idle' && triggerCooldown) {
            soundEngineRef.current?.playPhoenixDiveImpact();
            const phoenixSkin = selectedSkinsByCharRef.current['phoenix-force'];
            const diveCdMs =
              phoenixSkin === WHITE_PHOENIX_SKIN_ID
                ? WHITE_PHOENIX_DIVE_ABILITY.cooldownMs
                : phoenixSkin === DARK_PHOENIX_SKIN_ID
                  ? DARK_PHOENIX_DIVE_ABILITY.cooldownMs
                  : PHOENIX_DIVE_ABILITY.cooldownMs;
            const nextCd = {
              startMs: performance.now(),
              durationMs: diveCdMs,
            };
            phoenixDiveCdRef.current = nextCd;
            setPhoenixDiveCd(nextCd);
          }
        },
        onCrownFormChange: (active, triggerCooldown) => {
          setCrownActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playCrownForm(false);
            const helaSkin = selectedSkinsByCharRef.current['hela'];
            const crownCdMs =
              helaSkin === WHITE_HELA_SKIN_ID
                ? WHITE_HELA_CROWN_FORM.cooldownMs
                : HELA_CROWN_FORM.cooldownMs;
            const nextCd = {
              startMs: performance.now(),
              durationMs: crownCdMs,
            };
            crownCdRef.current = nextCd;
            setCrownCd(nextCd);
          }
        },
        onSwordSummonChange: (active, triggerCooldown) => {
          setSwordSummonActive(active);
          if (!active) {
            setSwordThrowReady(false);
            swordThrowCdRef.current = null;
            setSwordThrowCd(null);
            swordSlashCdRef.current = null;
            setSwordSlashCd(null);
          }
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('sword-summon');
          }
        },
        onSwordThrowAvailabilityChange: (ready) => {
          setSwordThrowReady(ready);
          if (!ready) {
            const helaSkin = selectedSkinsByCharRef.current['hela'];
            const throwReadyMs =
              helaSkin === WHITE_HELA_SKIN_ID
                ? WHITE_HELA_SWORD_THROW_READY_MS
                : HELA_SWORD_THROW_READY_MS;
            const nextCd = {
              startMs: performance.now(),
              durationMs: throwReadyMs,
            };
            swordThrowCdRef.current = nextCd;
            setSwordThrowCd(nextCd);
          } else {
            swordThrowCdRef.current = null;
            setSwordThrowCd(null);
          }
        },
        onSwordSlash: () => {
          soundEngineRef.current?.playSwordSlash();
        },
        onSwordEmbed: () => {
          soundEngineRef.current?.playSwordEmbed();
        },
        onGreenExplosion: (phase) => {
          if (phase === 'charge') {
            soundEngineRef.current?.playGreenCharge();
          } else {
            soundEngineRef.current?.playGreenExplosion();
          }
        },
        onSpinningLeap: (phase) => {
          if (phase === 'launch') {
            soundEngineRef.current?.playSpinningLeap();
          } else {
            soundEngineRef.current?.playHeroLanding();
          }
        },
        onGroundSword: () => {
          soundEngineRef.current?.playGroundSword();
        },
        onAbilityFeedback: (message) => {
          window.clearTimeout(feedbackTimerRef.current);
          setAbilityFeedback(message);
          feedbackTimerRef.current = window.setTimeout(() => {
            setAbilityFeedback(null);
          }, 1600);
        },
        onMagnetoMeteorStage: (stage) => {
          if (stage === 'charge') {
            setMagnetoMeteorActive(true);
            soundEngineRef.current?.playMagnetoMeteorCharge();
          } else if (stage === 'impact') {
            setMagnetoMeteorActive(false);
            soundEngineRef.current?.playMagnetoMeteorImpact();
          }
        },
        onMagnetoTornadoChange: (active, triggerCooldown) => {
          setMagnetoTornadoActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('metal-tornado');
          }
        },
        onMagnetoThrow: () => {
          soundEngineRef.current?.playMagnetoThrow();
        },
        onSuperSpeedChange: (active) => {
          setSuperSpeedActive(active);
        },
        onWindTornadoChange: (active, triggerCooldown) => {
          setWindTornadoActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('wind-tornado');
          }
        },
        onRapidPunchChange: (active, triggerCooldown) => {
          setRapidPunchActive(active);
          if (active) {
            soundEngineRef.current?.playQuicksilverSpeed(true);
          } else if (triggerCooldown) {
            abilityBarRef.current?.startCooldown('rapid-punch-combo');
          }
        },
        onSpeedBlitzChange: (active, triggerCooldown) => {
          setSpeedBlitzActive(active);
          if (active) {
            soundEngineRef.current?.playSpeedBlitz('dash');
          } else if (triggerCooldown) {
            soundEngineRef.current?.playSpeedBlitz('end');
            abilityBarRef.current?.startCooldown('speed-blitz');
          }
        },
        onRapidPunchStrike: (finisher) => {
          soundEngineRef.current?.playQuicksilverPunch(finisher);
        },
        onTimeStopCast: () => {
          soundEngineRef.current?.playTimeStop();
        },
        onStrangeShieldChange: (active, triggerCooldown) => {
          setStrangeShieldActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playStrangeShield(false);
            const nextCd = {
              startMs: performance.now(),
              durationMs: MYSTIC_SHIELD_ABILITY.cooldownMs,
            };
            strangeShieldCdRef.current = nextCd;
            setStrangeShieldCd(nextCd);
          }
        },
        onStrangeDiscCast: () => {
          soundEngineRef.current?.playEldritchDiscCast();
        },
        onStrangeDiscImpact: () => {
          soundEngineRef.current?.playEldritchDiscImpact();
        },
        onAstralExtractionCast: () => {
          soundEngineRef.current?.playAstralExtraction();
        },
        onStrangeClonesCast: () => {
          soundEngineRef.current?.playStrangeClones();
        },
        onAgathaDarkholdChange: (active, triggerCooldown) => {
          setAgathaDarkholdActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playDarkholdClose();
            abilityBarRef.current?.startCooldown('agatha-darkhold');
          }
        },
        onAgathaAutoShieldChange: (active) => {
          const wasActive = agathaAutoShieldActiveRef.current;
          agathaAutoShieldActiveRef.current = active;
          setAgathaAutoShieldActive(active);
          if (wasActive && !active) {
            abilityBarRef.current?.startCooldown('agatha-auto-shield');
          }
        },
        onAgathaShieldChange: (active, triggerCooldown) => {
          setAgathaShieldActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playAgathaShieldExplode();
            abilityBarRef.current?.startCooldown('agatha-shield');
          }
        },
        onAgathaShieldDrainTrigger: () => {
          soundEngineRef.current?.playAgathaDrainStart();
        },
        onSupremeDrainChange: (active) => {
          setSupremeDrainActive(active);
        },
        onSupremeStacksChange: (stacks) => {
          setSupremeStacks(stacks);
        },
        onZombieBeamChange: (active, triggerCooldown) => {
          setZombieBeamActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('zombie-beam');
          }
        },
        onZombieStoneExplosionChange: (active, triggerCooldown) => {
          setZombieStoneActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('zombie-stone-explosion');
          }
        },
        onPurgatoryGraspCast: () => {
          // Cast sound routed cleanly via handleAbilitySound
        },
        onVisionPhaseChange: (active, triggerCooldown) => {
          setVisionIntangibleActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playVisionPhase(false);
            const nextCd = {
              startMs: performance.now(),
              durationMs: VISION_INTANGIBILITY.cooldownMs,
            };
            visionPhaseCdRef.current = nextCd;
            setVisionPhaseCd(nextCd);
          }
        },
        onVisionLaserChange: (active, triggerCooldown) => {
          setVisionLaserActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('mind-stone-laser');
          }
        },
        onVisionBoltCharge: () => {
          soundEngineRef.current?.playVisionBoltCharge();
        },
        onVisionBoltSmallCast: () => {
          soundEngineRef.current?.playVisionBoltSmall();
        },
        onVisionBoltCooldown: () => {
          abilityBarRef.current?.startCooldown('mind-stone-projectile');
        },
        onVisionBoltCast: () => {
          soundEngineRef.current?.playVisionBolt();
        },
        onVisionBoltExplode: () => {
          soundEngineRef.current?.playVisionBoltExplode();
        },
        onVisionHeadGripChange: (active, triggerCooldown) => {
          setVisionHeadGripActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('head-grip');
          }
        },
        onInvisibilityChange: (active, triggerCooldown) => {
          setInvisibilityActive(active);
          void validateServerState({ invisibilityActive: active });
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playInvisibilityToggle(false);
            abilityBarRef.current?.startCooldown('invisibility');
          }
        },
        onForcefieldShieldChange: (active, triggerCooldown) => {
          setForcefieldShieldActive(active);
          void validateServerState({ forcefieldActive: active });
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playForcefieldShield(false);
            abilityBarRef.current?.startCooldown('forcefield-shield');
          }
        },
        onForcefieldTransferPhaseChange: (phase) => {
          setForcefieldTransferPhase(phase);
        },
        onForcefieldTransferCooldownStart: () => {
          abilityBarRef.current?.startForcefieldTransferCooldown();
        },
        onForcefieldBarrierCast: () => {
          // Cast sound routed cleanly via handleAbilitySound
        },
        onForcefieldBarrierHit: () => {
          soundEngineRef.current?.playForcefieldBarrierHit();
        },
        onForcefieldBarrierLockChange: (locked) => {
          setForcefieldBarrierLocked(locked);
        },
        onVampireAbsorbChange: (active, triggerCooldown) => {
          setVampireAbsorbing(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('power-absorption');
          }
        },
        onVampireStolenAbilityChange: (stolen) => {
          setStolenAbility(stolen);
          if (stolen) {
            soundEngineRef.current?.playVampireAbsorbComplete();
          }
        },
        onVampireStompChange: (diving, triggerCooldown) => {
          vampireStompDivingRef.current = diving;
          setVampireStompDiving(diving);
          if (diving) {
            soundEngineRef.current?.playVampireGroundStomp('dive');
          } else if (triggerCooldown) {
            soundEngineRef.current?.playVampireGroundStomp('impact');
            const nextCd = {
              startMs: performance.now(),
              durationMs: VAMPIRE_GROUND_STOMP.cooldownMs,
            };
            vampireStompCdRef.current = nextCd;
            setVampireStompCd(nextCd);
          }
        },
        onCapShieldThrowChange: (away, triggerCooldown) => {
          setCapShieldAway(away);
          if (away) {
            soundEngineRef.current?.playCapShieldThrow();
          } else if (triggerCooldown) {
            soundEngineRef.current?.playCapShieldCatch();
            abilityBarRef.current?.startCooldown('shield-throw');
          }
        },
        onCapShieldHit: () => {
          soundEngineRef.current?.playCapShieldRicochet();
        },
        onCapShieldDefenseChange: (active, triggerCooldown) => {
          setCapShieldDefenseActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playCapShieldDefense(false);
            abilityBarRef.current?.startCooldown('shield-defense');
          }
        },
        onCapComboStep: (step, cooldownMs) => {
          soundEngineRef.current?.playCapComboStrike(step);
          abilityBarRef.current?.startCooldown('shield-combo', cooldownMs);
        },
        onCapShieldChargeChange: (active, triggerCooldown) => {
          setCapShieldChargeActive(active);
          if (active) {
            soundEngineRef.current?.playCapShieldCharge(true);
          } else if (triggerCooldown) {
            soundEngineRef.current?.playCapShieldCharge(false);
            abilityBarRef.current?.startCooldown('shield-charge');
          }
        },
        onCapChargeBump: () => {
          soundEngineRef.current?.playCapChargeBump();
        },
        onThorComboStep: (step, cooldownMs) => {
          soundEngineRef.current?.playThorMjolnirSwing(step);
          abilityBarRef.current?.startCooldown('mjolnir-combo', cooldownMs);
        },
        onThorMjolnirThrowChange: (away, triggerCooldown) => {
          setThorMjolnirAway(away);
          if (away) {
            soundEngineRef.current?.playThorMjolnirThrow();
          } else if (triggerCooldown) {
            soundEngineRef.current?.playThorMjolnirCatch();
            abilityBarRef.current?.startCooldown('mjolnir-throw');
          }
        },
        onThorMjolnirImpact: () => {
          soundEngineRef.current?.playThorMjolnirImpact();
        },
        onThorMjolnirSummon: () => {
          soundEngineRef.current?.playThorMjolnirSummon();
        },
        onThorSlamChange: (active, triggerCooldown) => {
          thorSlamActiveRef.current = active;
          setThorSlamActive(active);
          if (active) {
            soundEngineRef.current?.playThorLightningSlamLaunch();
          } else if (triggerCooldown) {
            const nextCd = {
              startMs: performance.now(),
              durationMs: THOR_LIGHTNING_SLAM.cooldownMs,
            };
            thorSlamCdRef.current = nextCd;
            setThorSlamCd(nextCd);
          }
        },
        onThorSlamImpact: () => {
          soundEngineRef.current?.playThorLightningSlamImpact();
        },
        onThorStormBeamChange: (phase, triggerCooldown) => {
          setThorStormBeamPhase(phase);
          if (phase === 'channel') {
            soundEngineRef.current?.playThorStormChannel();
          } else if (phase === 'beam') {
            soundEngineRef.current?.playThorStormBeam();
          } else if (phase === 'idle' && triggerCooldown) {
            abilityBarRef.current?.startCooldown('lightning-storm-beam');
          }
        },
        onSilverEnergyChange: (energy, absorptionActive) => {
          setSilverEnergy(energy);
          setDamageAbsorptionActive(absorptionActive);
        },
        onSilverAbsorbCooldownStart: () => {
          abilityBarRef.current?.startCooldown('damage-absorption');
        },
        onSilverAbsorptionHit: () => {
          soundEngineRef.current?.playAbsorptionHit();
        },
        onSilverCosmicBlastCharge: () => {
          soundEngineRef.current?.playCosmicBlastCharge();
        },
        onSilverCosmicBlastCast: () => {
          soundEngineRef.current?.playCosmicBlastCast();
        },
        onSilverCosmicBlastImpact: () => {
          soundEngineRef.current?.playCosmicBlastExplosion();
        },
        onSonicBlastCast: () => {
          soundEngineRef.current?.playSonicBlast();
        },
        onSilverDualBeamChange: (active, triggerCooldown) => {
          setDualCosmicBeamActive(active);
          if (active) {
            soundEngineRef.current?.playDualCosmicBeam();
          } else if (triggerCooldown) {
            abilityBarRef.current?.startCooldown('dual-cosmic-beam');
          }
        },
        onStormTornadoChange: (active, triggerCooldown) => {
          setStormTornadoActive(active);
          if (!active && triggerCooldown) {
            abilityBarRef.current?.startCooldown('storm-tornado');
          }
        },
        onStormWindBlastChange: (active, triggerCooldown) => {
          setWindBlastActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playWindBlast(false);
            abilityBarRef.current?.startCooldown('wind-blast');
          }
        },
        onStormLightningRiseChange: (active, triggerCooldown) => {
          stormLightningActiveRef.current = active;
          setStormLightningActive(active);
          if (!active && triggerCooldown) {
            soundEngineRef.current?.playLightningStrikeImpact();
            const nextCd = {
              startMs: performance.now(),
              durationMs: STORM_LIGHTNING_STRIKE.cooldownMs,
            };
            stormLightningCdRef.current = nextCd;
            setStormLightningCd(nextCd);
          }
        },
        onStormIceSpearChange: (creating, triggerCooldown) => {
          setStormIceSpearActive(creating);
          if (!creating && triggerCooldown) {
            soundEngineRef.current?.playIceSpearLaunch();
            abilityBarRef.current?.startCooldown('ice-spear');
          }
        },
        onIceSpearShatter: () => {
          soundEngineRef.current?.playIceSpearShatter();
        },
        onNpcStrikePlayer: (kind) => {
          soundEngineRef.current?.playNpcStrike(kind);
        },
        onPlayerDamaged: (info) => {
          soundEngineRef.current?.playPlayerHurtImpact(info.heavy);
          soundEngineRef.current?.playVocalization(
            activeVoiceGenderRef.current,
            info.heavy ? 'pain-heavy' : info.repeated ? 'pain-repeated' : 'pain-light',
          );
        },
        onPlayerEffort: (kind) => {
          const vocalKind =
            kind === 'jump'
              ? 'effort-jump'
              : kind === 'land'
                ? 'effort-land'
                : kind === 'heavy-cast'
                  ? 'effort-heavy'
                  : 'effort-melee';
          soundEngineRef.current?.playVocalization(activeVoiceGenderRef.current, vocalKind);
        },
        onRockBreak: (intensity) => {
          soundEngineRef.current?.playRockBreak(intensity);
        },
        onShieldBreak: () => {
          soundEngineRef.current?.playShieldBreak();
        },
        onScreenFxUpdate: (fx) => {
          if (!graphicsSettingsRef.current.screenEffects) {
            screenFxRef.current?.reset();
            if (canvasMountRef.current && canvasBlurAppliedRef.current) {
              canvasMountRef.current.style.filter = 'none';
              canvasBlurAppliedRef.current = false;
            }
            return;
          }
          screenFxRef.current?.update(fx);
          if (canvasMountRef.current) {
            if (fx.blurPx > 0.04) {
              canvasMountRef.current.style.filter = `blur(${fx.blurPx.toFixed(2)}px)`;
              canvasBlurAppliedRef.current = true;
            } else if (canvasBlurAppliedRef.current) {
              canvasMountRef.current.style.filter = 'none';
              canvasBlurAppliedRef.current = false;
            }
          }
        },
        onNpcEliminated: (events) => {
          let totalEarned = 0;
          for (const ev of events) {
            totalEarned += ev.coins;
            coinHudRef.current?.spawnCoins(ev.screenX, ev.screenY, ev.coins);
          }
          if (totalEarned > 0) {
            setCoins((prev) => {
              const next = prev + totalEarned;
              saveCoinBalance(next);
              void validateServerState({ coins: next });
              return next;
            });
          }
        },
        onNpcHudUpdate: (snapshots) => {
          combatHudRef.current?.update(snapshots);
        },
        onPlayerTelemetryUpdate: (telemetry) => {
          latestTelemetryRef.current.killStreak = telemetry.killStreak;
          playerCombatHudRef.current?.updateTelemetry(telemetry);
        },
        onMultiKill: (event) => {
          playerCombatHudRef.current?.triggerMultiKill(event);
        },
        onPlayerHealthChange: (hp, maxHp) => {
          latestTelemetryRef.current.hp = hp;
          setPlayerHealth({ hp, maxHp });
        },
        onPlayerHeal: (amount) => {
          soundEngineRef.current?.playKillHeal();
          healKeyRef.current += 1;
          setHealEvent({ key: healKeyRef.current, amount });
        },
        onStaminaChange: (stamina, maxStamina, regenDelayRemaining) => {
          profileHudRef.current?.setStamina(stamina, maxStamina);
          const nowMs = performance.now();
          const crossedBoundary =
            (stamina <= 0 && lastSyncedStaminaValRef.current > 0) ||
            (stamina >= maxStamina && lastSyncedStaminaValRef.current < maxStamina);
          if (crossedBoundary || nowMs - lastStaminaSyncMsRef.current >= 450) {
            lastStaminaSyncMsRef.current = nowMs;
            lastSyncedStaminaValRef.current = stamina;
            void validateServerState({
              stamina,
              maxStamina,
              staminaRegenDelayRemaining: regenDelayRemaining,
              sprintEnabled: sprintEnabledRef.current,
              hp: latestTelemetryRef.current.hp,
              killStreak: latestTelemetryRef.current.killStreak,
            }).then((validated) => {
              if (validated && !validated.sprintEnabled && sprintEnabledRef.current) {
                sprintEnabledRef.current = false;
                setSprintEnabled(false);
                engineRef.current?.setSprintEnabled(false);
              }
            });
          }
        },
        onSprintForceChange: (active) => {
          sprintEnabledRef.current = active;
          setSprintEnabled(active);
        },
        onFlightEnergyChange: (flight, maxFlight) => {
          profileHudRef.current?.setFlight(flight, maxFlight);
        },
        onReticleScreenUpdate: (sx, sy, assist) => {
          reticleRef.current?.setPosition(sx, sy, assist);
        },
        onPlayerDeath: () => {
          handleTriggerDeathRef.current();
        },
      },
      graphicsSettingsRef.current,
      resolved.appearance,
      resolved.maxHp,
      resolved.damageMultiplier,
      selectedMapIdRef.current,
    );

    engine.setPcAimEnabled(isPcRef.current);
    engine.setWingsAlwaysVisible(wingsEnabledRef.current);
    engineRef.current = engine;

    const pendingStamina = pendingStaminaRestoreRef.current;
    if (pendingStamina) {
      pendingStaminaRestoreRef.current = null;
      engine.restoreStaminaState(
        pendingStamina.stamina,
        pendingStamina.regenDelayRemaining,
        pendingStamina.sprintEnabled,
      );
      profileHudRef.current?.setStamina(pendingStamina.stamina, 100);
    } else {
      const currentStamina = engine.getStaminaState();
      profileHudRef.current?.setStamina(currentStamina.stamina, currentStamina.maxStamina);
    }
    const currentFlight = engine.getFlightState();
    profileHudRef.current?.setFlight(currentFlight.flight, currentFlight.maxFlight);
    latestTelemetryRef.current = { hp: resolved.maxHp, killStreak: 0 };
    void validateServerState({
      selectedCharacterId: selectedChar.id,
      stamina: engine.getStaminaState().stamina,
      maxStamina: engine.getStaminaState().maxStamina,
      staminaRegenDelayRemaining: engine.getStaminaState().regenDelayRemaining,
      sprintEnabled: engine.getStaminaState().sprintEnabled,
      flightEnabled: false,
      invisibilityActive: false,
      forcefieldActive: false,
      hp: resolved.maxHp,
      killStreak: 0,
    });

    return () => {
      window.clearTimeout(feedbackTimerRef.current);
      soundEngineRef.current?.setFlightAmbience(false);
      soundEngineRef.current?.setPainChannelAmbience(false);
      screenFxRef.current?.reset();
      playerCombatHudRef.current?.reset();
      if (canvasMountRef.current && canvasBlurAppliedRef.current) {
        canvasMountRef.current.style.filter = 'none';
        canvasBlurAppliedRef.current = false;
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [engineActive, resetAbilityStates]);

  const handleEnterLandscapeFullscreen = async () => {
    soundEngineRef.current?.unlock();
    await requestDocumentFullscreen();
    await lockLandscapeOrientation();
    setIsPortrait(window.innerHeight > window.innerWidth);
    setNeedsFullscreenStart(false);
  };

  const toStageCoords = (clientX: number, clientY: number): [number, number] => {
    if (!forcedLandscape) {
      return [clientX, clientY];
    }
    const { winW, winH, localW, localH } = stageSizeRef.current;
    const u = clientY - winH * 0.5;
    const v = -(clientX - winW * 0.5);
    return [u + localW * 0.5, v + localH * 0.5];
  };

  const updateJoystickVisual = useCallback(
    (
      visible: boolean,
      originX: number,
      originY: number,
      knobOffsetX: number,
      knobOffsetY: number,
    ) => {
      const ring = joyRingRef.current;
      const knob = joyKnobRef.current;
      if (!ring || !knob) return;

      if (visible) {
        ring.style.opacity = '1';
        ring.style.transform = `translate3d(${originX - OUTER_RADIUS}px, ${originY - OUTER_RADIUS}px, 0)`;
        knob.style.transform = `translate3d(${knobOffsetX}px, ${knobOffsetY}px, 0)`;
      } else {
        ring.style.opacity = '0';
        knob.style.transform = 'translate3d(0px, 0px, 0)';
      }
    },
    [],
  );

  const updatePcCursorFromClient = useCallback((clientX: number, clientY: number) => {
    const root = appRootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    engineRef.current?.setPcCursorNdc(nx, ny);
  }, []);

  useEffect(() => {
    engineRef.current?.setPcAimEnabled(isPc);
    if (!isPc || gamePhase !== 'playing') {
      pcRightDragRef.current = null;
      reticleRef.current?.resetPosition();
    } else if (lastMouseClientRef.current) {
      updatePcCursorFromClient(
        lastMouseClientRef.current.x,
        lastMouseClientRef.current.y,
      );
    }
  }, [isPc, engineActive, gamePhase, updatePcCursorFromClient]);

  useEffect(() => {
    if (!isPc) return;

    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      lastMouseClientRef.current = { x: e.clientX, y: e.clientY };
      if (!engineActive || gamePhaseRef.current !== 'playing') return;

      const rightDrag = pcRightDragRef.current;
      if (rightDrag && rightDrag.pointerId === e.pointerId) {
        const dx = e.clientX - rightDrag.lastX;
        const dy = e.clientY - rightDrag.lastY;
        rightDrag.lastX = e.clientX;
        rightDrag.lastY = e.clientY;
        const sensScale = 0.25 + (graphicsSettingsRef.current.sensitivity / 100) * 1.75;
        engineRef.current?.rotateCamera(dx * 0.0052 * sensScale, dy * 0.0038 * sensScale);
        return;
      }
      if (!rightDrag) {
        updatePcCursorFromClient(e.clientX, e.clientY);
      }
    };

    const onWindowPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const rightDrag = pcRightDragRef.current;
      if (rightDrag && (rightDrag.pointerId === e.pointerId || e.button === 2)) {
        pcRightDragRef.current = null;
        if (gamePhaseRef.current === 'playing') {
          updatePcCursorFromClient(e.clientX, e.clientY);
        }
      }
    };

    const onWindowBlur = () => {
      pcRightDragRef.current = null;
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isPc, engineActive, updatePcCursorFromClient]);

  const resetAllStagePointers = useCallback(() => {
    stagePointersRef.current.clear();
    tapTrackRef.current.clear();
    lastTapEndMsRef.current = 0;
    pinchStateRef.current.active = false;
    pinchStateRef.current.startDist = 0;
    pinchStateRef.current.lastDist = 0;
    pinchStateRef.current.deadbandCleared = false;
    joyStateRef.current.pointerId = null;
    lookStateRef.current.pointerId = null;
    pcRightDragRef.current = null;
    setJumpBtnPressed(false);
    engineRef.current?.setJumpHeld(false);
    engineRef.current?.setJoystickVector(0, 0);
    updateJoystickVisual(false, 0, 0, 0, 0);
  }, [updateJoystickVisual]);

  const applyJoystickDelta = (dx: number, dy: number) => {
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, MAX_KNOB_TRAVEL);

    let knobX = 0;
    let knobY = 0;
    if (dist > 0.0001) {
      const scale = clampedDist / dist;
      knobX = dx * scale;
      knobY = dy * scale;
    }

    const normMag = clampedDist / MAX_KNOB_TRAVEL;
    let outX = 0;
    let outY = 0;
    if (normMag > JOYSTICK_DEADZONE && dist > 0.0001) {
      const remapped = (normMag - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
      outX = (dx / dist) * remapped;
      outY = -(dy / dist) * remapped;
    }

    engineRef.current?.setJoystickVector(outX, outY);
    updateJoystickVisual(
      true,
      joyStateRef.current.originX,
      joyStateRef.current.originY,
      knobX,
      knobY,
    );
  };

  /**
   * Pinch-to-zoom is strictly restricted to TWO fingers inside the RIGHT camera zone.
   * Moving with the left-side joystick + looking/dragging on the right side NEVER triggers zoom.
   */
  const tryBeginRightPinch = () => {
    let p1: { x: number; y: number; zone: 'left' | 'right' } | null = null;
    let p2: { x: number; y: number; zone: 'left' | 'right' } | null = null;
    let count = 0;
    for (const p of stagePointersRef.current.values()) {
      if (p.zone === 'right') {
        if (count === 0) p1 = p;
        else if (count === 1) p2 = p;
        count++;
      }
    }
    if (count !== 2 || !p1 || !p2) return false;

    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    pinchStateRef.current.active = true;
    pinchStateRef.current.startDist = dist;
    pinchStateRef.current.lastDist = dist;
    pinchStateRef.current.deadbandCleared = false;

    // Cancel camera-look single drag on right side while leaving left joystick untouched!
    lookStateRef.current.pointerId = null;
    return true;
  };

  const handleStagePointerDown = (
    zone: 'left' | 'right',
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (gamePhaseRef.current !== 'playing') return;
    e.preventDefault();
    soundEngineRef.current?.unlock();

    if (isPcRef.current) {
      if (e.pointerType === 'mouse') {
        if (e.button === 2) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Ignore pointer capture errors
          }
          pcRightDragRef.current = {
            pointerId: e.pointerId,
            lastX: e.clientX,
            lastY: e.clientY,
          };
        } else {
          updatePcCursorFromClient(e.clientX, e.clientY);
        }
      }
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    const [sx, sy] = toStageCoords(e.clientX, e.clientY);
    stagePointersRef.current.set(e.pointerId, { x: sx, y: sy, zone });
    tapTrackRef.current.set(e.pointerId, {
      startX: sx,
      startY: sy,
      startMs: performance.now(),
    });

    if (zone === 'right' && tryBeginRightPinch()) {
      return;
    }

    if (
      zone === 'left' &&
      !spawnLockedRef.current &&
      joyStateRef.current.pointerId === null &&
      phoenixDivePhaseRef.current === 'idle' &&
      astralPhaseRef.current !== 'returning'
    ) {
      joyStateRef.current.pointerId = e.pointerId;
      joyStateRef.current.originX = sx;
      joyStateRef.current.originY = sy;

      engineRef.current?.setJoystickVector(0, 0);
      updateJoystickVisual(true, sx, sy, 0, 0);
    } else if (
      zone === 'right' &&
      !pinchStateRef.current.active &&
      lookStateRef.current.pointerId === null
    ) {
      lookStateRef.current.pointerId = e.pointerId;
      lookStateRef.current.lastX = sx;
      lookStateRef.current.lastY = sy;
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gamePhaseRef.current !== 'playing') return;
    if (isPcRef.current) return;
    const tracked = stagePointersRef.current.get(e.pointerId);
    if (!tracked) return;
    e.preventDefault();

    const [sx, sy] = toStageCoords(e.clientX, e.clientY);
    tracked.x = sx;
    tracked.y = sy;

    if (joyStateRef.current.pointerId === e.pointerId) {
      const dx = sx - joyStateRef.current.originX;
      const dy = sy - joyStateRef.current.originY;
      applyJoystickDelta(dx, dy);
      return;
    }

    if (pinchStateRef.current.active && tracked.zone === 'right') {
      let p1: { x: number; y: number; zone: 'left' | 'right' } | null = null;
      let p2: { x: number; y: number; zone: 'left' | 'right' } | null = null;
      for (const p of stagePointersRef.current.values()) {
        if (p.zone === 'right') {
          if (!p1) p1 = p;
          else {
            p2 = p;
            break;
          }
        }
      }
      if (p1 && p2) {
        const newDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (!pinchStateRef.current.deadbandCleared) {
          if (Math.abs(newDist - pinchStateRef.current.startDist) > 8) {
            pinchStateRef.current.deadbandCleared = true;
            pinchStateRef.current.lastDist = newDist;
          }
          return;
        }
        const prevDist = pinchStateRef.current.lastDist;
        if (prevDist > 12 && newDist > 12) {
          const rawScale = prevDist / newDist;
          const clampedScale = Math.min(1.16, Math.max(0.86, rawScale));
          engineRef.current?.zoomCameraByScale(clampedScale);
        }
        pinchStateRef.current.lastDist = newDist;
      }
      return;
    }

    if (lookStateRef.current.pointerId === e.pointerId) {
      const dx = sx - lookStateRef.current.lastX;
      const dy = sy - lookStateRef.current.lastY;
      lookStateRef.current.lastX = sx;
      lookStateRef.current.lastY = sy;
      const sensScale = 0.25 + (graphicsSettingsRef.current.sensitivity / 100) * 1.75;
      engineRef.current?.rotateCamera(dx * 0.005 * sensScale, dy * 0.0036 * sensScale);
    }
  };

  const handleStagePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore pointer release errors
    }
    if (isPcRef.current) {
      if (
        e.pointerType === 'mouse' &&
        (pcRightDragRef.current?.pointerId === e.pointerId || e.button === 2)
      ) {
        pcRightDragRef.current = null;
        updatePcCursorFromClient(e.clientX, e.clientY);
      }
      return;
    }

    const prevPos = stagePointersRef.current.get(e.pointerId);
    const tapStart = tapTrackRef.current.get(e.pointerId);
    stagePointersRef.current.delete(e.pointerId);
    tapTrackRef.current.delete(e.pointerId);

    if (tapStart && phoenixDivePhaseRef.current === 'hovering') {
      const now = performance.now();
      const endX = prevPos?.x ?? tapStart.startX;
      const endY = prevPos?.y ?? tapStart.startY;
      const moved = Math.hypot(endX - tapStart.startX, endY - tapStart.startY);
      if (now - tapStart.startMs <= 280 && moved <= 18) {
        if (now - lastTapEndMsRef.current <= 380) {
          lastTapEndMsRef.current = 0;
          engineRef.current?.triggerPhoenixDiveNow();
        } else {
          lastTapEndMsRef.current = now;
        }
      }
    }

    if (pinchStateRef.current.active) {
      let rightCount = 0;
      for (const p of stagePointersRef.current.values()) {
        if (p.zone === 'right' && ++rightCount >= 2) break;
      }
      if (rightCount < 2) {
        pinchStateRef.current.active = false;
        pinchStateRef.current.deadbandCleared = false;
      }
    }

    if (joyStateRef.current.pointerId === e.pointerId) {
      joyStateRef.current.pointerId = null;
      engineRef.current?.setJoystickVector(0, 0);
      updateJoystickVisual(false, 0, 0, 0, 0);
    }

    if (lookStateRef.current.pointerId === e.pointerId) {
      lookStateRef.current.pointerId = null;
    }
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isPcRef.current || needsFullscreenStart || gamePhaseRef.current !== 'playing') {
      return;
    }
    const modeScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1;
    engineRef.current?.zoomCameraByDelta(e.deltaY * modeScale * 0.0028);
  };

  const setSprintActive = useCallback((active: boolean) => {
    if (active && (gamePhaseRef.current !== 'playing' || spawnLockedRef.current)) return;
    if (active) {
      soundEngineRef.current?.unlock();
    }
    const currentActual =
      engineRef.current?.getStaminaState().sprintEnabled ?? sprintEnabledRef.current;
    if (sprintEnabledRef.current === active && currentActual === active) return;

    sprintEnabledRef.current = active;
    setSprintEnabled(active);
    engineRef.current?.setSprintEnabled(active);
    const actualSprint = engineRef.current?.getStaminaState().sprintEnabled ?? active;
    if (actualSprint !== active) {
      sprintEnabledRef.current = actualSprint;
      setSprintEnabled(actualSprint);
    }
    if (gamePhaseRef.current === 'playing' && actualSprint !== currentActual) {
      soundEngineRef.current?.playSprintToggle(actualSprint);
    }
    const staminaState = engineRef.current?.getStaminaState();
    if (staminaState) {
      void validateServerState({
        stamina: staminaState.stamina,
        maxStamina: staminaState.maxStamina,
        staminaRegenDelayRemaining: staminaState.regenDelayRemaining,
        sprintEnabled: actualSprint,
      });
    }
  }, []);

  const toggleSprint = useCallback(() => {
    setSprintActive(!sprintEnabledRef.current);
  }, [setSprintActive]);

  // PC Hold-to-Sprint with Left Shift (ShiftLeft)
  useEffect(() => {
    if (!isPc) return;

    const releaseSprint = () => {
      shiftSprintHeldRef.current = false;
      setSprintActive(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'ShiftLeft') return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      shiftSprintHeldRef.current = true;
      if (e.repeat) return;
      if (gamePhaseRef.current !== 'playing' || spawnLockedRef.current) return;
      setSprintActive(true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'ShiftLeft') return;
      releaseSprint();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        releaseSprint();
        engineRef.current?.clearHeldInputs();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseSprint);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseSprint);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isPc, setSprintActive]);

  useEffect(() => {
    if (!isPc) return;
    if (gamePhase !== 'playing') {
      shiftSprintHeldRef.current = false;
      setSprintActive(false);
    } else if (!spawnLocked && shiftSprintHeldRef.current) {
      setSprintActive(true);
    }
  }, [isPc, gamePhase, spawnLocked, setSprintActive]);

  const toggleWings = useCallback(() => {
    if (gamePhaseRef.current !== 'playing' || painChanneling || spawnLockedRef.current) return;
    soundEngineRef.current?.unlock();
    const next = !wingsEnabledRef.current;
    wingsEnabledRef.current = next;
    setWingsEnabled(next);
    engineRef.current?.setWingsAlwaysVisible(next);
    soundEngineRef.current?.playWingsToggle(next);
  }, [painChanneling]);

  const handleFlightToggle = useCallback((active: boolean) => {
    if (gamePhaseRef.current !== 'playing' || (active && spawnLockedRef.current)) return false;
    const accepted = engineRef.current?.setFlightEnabled(active) ?? false;
    if (accepted) {
      soundEngineRef.current?.setFlightAmbience(active);
      setFlightActive(active);
      void validateServerState({
        selectedCharacterId: selectedCharacterIdRef.current,
        flightEnabled: active,
      });
    }
    return accepted;
  }, []);

  const handleScarletFlightCancel = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    const cd = flightCancelCdRef.current;
    const now = performance.now();
    if (cd && now - cd.startMs < cd.durationMs) return;

    soundEngineRef.current?.unlock();
    const accepted = engineRef.current?.cancelScarletFlightWithShockwave() ?? false;
    if (!accepted) return;

    soundEngineRef.current?.setFlightAmbience(false);
    setFlightActive(false);
    abilityBarRef.current?.endFlightWithCooldown();
    const nextCd = { startMs: now, durationMs: 5000 };
    flightCancelCdRef.current = nextCd;
    setFlightCancelCd(nextCd);
  }, []);

  const handleCastChaosBolt = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castChaosBolt() ?? false;
  }, []);

  const handleToggleDarkhold = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleDarkhold() ?? false;
  }, []);

  const handleCastTeleport = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castTeleport() ?? false;
  }, []);

  const handleCastTelekineticExplosion = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castTelekineticExplosion() ?? false;
  }, []);

  const handleCastAutoShield = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castAutoShield() ?? false;
  }, []);

  const handleCastChaosImplosion = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castChaosImplosion() ?? false;
  }, []);

  const handleCastPhoenixWave = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castPhoenixWave() ?? false;
  }, []);

  const handleCastPhoenixFireball = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castPhoenixFireball() ?? false;
  }, []);

  const handleTogglePainInfliction = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.togglePainInfliction() ?? false;
  }, []);

  const handleActivateMindControl = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.activateMindControl() ?? false;
  }, []);

  const handleSelectMindControlOption = useCallback(
    (option: 'mc-paralysis' | 'mc-sleep' | 'mc-mental-damage') => {
      if (gamePhaseRef.current !== 'playing') return;
      soundEngineRef.current?.unlock();
      engineRef.current?.selectMindControlOption(option);
    },
    [],
  );

  const handleCastMentalAttack = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castMentalAttack() ?? false;
  }, []);

  const handleToggleDiamond = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleDiamondForm() ?? false;
  }, []);

  const handleCastDiamondProjectile = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    const cd = diamondProjCdRef.current;
    const now = performance.now();
    if (cd && now - cd.startMs < cd.durationMs) return;

    soundEngineRef.current?.unlock();
    const accepted = engineRef.current?.castDiamondProjectile() ?? false;
    if (!accepted) return;

    soundEngineRef.current?.playDiamondShard();
    const nextCd = {
      startMs: now,
      durationMs: EMMA_DIAMOND_PROJECTILE.cooldownMs,
    };
    diamondProjCdRef.current = nextCd;
    setDiamondProjCd(nextCd);
  }, []);

  const handleCastTelepathicWave = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castTelepathicWave() ?? false;
  }, []);

  const handleToggleAstral = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleAstralProjection() ?? false;
  }, []);

  const handleToggleCrown = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    if (!crownActiveRef.current) {
      const cd = crownCdRef.current;
      if (cd && performance.now() - cd.startMs < cd.durationMs) return;
    }
    soundEngineRef.current?.unlock();
    const wasActive = crownActiveRef.current;
    const accepted = engineRef.current?.toggleCrownForm() ?? false;
    if (!accepted) return;

    if (!wasActive) {
      soundEngineRef.current?.playCrownForm(true);
    }
  }, []);

  const handleActivateSwordSummon = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.activateSwordSummon() ?? false;
  }, []);

  const handleThrowNecrosword = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    const cd = swordThrowCdRef.current;
    if (!swordThrowReady || (cd && performance.now() - cd.startMs < cd.durationMs)) {
      return;
    }
    soundEngineRef.current?.unlock();
    const accepted = engineRef.current?.throwNecrosword() ?? false;
    if (!accepted) return;

    soundEngineRef.current?.playSwordThrow();
  }, [swordThrowReady]);

  const handleCastSwordSlash = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    const cd = swordSlashCdRef.current;
    const now = performance.now();
    if (cd && now - cd.startMs < cd.durationMs) {
      return;
    }
    soundEngineRef.current?.unlock();
    const accepted = engineRef.current?.castSwordSlash() ?? false;
    if (!accepted) return;

    const helaSkin = selectedSkinsByCharRef.current['hela'];
    const slashCdMs =
      helaSkin === WHITE_HELA_SKIN_ID
        ? WHITE_HELA_SWORD_SLASH_COOLDOWN_MS
        : HELA_SWORD_SLASH_COOLDOWN_MS;
    const nextCd = {
      startMs: now,
      durationMs: slashCdMs,
    };
    swordSlashCdRef.current = nextCd;
    setSwordSlashCd(nextCd);
  }, []);

  const handleCastGreenExplosion = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castGreenExplosion() ?? false;
  }, []);

  const handleCastSpinningLeap = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castSpinningLeap() ?? false;
  }, []);

  const handleCastGroundSword = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castGroundSword() ?? false;
  }, []);

  const handleCastMetalProjectile = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castMetalProjectile() ?? false;
  }, []);

  const handleCastMagneticMeteor = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castMagneticMeteor() ?? false;
  }, []);

  const handleToggleMetalTornado = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleMetalTornado() ?? false;
  }, []);

  const handleToggleSuperSpeed = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleSuperSpeed() ?? false;
  }, []);

  const handleCastRapidPunchCombo = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castRapidPunchCombo() ?? false;
  }, []);

  const handleCastSpeedBlitz = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castSpeedBlitz() ?? false;
  }, []);

  const handleToggleWindTornado = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleWindTornado() ?? false;
  }, []);

  const handleCastTimeStop = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castTimeStop() ?? false;
  }, []);

  const handleToggleMysticShield = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    if (!strangeShieldActiveRef.current) {
      const cd = strangeShieldCdRef.current;
      if (cd && performance.now() - cd.startMs < cd.durationMs) return false;
    }
    soundEngineRef.current?.unlock();
    const wasActive = strangeShieldActiveRef.current;
    const accepted = engineRef.current?.toggleMysticShield() ?? false;
    if (accepted && !wasActive) {
      soundEngineRef.current?.playStrangeShield(true);
    }
    return accepted;
  }, []);

  const handleCastMysticClones = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castMysticClones() ?? false;
  }, []);

  const handleCastEldritchDiscs = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castEldritchDisc() ?? false;
  }, []);

  const handleCastAstralExtraction = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castAstralExtraction() ?? false;
  }, []);

  const handleCastPurgatoryGrasp = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castPurgatoryGrasp() ?? false;
  }, []);

  const handleStartSupremeDrainHold = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.startSupremeDrainHold() ?? false;
  }, []);

  const handleStopSupremeDrainHold = useCallback(() => {
    engineRef.current?.stopSupremeDrainHold();
  }, []);

  const handleFireSupremeStackBolt = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.fireSupremeStackBolt() ?? false;
  }, []);

  const handleCastZombieBeam = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castZombieBeam() ?? false;
  }, []);

  const handleCastZombieStoneExplosion = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castZombieStoneExplosion() ?? false;
  }, []);

  const handleCastAgathaBolt = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castAgathaBolt() ?? false;
  }, []);

  const handleToggleAgathaDarkhold = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleAgathaDarkhold() ?? false;
  }, []);

  const handleCastAgathaTeleport = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castAgathaTeleport() ?? false;
  }, []);

  const handleCastAgathaDarkholdBlast = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castAgathaDarkholdBlast() ?? false;
  }, []);

  const handleCastAgathaAutoShield = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castAgathaAutoShield() ?? false;
  }, []);

  const handleActivateAgathaShield = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.activateAgathaShield() ?? false;
  }, []);

  const handleCastPhoenixDive = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    soundEngineRef.current?.unlock();
    if (phoenixDivePhaseRef.current === 'hovering') {
      engineRef.current?.triggerPhoenixDiveNow();
      return;
    }
    if (phoenixDivePhaseRef.current !== 'idle') return;
    const cd = phoenixDiveCdRef.current;
    if (cd && performance.now() - cd.startMs < cd.durationMs) return;
    engineRef.current?.castPhoenixFlightDive();
  }, []);

  const handleToggleIntangibility = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    if (!visionIntangibleActiveRef.current) {
      const cd = visionPhaseCdRef.current;
      if (cd && performance.now() - cd.startMs < cd.durationMs) return;
    }
    soundEngineRef.current?.unlock();
    const wasActive = visionIntangibleActiveRef.current;
    const accepted = engineRef.current?.toggleIntangibility() ?? false;
    if (accepted && !wasActive) {
      soundEngineRef.current?.playVisionPhase(true);
    }
  }, []);

  const handleCastMindStoneLaser = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castMindStoneLaser() ?? false;
  }, []);

  const handleCastMindStoneProjectile = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castMindStoneProjectile() ?? false;
  }, []);

  const handleCastHeadGrip = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castHeadGrip() ?? false;
  }, []);

  const handleToggleInvisibility = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleInvisibility() ?? false;
  }, []);

  const handleToggleForcefieldShield = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleForcefieldShield() ?? false;
  }, []);

  const handleTransferForcefieldShield = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.transferForcefieldShield() ?? false;
  }, []);

  const handleSelectForcefieldOption = useCallback(
    (option: 'protection' | 'suffocation') => {
      if (gamePhaseRef.current !== 'playing') return;
      soundEngineRef.current?.unlock();
      engineRef.current?.selectForcefieldOption(option);
    },
    [],
  );

  const handleCastForcefieldBarrier = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castForcefieldBarrier() ?? false;
  }, []);

  const handleCastVampireBolt = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castVampireBolt() ?? false;
  }, []);

  const handleCastPowerAbsorption = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castPowerAbsorption() ?? false;
  }, []);

  const handleCastBanditGun = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castStolenBanditGun() ?? false;
  }, []);

  const handleCastPrisonerPunch = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castStolenPrisonerPunch() ?? false;
  }, []);

  const handleCastVampireGroundStomp = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    if (vampireStompDivingRef.current) return;
    const cd = vampireStompCdRef.current;
    if (cd && performance.now() - cd.startMs < cd.durationMs) return;
    soundEngineRef.current?.unlock();
    engineRef.current?.castVampireGroundStomp();
  }, []);

  const handleCastCapShieldThrow = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castCapShieldThrow() ?? false;
  }, []);

  const handleToggleCapShieldDefense = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleCapShieldDefense() ?? false;
  }, []);

  const handleCastCapShieldCombo = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castCapShieldCombo() ?? false;
  }, []);

  const handleCastCapShieldCharge = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castCapShieldCharge() ?? false;
  }, []);

  const handleCastThorMjolnirCombo = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castThorMjolnirCombo() ?? false;
  }, []);

  const handleCastThorMjolnirThrow = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castThorMjolnirThrow() ?? false;
  }, []);

  const handleCastThorLightningSlam = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    if (thorSlamActiveRef.current) return false;
    const cd = thorSlamCdRef.current;
    if (cd && performance.now() - cd.startMs < cd.durationMs) return false;
    soundEngineRef.current?.unlock();
    return engineRef.current?.castThorLightningSlam() ?? false;
  }, []);

  useEffect(() => {
    if (
      !isPc ||
      selectedCharacterId !== 'thor' ||
      !flightActive ||
      teleportLocked ||
      spawnLocked
    ) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.code !== 'KeyE' ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (gamePhaseRef.current !== 'playing' || spawnLockedRef.current) return;
      handleCastThorLightningSlam();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPc, selectedCharacterId, flightActive, teleportLocked, spawnLocked, handleCastThorLightningSlam]);

  const handleCastThorLightningStormBeam = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castThorLightningStormBeam() ?? false;
  }, []);

  const handleToggleDamageAbsorption = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleDamageAbsorption() ?? false;
  }, []);

  const handleCastSonicBlast = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    soundEngineRef.current?.unlock();
    return engineRef.current?.castSonicBlast() ?? false;
  }, []);

  useEffect(() => {
    if (
      !isPc ||
      selectedCharacterId !== 'silver-surfer' ||
      silverEnergy < SILVER_SURFER_SONIC_UNLOCK ||
      teleportLocked ||
      spawnLocked
    ) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.code !== 'KeyE' ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (gamePhaseRef.current !== 'playing' || spawnLockedRef.current) return;
      handleCastSonicBlast();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPc, selectedCharacterId, silverEnergy, teleportLocked, spawnLocked, handleCastSonicBlast]);

  const handleCastCosmicBlast = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castCosmicBlast() ?? false;
  }, []);

  const handleCastDualCosmicBeam = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castDualCosmicBeam() ?? false;
  }, []);

  const handleCastLightningStrike = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    if (stormLightningActiveRef.current) return false;
    const cd = stormLightningCdRef.current;
    if (cd && performance.now() - cd.startMs < cd.durationMs) return false;
    soundEngineRef.current?.unlock();
    const accepted = engineRef.current?.castLightningStrike() ?? false;
    if (accepted) {
      soundEngineRef.current?.playLightningStrikeRise();
    }
    return accepted;
  }, []);

  useEffect(() => {
    if (
      !isPc ||
      selectedCharacterId !== 'storm' ||
      !flightActive ||
      teleportLocked ||
      spawnLocked
    ) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.code !== 'KeyE' ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (gamePhaseRef.current !== 'playing' || spawnLockedRef.current) return;
      handleCastLightningStrike();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPc, selectedCharacterId, flightActive, teleportLocked, spawnLocked, handleCastLightningStrike]);

  // PC keyboard shortcuts for secondary / contextual character abilities (Q, E, R, F)
  useEffect(() => {
    if (!isPc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (gamePhaseRef.current !== 'playing' || spawnLockedRef.current) return;

      const charId = selectedCharacterIdRef.current;
      if (e.code === 'KeyF') {
        if (charId === 'scarlet-witch' && flightActive) {
          handleScarletFlightCancel();
        }
        return;
      }

      if (e.code === 'KeyQ') {
        if (charId === 'hela' && !teleportLocked) {
          handleToggleCrown();
        }
        return;
      }

      if (e.code === 'KeyR') {
        if (charId === 'hela' && swordSummonActive && !teleportLocked) {
          handleCastSwordSlash();
        }
        return;
      }

      if (e.code === 'KeyE') {
        if (teleportLocked) return;
        if (charId === 'hela' && swordSummonActive) {
          handleThrowNecrosword();
        } else if (
          charId === 'phoenix-force' &&
          (flightActive || phoenixDivePhase !== 'idle')
        ) {
          handleCastPhoenixDive();
        } else if (charId === 'vampire' && (flightActive || vampireStompDiving)) {
          handleCastVampireGroundStomp();
        } else if (charId === 'vision' && flightActive && !visionHeadGripActive) {
          handleToggleIntangibility();
        } else if (
          charId === 'doctor-strange' &&
          selectedSkinsByCharRef.current['doctor-strange'] !== 'ancient-one' &&
          flightActive
        ) {
          handleToggleMysticShield();
        } else if (charId === 'emma-frost' && diamondActive) {
          handleCastDiamondProjectile();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    diamondActive,
    flightActive,
    handleCastDiamondProjectile,
    handleCastPhoenixDive,
    handleCastSwordSlash,
    handleCastVampireGroundStomp,
    handleScarletFlightCancel,
    handleThrowNecrosword,
    handleToggleCrown,
    handleToggleIntangibility,
    handleToggleMysticShield,
    isPc,
    phoenixDivePhase,
    swordSummonActive,
    teleportLocked,
    vampireStompDiving,
    visionHeadGripActive,
  ]);

  const handleToggleStormTornado = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleStormTornado() ?? false;
  }, []);

  const handleCastIceSpear = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.castIceSpear() ?? false;
  }, []);

  const handleToggleWindBlast = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return false;
    return engineRef.current?.toggleWindBlast() ?? false;
  }, []);

  const handleAbilitySound = useCallback((kind: AbilitySoundKind) => {
    soundEngineRef.current?.unlock();
    switch (kind) {
      case 'flight-on':
        soundEngineRef.current?.playAbilityToggle(true);
        break;
      case 'flight-off':
        soundEngineRef.current?.playAbilityToggle(false);
        break;
      case 'chaos-bolt':
        soundEngineRef.current?.playChaosBolt();
        break;
      case 'darkhold-open':
        soundEngineRef.current?.playDarkholdOpen();
        break;
      case 'darkhold-close':
        soundEngineRef.current?.playDarkholdClose();
        break;
      case 'teleport-start':
        soundEngineRef.current?.playTeleportStart();
        break;
      case 'telekinetic-explosion':
        soundEngineRef.current?.playTelekineticExplosion();
        break;
      case 'auto-shield':
        soundEngineRef.current?.playAutoShieldActivate();
        break;
      case 'chaos-implosion':
        soundEngineRef.current?.playChaosImplosionCast();
        break;
      case 'phoenix-fireball':
        soundEngineRef.current?.playPhoenixFireballCast();
        break;
      case 'pain-start':
        soundEngineRef.current?.playPainInflictionStart();
        break;
      case 'pain-cancel':
        soundEngineRef.current?.playAbilityToggle(false);
        break;
      case 'phoenix-flight-on':
        soundEngineRef.current?.playPhoenixFlightSpin(true);
        break;
      case 'phoenix-flight-off':
        soundEngineRef.current?.playPhoenixFlightSpin(false);
        break;
      case 'mind-control-link':
        soundEngineRef.current?.playMindControlLink();
        break;
      case 'mind-control-select':
        soundEngineRef.current?.playMindControlSelect();
        break;
      case 'mental-attack':
        soundEngineRef.current?.playMentalAttack();
        break;
      case 'diamond-on':
        soundEngineRef.current?.playDiamondForm(true);
        break;
      case 'diamond-off':
        soundEngineRef.current?.playDiamondForm(false);
        break;
      case 'telepathic-wave':
        soundEngineRef.current?.playTelepathicWave();
        break;
      case 'astral-on':
        soundEngineRef.current?.playAstralToggle(true);
        break;
      case 'astral-off':
        soundEngineRef.current?.playAstralToggle(false);
        break;
      case 'sword-summon':
        soundEngineRef.current?.playSwordSummon();
        break;
      case 'magneto-tornado':
        soundEngineRef.current?.playMagnetoTornado();
        break;
      case 'quicksilver-speed-on':
        soundEngineRef.current?.playQuicksilverSpeed(true);
        break;
      case 'quicksilver-speed-off':
        soundEngineRef.current?.playQuicksilverSpeed(false);
        break;
      case 'quicksilver-tornado-on':
        soundEngineRef.current?.playWindTornado(true);
        break;
      case 'quicksilver-tornado-off':
        soundEngineRef.current?.playWindTornado(false);
        break;
      case 'strange-shield-on':
        soundEngineRef.current?.playStrangeShield(true);
        break;
      case 'strange-shield-off':
        soundEngineRef.current?.playStrangeShield(false);
        break;
      case 'eldritch-discs':
        soundEngineRef.current?.playEldritchDiscCast();
        break;
      case 'astral-extraction':
        // Triggered cleanly via engine strike callback
        break;
      case 'purgatory-grasp':
        soundEngineRef.current?.playPurgatoryGrasp();
        break;
      case 'chaos-drain-start':
        soundEngineRef.current?.playChaosDrainStart();
        break;
      case 'chaos-drain-bolt':
        soundEngineRef.current?.playChaosDrainBolt();
        break;
      case 'zombie-beam':
        soundEngineRef.current?.playZombieBeam();
        break;
      case 'zombie-stone':
        soundEngineRef.current?.playZombieStoneCharge();
        scheduleTimer(() => {
          if (gamePhaseRef.current === 'playing') {
            soundEngineRef.current?.playZombieStoneExplode();
          }
        }, 1350);
        break;
      case 'agatha-bolt':
        soundEngineRef.current?.playAgathaBolt();
        break;
      case 'agatha-shield':
        soundEngineRef.current?.playAgathaShield(true);
        break;
      case 'vision-laser':
        soundEngineRef.current?.playVisionLaser();
        break;
      case 'vision-head-grip':
        soundEngineRef.current?.playVisionHeadGrip();
        break;
      case 'invisibility-on':
        soundEngineRef.current?.playInvisibilityToggle(true);
        break;
      case 'invisibility-off':
        soundEngineRef.current?.playInvisibilityToggle(false);
        break;
      case 'forcefield-shield-on':
        soundEngineRef.current?.playForcefieldShield(true);
        break;
      case 'forcefield-shield-off':
        soundEngineRef.current?.playForcefieldShield(false);
        break;
      case 'forcefield-transfer':
        soundEngineRef.current?.playForcefieldTransfer();
        break;
      case 'forcefield-protection':
        soundEngineRef.current?.playForcefieldProtection();
        break;
      case 'forcefield-suffocation':
        soundEngineRef.current?.playForcefieldSuffocation();
        break;
      case 'forcefield-barrier':
        soundEngineRef.current?.playForcefieldBarrierCast();
        break;
      case 'vampire-bolt':
        soundEngineRef.current?.playVampireBolt();
        break;
      case 'vampire-absorb-start':
        soundEngineRef.current?.playVampireAbsorbStart();
        break;
      case 'bandit-gun':
        soundEngineRef.current?.playPistolShot();
        break;
      case 'prisoner-punch':
        soundEngineRef.current?.playNpcStrike('punch');
        break;
      case 'cap-defense-on':
        soundEngineRef.current?.playCapShieldDefense(true);
        break;
      case 'cap-defense-off':
        soundEngineRef.current?.playCapShieldDefense(false);
        break;
      case 'cosmic-flight-on':
        soundEngineRef.current?.playCosmicFlight(true);
        break;
      case 'cosmic-flight-off':
        soundEngineRef.current?.playCosmicFlight(false);
        break;
      case 'silver-absorb-on':
        soundEngineRef.current?.playDamageAbsorption(true);
        break;
      case 'silver-absorb-off':
        soundEngineRef.current?.playDamageAbsorption(false);
        break;
      case 'storm-flight-on':
        soundEngineRef.current?.playStormFlight(true);
        break;
      case 'storm-flight-off':
        soundEngineRef.current?.playStormFlight(false);
        break;
      case 'storm-tornado-on':
        soundEngineRef.current?.playStormTornado(true);
        break;
      case 'storm-tornado-off':
        soundEngineRef.current?.playStormTornado(false);
        break;
      case 'ice-spear-create':
        soundEngineRef.current?.playIceSpearCreate();
        break;
      case 'wind-blast-on':
        soundEngineRef.current?.playWindBlast(true);
        break;
      case 'wind-blast-off':
        soundEngineRef.current?.playWindBlast(false);
        break;
      case 'green-explosion':
      case 'spinning-leap':
      case 'ground-sword':
        // Triggered cleanly via engine phase callbacks
        break;
    }
  }, [scheduleTimer]);

  const handleGraphicsChange = useCallback((next: GraphicsSettings) => {
    setGraphicsSettings(next);
    saveGraphicsSettings(next, isPcRef.current);
    soundEngineRef.current?.setMasterVolume(next.masterVolume);
    engineRef.current?.applyGraphicsSettings(next);
    if (!next.screenEffects) {
      screenFxRef.current?.reset();
      if (canvasMountRef.current && canvasBlurAppliedRef.current) {
        canvasMountRef.current.style.filter = 'none';
        canvasBlurAppliedRef.current = false;
      }
    }
  }, []);

  const handleUiSound = useCallback(() => {
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.playAbilityActivate();
  }, []);

  const handleCoinArrived = useCallback(() => {
    soundEngineRef.current?.playCoinCollect();
  }, []);

  // Selector handlers
  const handleSelectCharacterCard = useCallback((id: string) => {
    if (gamePhaseRef.current !== 'selecting') return;
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.playAbilityActivate();
    soundEngineRef.current?.playSelectionVoice(
      id,
      selectedSkinsByCharRef.current[id] ?? null,
    );
    setSelectedCharacterId(id);
    void validateServerState({ selectedCharacterId: id });
  }, []);

  const handleSelectSkin = useCallback((characterId: string, skinId: string) => {
    if (gamePhaseRef.current !== 'selecting') return;
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.playAbilityActivate();
    soundEngineRef.current?.playSelectionVoice(characterId, skinId);
    setSelectedSkinsByChar((prev) => {
      const next = { ...prev, [characterId]: skinId };
      saveSelectedSkins(next);
      void validateServerState({ selectedSkinsByChar: next });
      return next;
    });
  }, []);

  const handlePurchaseSkin = useCallback(
    (characterId: string, skinId: string, price: number) => {
      if (gamePhaseRef.current !== 'selecting') return;
      soundEngineRef.current?.unlock();

      if (unlockedSkinsRef.current.includes(skinId)) {
        handleSelectSkin(characterId, skinId);
        return;
      }

      if (coinsRef.current < price) {
        soundEngineRef.current?.playPurchaseDenied();
        return;
      }

      soundEngineRef.current?.playSkinPurchase();
      const nextCoins = coinsRef.current - price;
      coinsRef.current = nextCoins;
      setCoins(nextCoins);
      saveCoinBalance(nextCoins);

      const nextUnlocked = [...unlockedSkinsRef.current, skinId];
      unlockedSkinsRef.current = nextUnlocked;
      setUnlockedSkins(nextUnlocked);
      saveUnlockedSkins(nextUnlocked);

      setSelectedSkinsByChar((prev) => {
        const next = { ...prev, [characterId]: skinId };
        saveSelectedSkins(next);
        void validateServerState({
          purchaseSkinId: skinId,
          coins: nextCoins,
          unlockedSkins: nextUnlocked,
          selectedSkinsByChar: next,
        }).then((validated) => {
          if (!validated) return;
          coinsRef.current = validated.coins;
          setCoins(validated.coins);
          saveCoinBalance(validated.coins);
          unlockedSkinsRef.current = validated.unlockedSkins;
          setUnlockedSkins(validated.unlockedSkins);
          saveUnlockedSkins(validated.unlockedSkins);
        });
        return next;
      });
    },
    [handleSelectSkin],
  );

  const navigateWithTransition = useCallback(
    (target: MenuScreen) => {
      if (gamePhaseRef.current === 'transitioning') return;
      soundEngineRef.current?.unlock();
      soundEngineRef.current?.stopSelectionVoice();
      soundEngineRef.current?.setFlightAmbience(false);
      soundEngineRef.current?.setPainChannelAmbience(false);
      soundEngineRef.current?.playAbilityActivate();

      clearAllTimers();
      resetAllStagePointers();
      screenFxRef.current?.reset();
      playerCombatHudRef.current?.reset();
      if (canvasMountRef.current && canvasBlurAppliedRef.current) {
        canvasMountRef.current.style.filter = 'none';
        canvasBlurAppliedRef.current = false;
      }
      setDeathPanelVisible(false);
      setHealEvent(null);
      resetAbilityStates(true);
      setGamePhase('transitioning');
      setTransitionPhase('covering');

      scheduleTimer(() => {
        sprintEnabledRef.current = false;
        setSprintEnabled(false);
        setTestBotEnabled(false);
        setTestAiEnabled(false);
        setEngineActive(false);
        setActiveMenuScreen(target);

        scheduleTimer(() => {
          setTransitionPhase('revealing');

          scheduleTimer(() => {
            setTransitionPhase('idle');
            setGamePhase(target);
          }, 300);
        }, 75);
      }, 265);
    },
    [clearAllTimers, resetAbilityStates, resetAllStagePointers, scheduleTimer, setGamePhase],
  );

  const handleOpenCharacterSelectorFromMenu = useCallback(() => {
    if (gamePhaseRef.current !== 'menu') return;
    navigateWithTransition('selecting');
  }, [navigateWithTransition]);

  const handleOpenMapsFromMenu = useCallback(() => {
    if (gamePhaseRef.current !== 'menu') return;
    navigateWithTransition('maps');
  }, [navigateWithTransition]);

  const handleBackToMainMenu = useCallback(() => {
    if (
      gamePhaseRef.current !== 'maps' &&
      gamePhaseRef.current !== 'selecting' &&
      gamePhaseRef.current !== 'playing'
    ) {
      return;
    }
    navigateWithTransition('menu');
  }, [navigateWithTransition]);

  const handleChangeCharacterFromTestMap = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    navigateWithTransition('selecting');
  }, [navigateWithTransition]);

  const handleSelectMap = useCallback((mapId: MapId) => {
    if (gamePhaseRef.current !== 'maps') return;
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.playAbilityActivate();
    selectedMapIdRef.current = mapId;
    setSelectedMapId(mapId);
    saveSelectedMapId(mapId);
  }, []);

  const handleConfirmSelectCharacter = useCallback(() => {
    if (gamePhaseRef.current !== 'selecting') return;
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.stopSelectionVoice();
    soundEngineRef.current?.playSelect();

    clearAllTimers();
    setGamePhase('transitioning');
    setTransitionPhase('covering');

    scheduleTimer(() => {
      sprintEnabledRef.current = false;
      setSprintEnabled(false);
      setHealEvent(null);
      setTestBotEnabled(false);
      setTestAiEnabled(false);
      resetAbilityStates(true);
      setDeathPanelVisible(false);
      setRespawnKey((k) => k + 1);
      setEngineActive(true);

      scheduleTimer(() => {
        setTransitionPhase('revealing');
        engineRef.current?.beginSpawnMaterialization();

        scheduleTimer(() => {
          setTransitionPhase('idle');
          setGamePhase('playing');
        }, 300);
      }, 75);
    }, 265);
  }, [clearAllTimers, resetAbilityStates, scheduleTimer, setGamePhase]);

  const handleInstantTestRespawn = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.setFlightAmbience(false);
    soundEngineRef.current?.setPainChannelAmbience(false);
    soundEngineRef.current?.playRespawn();

    clearAllTimers();
    resetAllStagePointers();
    playerCombatHudRef.current?.reset();
    setDeathPanelVisible(false);
    setHealEvent(null);
    resetAbilityStates(true);

    sprintEnabledRef.current = false;
    setSprintEnabled(false);
    engineRef.current?.setSprintEnabled(false);
    engineRef.current?.respawn(false);
    setRespawnKey((k) => k + 1);
  }, [clearAllTimers, resetAbilityStates, resetAllStagePointers]);

  const handleSpawnTestNpc = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.playAbilityActivate();
    engineRef.current?.spawnTestNpcInFront();
  }, []);

  const handleToggleTestBot = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    soundEngineRef.current?.unlock();
    const next = !testBotEnabledRef.current;
    testBotEnabledRef.current = next;
    setTestBotEnabled(next);
    engineRef.current?.setTestBotEnabled(next);
    soundEngineRef.current?.playAbilityToggle(next);
  }, []);

  const handleToggleTestAi = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    soundEngineRef.current?.unlock();
    const next = !testAiEnabledRef.current;
    testAiEnabledRef.current = next;
    setTestAiEnabled(next);
    engineRef.current?.setTestAiEnabled(next);
    soundEngineRef.current?.playAbilityToggle(next);
  }, []);

  // Death & Respawn handlers
  const handleTriggerDeath = useCallback(() => {
    if (gamePhaseRef.current !== 'playing') return;
    if (selectedMapIdRef.current === 'test') {
      handleInstantTestRespawn();
      return;
    }
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.setFlightAmbience(false);
    soundEngineRef.current?.setPainChannelAmbience(false);
    soundEngineRef.current?.playDeath();

    clearAllTimers();
    resetAllStagePointers();
    sprintEnabledRef.current = false;
    setSprintEnabled(false);
    setHealEvent(null);
    resetAbilityStates(false);
    engineRef.current?.setSprintEnabled(false);
    engineRef.current?.triggerDeath();
    playerCombatHudRef.current?.reset();

    setGamePhase('dead');
    setDeathPanelVisible(false);

    scheduleTimer(() => {
      if (gamePhaseRef.current === 'dead') {
        setDeathPanelVisible(true);
      }
    }, 1000);
  }, [
    clearAllTimers,
    handleInstantTestRespawn,
    resetAbilityStates,
    resetAllStagePointers,
    scheduleTimer,
    setGamePhase,
  ]);
  handleTriggerDeathRef.current = handleTriggerDeath;

  const handleRespawn = useCallback(() => {
    if (gamePhaseRef.current !== 'dead') return;
    soundEngineRef.current?.unlock();
    soundEngineRef.current?.setFlightAmbience(false);
    soundEngineRef.current?.setPainChannelAmbience(false);
    soundEngineRef.current?.playRespawn();

    clearAllTimers();
    resetAllStagePointers();
    playerCombatHudRef.current?.reset();
    setDeathPanelVisible(false);
    setHealEvent(null);
    resetAbilityStates(true);
    setGamePhase('respawning');

    sprintEnabledRef.current = false;
    setSprintEnabled(false);
    engineRef.current?.setSprintEnabled(false);
    engineRef.current?.respawn();
    setRespawnKey((k) => k + 1);
    void validateServerState({
      stamina: 100,
      maxStamina: 100,
      staminaRegenDelayRemaining: 0,
      sprintEnabled: false,
      flightEnabled: false,
      invisibilityActive: false,
      forcefieldActive: false,
      killStreak: 0,
    });

    scheduleTimer(() => {
      setGamePhase('playing');
    }, 60);
  }, [clearAllTimers, resetAbilityStates, resetAllStagePointers, scheduleTimer, setGamePhase]);

  const handleChangeCharacterFromDeath = useCallback(() => {
    if (gamePhaseRef.current !== 'dead') return;
    navigateWithTransition('selecting');
  }, [navigateWithTransition]);

  const selectedCharacter = getCharacterById(selectedCharacterId);
  const selectedSkinId = selectedSkinsByChar[selectedCharacter.id] ?? null;
  const resolvedCharacter = useMemo(
    () => resolveCharacterWithSkin(selectedCharacter, selectedSkinId),
    [selectedCharacter, selectedSkinId],
  );
  activeVoiceGenderRef.current = resolvedCharacter.gender;
  const isPhoenixCharacter = selectedCharacter.id === 'phoenix-force';
  const isEmmaCharacter = selectedCharacter.id === 'emma-frost';
  const isHelaCharacter = selectedCharacter.id === 'hela';

  const activePhoenixDiveDef =
    selectedSkinId === WHITE_PHOENIX_SKIN_ID
      ? WHITE_PHOENIX_DIVE_ABILITY
      : selectedSkinId === DARK_PHOENIX_SKIN_ID
        ? DARK_PHOENIX_DIVE_ABILITY
        : PHOENIX_DIVE_ABILITY;
  const activeHelaCrownDef =
    selectedSkinId === WHITE_HELA_SKIN_ID ? WHITE_HELA_CROWN_FORM : HELA_CROWN_FORM;
  const activeHelaSlashDef =
    selectedSkinId === WHITE_HELA_SKIN_ID ? WHITE_HELA_SWORD_SLASH : HELA_SWORD_SLASH;
  const activeHelaThrowDef =
    selectedSkinId === WHITE_HELA_SKIN_ID ? WHITE_HELA_THROW_SWORD : HELA_THROW_SWORD;

  const lockedAbilityIds = useMemo<ReadonlyArray<AbilityId>>(() => {
    if (isEmmaCharacter) {
      if (mindControlPhase === 'choosing' || mindControlPhase === 'mental-damage') {
        return ['mental-attack', 'diamond-form', 'telepathic-wave'];
      }
      if (diamondActive) {
        return ['astral-projection', 'mind-control', 'mental-attack', 'telepathic-wave'];
      }
      if (telepathicWaveActive) {
        return ['astral-projection', 'mind-control', 'mental-attack', 'diamond-form'];
      }
      if (astralActive) {
        return ['mind-control', 'diamond-form', 'telepathic-wave'];
      }
    } else if (selectedCharacter.id === 'magneto') {
      if (magnetoMeteorActive) {
        return ['metal-projectile', 'metal-tornado', 'magneto-flight'];
      }
      if (flightActive) {
        return ['metal-projectile', 'metal-tornado'];
      }
      if (magnetoTornadoActive) {
        return ['metal-projectile', 'magnetic-meteor', 'magneto-flight'];
      }
    } else if (selectedCharacter.id === 'quicksilver') {
      if (rapidPunchActive || speedBlitzActive) {
        return ['wind-tornado', 'time-stop'];
      }
      if (windTornadoActive) {
        return ['rapid-punch-combo', 'speed-blitz', 'time-stop'];
      }
    } else if (selectedCharacter.id === 'vision') {
      if (visionLaserActive) {
        return ['mind-stone-projectile', 'head-grip'];
      }
      if (visionHeadGripActive) {
        return ['mind-stone-laser', 'mind-stone-projectile'];
      }
    } else if (selectedCharacter.id === 'scarlet-witch') {
      if (supremeDrainActive) {
        return ['chaos-bolt', 'chaos-implosion'];
      }
      if (zombieStoneActive) {
        return ['chaos-bolt', 'zombie-beam'];
      }
      if (zombieBeamActive) {
        return ['chaos-bolt', 'zombie-stone-explosion'];
      }
    } else if (selectedCharacter.id === 'agatha-harkness') {
      if (agathaShieldActive) {
        return ['agatha-bolt', 'agatha-darkhold', 'agatha-flight'];
      }
    } else if (selectedCharacter.id === 'invisible-woman') {
      if (forcefieldTransferPhase !== 'idle') {
        return [
          'invisible-flight',
          'invisibility',
          'forcefield-shield',
          'forcefield-barrier',
        ];
      }
    } else if (selectedCharacter.id === 'vampire') {
      if (vampireAbsorbing) {
        return ['vampire-flight', 'vampire-bolt', 'stolen-ability'];
      }
    } else if (selectedCharacter.id === 'captain-america') {
      if (capShieldAway) {
        return ['shield-throw', 'shield-defense', 'shield-combo', 'shield-charge'];
      }
      if (capShieldDefenseActive) {
        return ['shield-throw', 'shield-combo', 'shield-charge'];
      }
      if (capShieldChargeActive) {
        return ['shield-throw', 'shield-defense', 'shield-combo'];
      }
    } else if (selectedCharacter.id === 'thor') {
      if (thorSlamActive || thorStormBeamPhase !== 'idle') {
        return [
          'mjolnir-combo',
          'mjolnir-throw',
          'thor-flight',
          'lightning-storm-beam',
        ];
      }
      if (thorMjolnirAway) {
        return ['mjolnir-combo', 'mjolnir-throw'];
      }
    } else if (selectedCharacter.id === 'silver-surfer') {
      if (dualCosmicBeamActive) {
        return ['damage-absorption', 'cosmic-blast'];
      }
    } else if (selectedCharacter.id === 'storm') {
      if (stormLightningActive || stormIceSpearActive) {
        return [
          'storm-flight',
          'storm-tornado',
          'ice-spear',
          'wind-blast',
        ];
      }
    }
    return EMPTY_LOCKED_ABILITIES;
  }, [
    agathaShieldActive,
    astralActive,
    capShieldAway,
    capShieldChargeActive,
    capShieldDefenseActive,
    diamondActive,
    dualCosmicBeamActive,
    flightActive,
    forcefieldTransferPhase,
    isEmmaCharacter,
    magnetoMeteorActive,
    magnetoTornadoActive,
    mindControlPhase,
    rapidPunchActive,
    selectedCharacter.id,
    speedBlitzActive,
    stormIceSpearActive,
    stormLightningActive,
    supremeDrainActive,
    telepathicWaveActive,
    thorMjolnirAway,
    thorSlamActive,
    thorStormBeamPhase,
    vampireAbsorbing,
    visionHeadGripActive,
    visionLaserActive,
    windTornadoActive,
    zombieBeamActive,
    zombieStoneActive,
  ]);

  const showMenuOverlay =
    !needsFullscreenStart &&
    !engineActive &&
    (gamePhase === activeMenuScreen || gamePhase === 'transitioning');

  const showMainMenu = showMenuOverlay && activeMenuScreen === 'menu';
  const showMapSelector = showMenuOverlay && activeMenuScreen === 'maps';
  const showSelector = showMenuOverlay && activeMenuScreen === 'selecting';

  const showGameplayHud =
    !needsFullscreenStart && engineActive && gamePhase === 'playing';

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      <div
        ref={appRootRef}
        className="overflow-hidden select-none"
        onWheel={handleWheelZoom}
        style={
          (forcedLandscape
            ? {
                position: 'fixed',
                top: '50%',
                left: '50%',
                width: '100dvh',
                height: '100dvw',
                transform: 'translate(-50%, -50%) rotate(90deg)',
                transformOrigin: 'center center',
                touchAction: 'none',
                '--stage-safe-top': 'env(safe-area-inset-right, 0px)',
                '--stage-safe-right': 'env(safe-area-inset-bottom, 0px)',
                '--stage-safe-bottom': 'env(safe-area-inset-left, 0px)',
                '--stage-safe-left': 'env(safe-area-inset-top, 0px)',
              }
            : {
                position: 'relative',
                width: '100%',
                height: '100%',
                touchAction: 'none',
                '--stage-safe-top': 'min(env(safe-area-inset-top, 0px), 12px)',
                '--stage-safe-right': 'env(safe-area-inset-right, 0px)',
                '--stage-safe-bottom': 'env(safe-area-inset-bottom, 0px)',
                '--stage-safe-left': 'env(safe-area-inset-left, 0px)',
                ...(isPc
                  ? {
                      '--pc-edge-r': 'max(28px, calc(var(--stage-safe-right, 0px) + 22px))',
                      '--pc-edge-b': 'max(28px, calc(var(--stage-safe-bottom, 0px) + 22px))',
                      '--pc-sprint': 'clamp(78px, 5.4vw, 102px)',
                      '--pc-aux': 'clamp(66px, 4.6vw, 86px)',
                      '--pc-slot': 'clamp(82px, 5.6vw, 104px)',
                      '--pc-slot-5': 'clamp(72px, 4.9vw, 92px)',
                      '--pc-sub': 'clamp(72px, 4.9vw, 90px)',
                      '--pc-gap': 'clamp(12px, 0.9vw, 16px)',
                      '--pc-sub-gap': 'clamp(10px, 0.8vw, 14px)',
                      '--pc-row-gap': 'clamp(16px, 1.3vw, 22px)',
                    }
                  : {}),
              }) as unknown as CSSProperties
        }
      >
        {/* Dedicated WebGL Gameplay Canvas Container */}
        <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

        {/* Synchronized Cinematic Screen FX Layer (vignette, glow, energy pulse, subtle flash) */}
        {!needsFullscreenStart && engineActive && (
          <ScreenFxOverlay ref={screenFxRef} />
        )}

        {/* Initial Fullscreen Prompt */}
        {needsFullscreenStart ? (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.36)' }}
          >
            <button
              type="button"
              onClick={handleEnterLandscapeFullscreen}
              aria-label="Tela cheia"
              className="flex items-center gap-3 rounded-2xl px-6 py-3.5 text-sm font-semibold text-white active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap"
              style={{
                minHeight: '48px',
                backgroundColor: 'rgba(15, 23, 42, 0.82)',
                border: '1.5px solid rgba(255, 255, 255, 0.45)',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.28)',
                transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="2"
                  y="6"
                  width="20"
                  height="12"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M7 10H9M7 10V12M17 14H15M17 14V12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Tela cheia</span>
            </button>
          </div>
        ) : (
          <>
            {/* Main Menu Screen */}
            {showMainMenu && (
              <MainMenu
                selectedMapId={selectedMapId}
                onPlay={handleOpenCharacterSelectorFromMenu}
                onOpenMaps={handleOpenMapsFromMenu}
              />
            )}

            {/* Map Selection Screen */}
            {showMapSelector && (
              <MapSelector
                selectedMapId={selectedMapId}
                coins={coins}
                onSelectMap={handleSelectMap}
                onBack={handleBackToMainMenu}
              />
            )}

            {/* Character Selection Screen */}
            {showSelector && (
              <CharacterSelector
                characters={CHARACTER_REGISTRY}
                selectedId={selectedCharacterId}
                selectedSkinId={selectedSkinId}
                unlockedSkins={unlockedSkins}
                coins={coins}
                forcedLandscape={forcedLandscape}
                onSelectCharacter={handleSelectCharacterCard}
                onSelectSkin={handleSelectSkin}
                onPurchaseSkin={handlePurchaseSkin}
                onConfirmSelect={handleConfirmSelectCharacter}
                onBack={handleBackToMainMenu}
              />
            )}

            {/* Active Gameplay HUD & Controls */}
            {showGameplayHud && (
              <>
                <CombatOverlayHud ref={combatHudRef} />
                <PlayerCombatHud ref={playerCombatHudRef} />

                <PlayerProfileHud
                  ref={profileHudRef}
                  character={selectedCharacter}
                  skinId={selectedSkinId}
                  hp={playerHealth.hp}
                  maxHp={playerHealth.maxHp}
                  healEvent={healEvent}
                />

                {/* Top Coin Counter + Animated Flying Coin Collection Layer */}
                <CoinHud
                  ref={coinHudRef}
                  coins={coins}
                  onCoinArrived={handleCoinArrived}
                />

                {/* Ability Feedback Banner (non-blocking cartoon toast) */}
                {abilityFeedback && (
                  <div
                    role="status"
                    className={`pointer-events-none fixed left-1/2 z-30 -translate-x-1/2 rounded-[7px] font-cartoon font-bold italic uppercase tracking-wide text-white animate-cartoon-pop-in ${
                      isPc ? 'px-5 py-2 text-[16px]' : 'px-3 py-1 text-[11px]'
                    }`}
                    style={{
                      top: isPc
                        ? 'calc(max(20px, var(--stage-safe-top, 0px)) + 84px)'
                        : 'calc(max(10px, var(--stage-safe-top, 0px)) + 42px)',
                      backgroundColor: '#181A38',
                      border: '2.5px solid #FFD147',
                      boxShadow: '2px 3px 0 rgba(8, 10, 18, 0.88)',
                      textShadow: '0 1px 0 #0B0D18',
                    }}
                  >
                    {abilityFeedback}
                  </div>
                )}

                {/* Left Side: Invisible Virtual Joystick */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1/2 z-10"
                  style={{ touchAction: 'none', cursor: isPc ? 'crosshair' : undefined }}
                  onPointerDown={(e) => handleStagePointerDown('left', e)}
                  onPointerMove={handleStagePointerMove}
                  onPointerUp={handleStagePointerEnd}
                  onPointerCancel={handleStagePointerEnd}
                  onContextMenu={(e) => e.preventDefault()}
                />

                {/* Right Side: Look Drag + 2-Finger Pinch Zone */}
                <div
                  className="absolute right-0 top-0 bottom-0 w-1/2 z-10"
                  style={{ touchAction: 'none', cursor: isPc ? 'crosshair' : undefined }}
                  onPointerDown={(e) => handleStagePointerDown('right', e)}
                  onPointerMove={handleStagePointerMove}
                  onPointerUp={handleStagePointerEnd}
                  onPointerCancel={handleStagePointerEnd}
                  onContextMenu={(e) => e.preventDefault()}
                />

                {/* Virtual Joystick Visual (Mobile Only) */}
                {!isPc && (
                  <div
                    ref={joyRingRef}
                    aria-hidden="true"
                    className="pointer-events-none fixed left-0 top-0 z-20 flex items-center justify-center rounded-full transition-opacity duration-100"
                    style={{
                      width: `${OUTER_RADIUS * 2}px`,
                      height: `${OUTER_RADIUS * 2}px`,
                      opacity: 0,
                      backgroundColor: 'rgba(53, 54, 100, 0.72)',
                      backgroundImage: PURPLE_DOT_PATTERN,
                      backgroundSize: '10px 10px',
                      backgroundPosition: '0 0, 5px 5px',
                      border: '2.5px solid #0B0D18',
                      boxShadow:
                        '2px 3px 0 rgba(8, 10, 18, 0.72), inset 0 0 0 1.5px rgba(155, 160, 230, 0.24)',
                      willChange: 'transform, opacity',
                    }}
                  >
                    <div
                      ref={joyKnobRef}
                      className="rounded-full"
                      style={{
                        width: `${KNOB_RADIUS * 2}px`,
                        height: `${KNOB_RADIUS * 2}px`,
                        backgroundColor: '#484A88',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0, 4px 4px',
                        border: '2px solid #0B0D18',
                        boxShadow:
                          '0 2px 0 rgba(8, 10, 18, 0.78), inset 0 0 0 1.5px rgba(195, 200, 255, 0.34)',
                        willChange: 'transform',
                      }}
                    />
                  </div>
                )}

                {/* Phoenix Force Only: Fiery Wings Toggle Button directly above Sprint Button */}
                {isPhoenixCharacter && (
                  <button
                    type="button"
                    aria-label="Fiery Wings"
                    aria-pressed={wingsEnabled}
                    disabled={painChanneling}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isPc) e.currentTarget.blur();
                      toggleWings();
                    }}
                    onPointerMove={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onPointerCancel={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleWings();
                      }
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    className="fixed z-20 flex items-center justify-center rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                    style={{
                      width: isPc ? 'var(--pc-aux, 76px)' : 'clamp(44px, 7.0vw, 54px)',
                      height: isPc ? 'var(--pc-aux, 76px)' : 'clamp(44px, 7.0vw, 54px)',
                      right: isPc
                        ? 'calc(var(--pc-edge-r, 28px) + (var(--pc-sprint, 90px) - var(--pc-aux, 76px)) / 2)'
                        : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + (clamp(54px, 8.4vw, 66px) - clamp(44px, 7.0vw, 54px)) / 2)',
                      bottom: isPc
                        ? 'calc(var(--pc-edge-b, 28px) + var(--pc-sprint, 90px) + var(--pc-row-gap, 18px))'
                        : 'calc(max(18px, calc(var(--stage-safe-bottom, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(50px, 7.8vw, 60px) + 20px)',
                      backgroundColor: wingsEnabled ? '#1C1D3A' : '#353664',
                      backgroundImage: PURPLE_DOT_PATTERN,
                      backgroundSize: '11px 11px',
                      backgroundPosition: '0 0, 5.5px 5.5px',
                      border: wingsEnabled
                        ? '2.5px solid #FFA726'
                        : '2.5px solid #0B0D18',
                      boxShadow: wingsEnabled
                        ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(255, 167, 38, 0.45)'
                        : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(155, 160, 230, 0.22)',
                      opacity: painChanneling ? 0.5 : 1,
                      transform: wingsEnabled
                        ? 'rotate(-1.2deg) translateY(1px) scale(0.96)'
                        : 'rotate(-1.2deg)',
                      transition:
                        'transform 100ms cubic-bezier(0.16, 1, 0.3, 1), background-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease',
                      touchAction: 'none',
                    }}
                  >
                    <svg
                      width={isPc ? '36' : '24'}
                      height={isPc ? '36' : '24'}
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 16C9.2 16 5.2 12.6 3.3 7.4C6.6 8.2 9.4 9.8 11.4 12.2L12 7L12.6 12.2C14.6 9.8 17.4 8.2 20.7 7.4C18.8 12.6 14.8 16 12 16Z"
                        fill={wingsEnabled ? '#FFB347' : '#FFFFFF'}
                        stroke="#0B0D18"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M7.2 17.5C9.2 18.6 10.7 19.2 12 20.6C13.3 19.2 14.8 18.6 16.8 17.5"
                        stroke={wingsEnabled ? '#FFD54F' : 'rgba(225, 228, 246, 0.78)'}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}

                {/* Hela Only: 5th Ability — Crown Form directly above Sprint Button */}
                {isHelaCharacter && (
                  <div
                    className="fixed z-20"
                    style={{
                      right: isPc
                        ? 'calc(var(--pc-edge-r, 28px) + (var(--pc-sprint, 90px) - var(--pc-aux, 76px)) / 2)'
                        : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + (clamp(54px, 8.4vw, 66px) - clamp(44px, 7.0vw, 54px)) / 2)',
                      bottom: isPc
                        ? 'calc(var(--pc-edge-b, 28px) + var(--pc-sprint, 90px) + var(--pc-row-gap, 18px))'
                        : 'calc(max(18px, calc(var(--stage-safe-bottom, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(50px, 7.8vw, 60px) + 20px)',
                      transform: crownActive
                        ? 'rotate(-1.2deg) translateY(1px) scale(0.96)'
                        : 'rotate(-1.2deg)',
                      transition: 'transform 100ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    {isPc && <KeybindBadge label="Q" />}
                    <button
                      type="button"
                      aria-label={activeHelaCrownDef.name}
                      aria-pressed={crownActive}
                      disabled={!crownActive && crownCd !== null}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleToggleCrown();
                      }}
                      onPointerMove={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onPointerCancel={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleCrown();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      style={{
                        width: isPc ? 'var(--pc-aux, 76px)' : 'clamp(44px, 7.0vw, 54px)',
                        height: isPc ? 'var(--pc-aux, 76px)' : 'clamp(44px, 7.0vw, 54px)',
                        backgroundColor: crownActive ? '#172822' : '#353664',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '11px 11px',
                        backgroundPosition: '0 0, 5.5px 5.5px',
                        border: crownActive
                          ? '2.5px solid #3CE66B'
                          : '2.5px solid #0B0D18',
                        boxShadow: crownActive
                          ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(60, 230, 107, 0.45)'
                          : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(155, 160, 230, 0.22)',
                        transition: 'background-color 120ms ease, box-shadow 120ms ease',
                        touchAction: 'none',
                        cursor: !crownActive && crownCd !== null ? 'default' : 'pointer',
                      }}
                    >
                      <AbilityIcon id="crown-form" size={isPc ? 30 : 20} />
                      <span
                        className="font-cartoon font-bold italic uppercase leading-none text-white"
                        style={{
                          fontSize: isPc ? '11.2px' : 'clamp(6.2px, 0.88vw, 7.4px)',
                          textShadow: '0 1px 0 #0B0D18',
                        }}
                      >
                        CROWN
                      </span>

                      {crownActive && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[4px] bg-[#0B0D18]/85"
                        >
                          <div
                            ref={crownBarRef}
                            className="h-full w-full bg-[#3CE66B]"
                            style={{
                              transformOrigin: 'left center',
                              transform: 'scaleX(1)',
                              willChange: 'transform',
                            }}
                          />
                        </div>
                      )}

                      {crownCd !== null && !crownActive && (
                        <div
                          ref={crownVeilRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-20"
                          style={{
                            backgroundColor: 'rgba(10, 11, 24, 0.74)',
                            borderTop: '1.5px solid rgba(60, 230, 107, 0.4)',
                            transformOrigin: 'bottom center',
                            transform: 'scaleY(1)',
                            willChange: 'transform',
                          }}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Scarlet Witch Only: Flight Cancellation + Red Shockwave Button beside Sprint */}
                {selectedCharacter.id === 'scarlet-witch' && flightActive && (
                  <div
                    className="fixed z-20"
                    style={{
                      right: isPc
                        ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                        : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                      bottom: isPc
                        ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                        : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                      transform: 'rotate(-1.5deg)',
                    }}
                  >
                    {isPc && <KeybindBadge label="F" />}
                    <button
                      type="button"
                      aria-label="Flight Cancellation"
                      disabled={flightCancelCd !== null}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleScarletFlightCancel();
                      }}
                      onPointerMove={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onPointerCancel={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleScarletFlightCancel();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="relative flex items-center justify-center overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                      style={{
                        width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(54px, 8.4vw, 66px)',
                        height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(54px, 8.4vw, 66px)',
                        backgroundColor: '#353664',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '11px 11px',
                        backgroundPosition: '0 0, 5.5px 5.5px',
                        border: '2.5px solid #0B0D18',
                        boxShadow:
                          '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(255, 118, 142, 0.32)',
                        transition:
                          'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), background-color 90ms ease',
                        touchAction: 'none',
                        cursor: flightCancelCd !== null ? 'default' : 'pointer',
                      }}
                    >
                      <svg
                        width={isPc ? '36' : '28'}
                        height={isPc ? '36' : '28'}
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        style={{ transform: 'rotate(180deg)' }}
                      >
                        <path
                          d="M6.5 11.5L12 6.5L17.5 11.5"
                          stroke="#FFFFFF"
                          strokeWidth="2.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M6.5 17.5L12 12.5L17.5 17.5"
                          stroke="rgba(225, 228, 246, 0.72)"
                          strokeWidth="2.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>

                      {flightCancelCd !== null && (
                        <div
                          ref={flightCancelVeilRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-20"
                          style={{
                            backgroundColor: 'rgba(10, 11, 24, 0.74)',
                            borderTop: '1.5px solid rgba(190, 195, 255, 0.32)',
                            transformOrigin: 'bottom center',
                            transform: 'scaleY(1)',
                            willChange: 'transform',
                          }}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Phoenix Force & Dark Phoenix & White Phoenix: Flight-Only Solar Dive Button beside Sprint */}
                {isPhoenixCharacter && (flightActive || phoenixDivePhase !== 'idle') && (
                  <div
                    className="animate-cartoon-pop-in fixed z-20"
                    style={{
                      right: isPc
                        ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                        : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                      bottom: isPc
                        ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                        : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                      transform:
                        phoenixDivePhase !== 'idle'
                          ? 'rotate(-1.5deg) translateY(1px) scale(0.96)'
                          : 'rotate(-1.5deg)',
                      transition: 'transform 90ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    {isPc && <KeybindBadge label="E" />}
                    <button
                      type="button"
                      aria-label={activePhoenixDiveDef.name}
                      aria-pressed={phoenixDivePhase !== 'idle'}
                      disabled={
                        phoenixDivePhase === 'ascending' ||
                        phoenixDivePhase === 'diving' ||
                        (phoenixDivePhase === 'idle' && phoenixDiveCd !== null)
                      }
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleCastPhoenixDive();
                      }}
                      onPointerMove={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onPointerCancel={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleCastPhoenixDive();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                      style={{
                        width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                        height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                        backgroundColor:
                          phoenixDivePhase === 'hovering'
                            ? '#4D1F0B'
                            : phoenixDivePhase !== 'idle'
                              ? '#33150A'
                              : '#2F1D3D',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '11px 11px',
                        backgroundPosition: '0 0, 5.5px 5.5px',
                        border:
                          phoenixDivePhase === 'hovering'
                            ? '2.5px solid #FFB347'
                            : '2.5px solid #0B0D18',
                        boxShadow:
                          phoenixDivePhase === 'hovering'
                            ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(255, 167, 38, 0.55)'
                            : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(255, 167, 38, 0.42)',
                        transition: 'background-color 110ms ease, box-shadow 110ms ease',
                        touchAction: 'none',
                        cursor:
                          phoenixDivePhase === 'ascending' ||
                          phoenixDivePhase === 'diving' ||
                          (phoenixDivePhase === 'idle' && phoenixDiveCd !== null)
                            ? 'default'
                            : 'pointer',
                      }}
                    >
                      <AbilityIcon id="phoenix-dive" size={isPc ? 32 : 20} />
                      <span
                        className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                        style={{
                          fontSize: isPc ? '11.5px' : 'clamp(6.2px, 0.88vw, 7.6px)',
                          textShadow: '0 1.5px 0 #0B0D18',
                        }}
                      >
                        {phoenixDivePhase === 'hovering' ? 'LAUNCH' : 'DIVE'}
                      </span>

                      {phoenixDivePhase === 'hovering' && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[4px] bg-[#0B0D18]/85"
                        >
                          <div
                            ref={phoenixHoverBarRef}
                            className="h-full w-full bg-[#FFA726]"
                            style={{
                              transformOrigin: 'left center',
                              transform: 'scaleX(1)',
                              willChange: 'transform',
                            }}
                          />
                        </div>
                      )}

                      {phoenixDivePhase === 'idle' && phoenixDiveCd !== null && (
                        <div
                          ref={phoenixDiveVeilRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-20"
                          style={{
                            backgroundColor: 'rgba(10, 11, 24, 0.76)',
                            borderTop: '1.5px solid rgba(255, 167, 38, 0.45)',
                            transformOrigin: 'bottom center',
                            transform: 'scaleY(1)',
                            willChange: 'transform',
                          }}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Vampire Only: Flight-Only Ground Stomp Button beside Sprint */}
                {selectedCharacter.id === 'vampire' &&
                  (flightActive || vampireStompDiving) && (
                    <div
                      className="animate-cartoon-pop-in fixed z-20"
                      style={{
                        right: isPc
                          ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                          : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                        bottom: isPc
                          ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                          : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                        transform: vampireStompDiving
                          ? 'rotate(-1.5deg) translateY(1px) scale(0.96)'
                          : 'rotate(-1.5deg)',
                        transition: 'transform 90ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    >
                      {isPc && <KeybindBadge label="E" />}
                      <button
                        type="button"
                        aria-label={VAMPIRE_GROUND_STOMP.name}
                        aria-pressed={vampireStompDiving}
                        disabled={vampireStompDiving || vampireStompCd !== null}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isPc) e.currentTarget.blur();
                          handleCastVampireGroundStomp();
                        }}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCastVampireGroundStomp();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                        style={{
                          width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          backgroundColor: vampireStompDiving ? '#3B280E' : '#25264A',
                          backgroundImage: PURPLE_DOT_PATTERN,
                          backgroundSize: '11px 11px',
                          backgroundPosition: '0 0, 5.5px 5.5px',
                          border: vampireStompDiving
                            ? '2.5px solid #FFD84D'
                            : '2.5px solid #0B0D18',
                          boxShadow: vampireStompDiving
                            ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(255, 216, 77, 0.5)'
                            : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(255, 216, 77, 0.36)',
                          transition: 'background-color 110ms ease, box-shadow 110ms ease',
                          touchAction: 'none',
                          cursor:
                            vampireStompDiving || vampireStompCd !== null
                              ? 'default'
                              : 'pointer',
                        }}
                      >
                        <AbilityIcon id="ground-stomp" size={isPc ? 32 : 20} />
                        <span
                          className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                          style={{
                            fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                            textShadow: '0 1.5px 0 #0B0D18',
                          }}
                        >
                          STOMP
                        </span>

                        {vampireStompCd !== null && !vampireStompDiving && (
                          <div
                            ref={vampireStompVeilRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20"
                            style={{
                              backgroundColor: 'rgba(10, 11, 24, 0.76)',
                              borderTop: '1.5px solid rgba(255, 216, 77, 0.45)',
                              transformOrigin: 'bottom center',
                              transform: 'scaleY(1)',
                              willChange: 'transform',
                            }}
                          />
                        )}
                      </button>
                    </div>
                  )}

                {/* Vision Only: Intangibility ("PHASE") Button beside Sprint while Flight is active */}
                {selectedCharacter.id === 'vision' && flightActive && (
                  <div
                    className="animate-cartoon-pop-in fixed z-20"
                    style={{
                      right: isPc
                        ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                        : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                      bottom: isPc
                        ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                        : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                      transform: visionIntangibleActive
                        ? 'rotate(-1.5deg) translateY(1px) scale(0.96)'
                        : 'rotate(-1.5deg)',
                      opacity: visionHeadGripActive ? 0.48 : 1,
                      transition:
                        'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms ease',
                    }}
                  >
                    {isPc && <KeybindBadge label="E" />}
                    <button
                      type="button"
                      aria-label={VISION_INTANGIBILITY.name}
                      aria-pressed={visionIntangibleActive}
                      disabled={
                        (!visionIntangibleActive && visionPhaseCd !== null) ||
                        visionHeadGripActive
                      }
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleToggleIntangibility();
                      }}
                      onPointerMove={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onPointerCancel={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleIntangibility();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                      style={{
                        width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                        height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                        backgroundColor: visionIntangibleActive
                          ? '#3B3014'
                          : '#25264A',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '11px 11px',
                        backgroundPosition: '0 0, 5.5px 5.5px',
                        border: visionIntangibleActive
                          ? '2.5px solid #FFE45C'
                          : '2.5px solid #0B0D18',
                        boxShadow: visionIntangibleActive
                          ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(255, 228, 92, 0.45)'
                          : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(255, 228, 92, 0.34)',
                        transition: 'background-color 110ms ease, box-shadow 110ms ease',
                        touchAction: 'none',
                        cursor:
                          (!visionIntangibleActive && visionPhaseCd !== null) ||
                          visionHeadGripActive
                            ? 'default'
                            : 'pointer',
                      }}
                    >
                      <AbilityIcon id="intangibility" size={isPc ? 32 : 20} />
                      <span
                        className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                        style={{
                          fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                          textShadow: '0 1.5px 0 #0B0D18',
                        }}
                      >
                        PHASE
                      </span>

                      {visionIntangibleActive && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[4px] bg-[#0B0D18]/85"
                        >
                          <div
                            ref={visionIntangibleBarRef}
                            className="h-full w-full bg-[#FFE45C]"
                            style={{
                              transformOrigin: 'left center',
                              transform: 'scaleX(1)',
                              willChange: 'transform',
                            }}
                          />
                        </div>
                      )}

                      {visionPhaseCd !== null && !visionIntangibleActive && (
                        <div
                          ref={visionPhaseVeilRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-20"
                          style={{
                            backgroundColor: 'rgba(10, 11, 24, 0.76)',
                            borderTop: '1.5px solid rgba(255, 228, 92, 0.45)',
                            transformOrigin: 'bottom center',
                            transform: 'scaleY(1)',
                            willChange: 'transform',
                          }}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Doctor Strange Only (Default Skin): Mystic Shield Button beside Sprint while Flight is active */}
                {selectedCharacter.id === 'doctor-strange' &&
                  selectedSkinId !== 'ancient-one' &&
                  flightActive && (
                    <div
                      className="animate-cartoon-pop-in fixed z-20"
                      style={{
                        right: isPc
                          ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                          : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                        bottom: isPc
                          ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                          : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                        transform: strangeShieldActive
                          ? 'rotate(-1.5deg) translateY(1px) scale(0.96)'
                          : 'rotate(-1.5deg)',
                        transition: 'transform 90ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    >
                      {isPc && <KeybindBadge label="E" />}
                      <button
                        type="button"
                        aria-label={MYSTIC_SHIELD_ABILITY.name}
                        aria-pressed={strangeShieldActive}
                        disabled={!strangeShieldActive && strangeShieldCd !== null}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isPc) e.currentTarget.blur();
                          handleToggleMysticShield();
                        }}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleToggleMysticShield();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                        style={{
                          width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          backgroundColor: strangeShieldActive
                            ? '#44260D'
                            : '#25264A',
                          backgroundImage: PURPLE_DOT_PATTERN,
                          backgroundSize: '11px 11px',
                          backgroundPosition: '0 0, 5.5px 5.5px',
                          border: strangeShieldActive
                            ? '2.5px solid #FFA438'
                            : '2.5px solid #0B0D18',
                          boxShadow: strangeShieldActive
                            ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(255, 164, 56, 0.45)'
                            : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(255, 164, 56, 0.34)',
                          transition: 'background-color 110ms ease, box-shadow 110ms ease',
                          touchAction: 'none',
                          cursor:
                            !strangeShieldActive && strangeShieldCd !== null
                              ? 'default'
                              : 'pointer',
                        }}
                      >
                        <AbilityIcon id="mystic-shield" size={isPc ? 32 : 20} />
                        <span
                          className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                          style={{
                            fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                            textShadow: '0 1.5px 0 #0B0D18',
                          }}
                        >
                          SHIELD
                        </span>

                        {strangeShieldActive && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[4px] bg-[#0B0D18]/85"
                          >
                            <div
                              ref={strangeShieldBarRef}
                              className="h-full w-full bg-[#FFA438]"
                              style={{
                                transformOrigin: 'left center',
                                transform: 'scaleX(1)',
                                willChange: 'transform',
                              }}
                            />
                          </div>
                        )}

                        {strangeShieldCd !== null && !strangeShieldActive && (
                          <div
                            ref={strangeShieldVeilRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20"
                            style={{
                              backgroundColor: 'rgba(10, 11, 24, 0.76)',
                              borderTop: '1.5px solid rgba(255, 164, 56, 0.45)',
                              transformOrigin: 'bottom center',
                              transform: 'scaleY(1)',
                              willChange: 'transform',
                            }}
                          />
                        )}
                      </button>
                    </div>
                  )}

                {/* Emma Frost Only: Diamond Shard Projectile Button beside Sprint while Diamond Form is active */}
                {isEmmaCharacter && diamondActive && (
                  <div
                    className="animate-cartoon-pop-in fixed z-20"
                    style={{
                      right: isPc
                        ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                        : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                      bottom: isPc
                        ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                        : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                      transform: 'rotate(-1.5deg)',
                    }}
                  >
                    {isPc && <KeybindBadge label="E" />}
                    <button
                      type="button"
                      aria-label={EMMA_DIAMOND_PROJECTILE.name}
                      disabled={diamondProjCd !== null}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleCastDiamondProjectile();
                      }}
                      onPointerMove={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onPointerCancel={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleCastDiamondProjectile();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                      style={{
                        width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                        height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                        backgroundColor: '#253352',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '11px 11px',
                        backgroundPosition: '0 0, 5.5px 5.5px',
                        border: '2.5px solid #D8F5FF',
                        boxShadow:
                          '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(216, 245, 255, 0.42)',
                        transition:
                          'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), background-color 90ms ease',
                        touchAction: 'none',
                        cursor: diamondProjCd !== null ? 'default' : 'pointer',
                      }}
                    >
                      <AbilityIcon id="diamond-projectile" size={isPc ? 32 : 20} />
                      <span
                        className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                        style={{
                          fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                          textShadow: '0 1.5px 0 #0B0D18',
                        }}
                      >
                        SHARD
                      </span>

                      {diamondProjCd !== null && (
                        <div
                          ref={diamondProjVeilRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-20"
                          style={{
                            backgroundColor: 'rgba(10, 11, 24, 0.74)',
                            borderTop: '1.5px solid rgba(216, 245, 255, 0.45)',
                            transformOrigin: 'bottom center',
                            transform: 'scaleY(1)',
                            willChange: 'transform',
                          }}
                        />
                      )}
                    </button>
                  </div>
                )}

                {/* Hela Only: Throw Sword & Close-Range Slash Buttons beside Sprint while Sword Summon is active */}
                {isHelaCharacter && swordSummonActive && (
                  <>
                    <div
                      className="animate-cartoon-pop-in fixed z-20"
                      style={{
                        right: isPc
                          ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px) + var(--pc-sub, 82px) + var(--pc-sub-gap, 12px))'
                          : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px) + clamp(50px, 7.8vw, 60px) + 10px)',
                        bottom: isPc
                          ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                          : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                        transform: 'rotate(1.4deg)',
                      }}
                    >
                      {isPc && <KeybindBadge label="R" />}
                      <button
                        type="button"
                        aria-label={activeHelaSlashDef.name}
                        disabled={swordSlashCd !== null}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isPc) e.currentTarget.blur();
                          handleCastSwordSlash();
                        }}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCastSwordSlash();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                        style={{
                          width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          backgroundColor: '#1E2D2C',
                          backgroundImage: PURPLE_DOT_PATTERN,
                          backgroundSize: '11px 11px',
                          backgroundPosition: '0 0, 5.5px 5.5px',
                          border: '2.5px solid #3CE66B',
                          boxShadow:
                            '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(60, 230, 107, 0.42)',
                          transition:
                            'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), background-color 90ms ease',
                          touchAction: 'none',
                          cursor: swordSlashCd !== null ? 'default' : 'pointer',
                        }}
                      >
                        <AbilityIcon id="sword-slash" size={isPc ? 32 : 20} />
                        <span
                          className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                          style={{
                            fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                            textShadow: '0 1.5px 0 #0B0D18',
                          }}
                        >
                          SLASH
                        </span>

                        {swordSlashCd !== null && (
                          <div
                            ref={swordSlashVeilRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20"
                            style={{
                              backgroundColor: 'rgba(10, 11, 24, 0.76)',
                              borderTop: '1.5px solid rgba(60, 230, 107, 0.42)',
                              transformOrigin: 'bottom center',
                              transform: 'scaleY(1)',
                              willChange: 'transform',
                            }}
                          />
                        )}
                      </button>
                    </div>

                    <div
                      className="animate-cartoon-pop-in fixed z-20"
                      style={{
                        right: isPc
                          ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                          : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                        bottom: isPc
                          ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                          : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                        transform: 'rotate(-1.5deg)',
                      }}
                    >
                      {isPc && <KeybindBadge label="E" />}
                      <button
                        type="button"
                        aria-label={activeHelaThrowDef.name}
                        disabled={!swordThrowReady || swordThrowCd !== null}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isPc) e.currentTarget.blur();
                          handleThrowNecrosword();
                        }}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleThrowNecrosword();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                        style={{
                          width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          backgroundColor: '#1E2D2C',
                          backgroundImage: PURPLE_DOT_PATTERN,
                          backgroundSize: '11px 11px',
                          backgroundPosition: '0 0, 5.5px 5.5px',
                          border: swordThrowReady
                            ? '2.5px solid #3CE66B'
                            : '2.5px solid #0B0D18',
                          boxShadow: swordThrowReady
                            ? '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(60, 230, 107, 0.42)'
                            : '2px 3px 0 rgba(8, 10, 18, 0.85)',
                          transition:
                            'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), background-color 90ms ease',
                          touchAction: 'none',
                          cursor:
                            !swordThrowReady || swordThrowCd !== null
                              ? 'default'
                              : 'pointer',
                        }}
                      >
                        <AbilityIcon id="throw-sword" size={isPc ? 32 : 20} />
                        <span
                          className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                          style={{
                            fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                            textShadow: '0 1.5px 0 #0B0D18',
                          }}
                        >
                          THROW
                        </span>

                        {(!swordThrowReady || swordThrowCd !== null) && (
                          <div
                            ref={swordThrowVeilRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20"
                            style={{
                              backgroundColor: 'rgba(10, 11, 24, 0.76)',
                              borderTop: '1.5px solid rgba(60, 230, 107, 0.42)',
                              transformOrigin: 'bottom center',
                              transform: 'scaleY(1)',
                              willChange: 'transform',
                            }}
                          />
                        )}
                      </button>
                    </div>
                  </>
                )}

                {/* Silver Surfer Only: Sonic Blast Action Button unlocked at 80 absorption energy */}
                {selectedCharacter.id === 'silver-surfer' &&
                  silverEnergy >= SILVER_SURFER_SONIC_UNLOCK &&
                  !teleportLocked && (
                    <div
                      className="animate-cartoon-pop-in fixed z-20"
                      style={{
                        right: isPc
                          ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                          : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                        bottom: isPc
                          ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                          : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                        transform: 'rotate(-1.5deg)',
                      }}
                    >
                      {isPc && <KeybindBadge label="E" />}
                      <button
                        type="button"
                        aria-label={SILVER_SURFER_SONIC_BLAST.name}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isPc) e.currentTarget.blur();
                          handleCastSonicBlast();
                        }}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCastSonicBlast();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                        style={{
                          width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          backgroundColor: '#253147',
                          backgroundImage: PURPLE_DOT_PATTERN,
                          backgroundSize: '11px 11px',
                          backgroundPosition: '0 0, 5.5px 5.5px',
                          border: '2.5px solid #E0F2FE',
                          boxShadow:
                            '2px 3px 0 rgba(8, 10, 18, 0.88), inset 0 0 0 1.5px rgba(156, 224, 255, 0.52)',
                          transition:
                            'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), background-color 90ms ease',
                          touchAction: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <AbilityIcon id="sonic-blast" size={isPc ? 32 : 20} />
                        <span
                          className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                          style={{
                            fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                            textShadow: '0 1.5px 0 #0B0D18',
                          }}
                        >
                          SONIC
                        </span>
                      </button>
                    </div>
                  )}

                {/* Storm Only: Flight-Only Lightning Strike Button beside Sprint */}
                {selectedCharacter.id === 'storm' &&
                  flightActive &&
                  !teleportLocked && (
                    <div
                      className="animate-cartoon-pop-in fixed z-20"
                      style={{
                        right: isPc
                          ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                          : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                        bottom: isPc
                          ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                          : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                        transform: stormLightningActive
                          ? 'rotate(-1.5deg) translateY(1px) scale(0.96)'
                          : 'rotate(-1.5deg)',
                        opacity:
                          stormIceSpearActive && !stormLightningActive && stormLightningCd === null
                            ? 0.56
                            : 1,
                        transition:
                          'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms ease',
                      }}
                    >
                      {isPc && <KeybindBadge label="E" />}
                      <button
                        type="button"
                        aria-label={STORM_LIGHTNING_STRIKE.name}
                        aria-pressed={stormLightningActive}
                        disabled={
                          stormLightningActive ||
                          stormIceSpearActive ||
                          stormLightningCd !== null
                        }
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isPc) e.currentTarget.blur();
                          handleCastLightningStrike();
                        }}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCastLightningStrike();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                        style={{
                          width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          backgroundColor: stormLightningActive ? '#3A320C' : '#25264A',
                          backgroundImage: PURPLE_DOT_PATTERN,
                          backgroundSize: '11px 11px',
                          backgroundPosition: '0 0, 5.5px 5.5px',
                          border: stormLightningActive
                            ? '2.5px solid #FDE047'
                            : '2.5px solid #0B0D18',
                          boxShadow: stormLightningActive
                            ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(253, 224, 71, 0.55)'
                            : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(253, 224, 71, 0.44)',
                          transition: 'background-color 110ms ease, box-shadow 110ms ease',
                          touchAction: 'none',
                          cursor:
                            stormLightningActive ||
                            stormIceSpearActive ||
                            stormLightningCd !== null
                              ? 'default'
                              : 'pointer',
                        }}
                      >
                        <AbilityIcon id="lightning-strike" size={isPc ? 32 : 20} />
                        <span
                          className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                          style={{
                            fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                            textShadow: '0 1.5px 0 #0B0D18',
                          }}
                        >
                          STRIKE
                        </span>

                        {stormLightningCd !== null && !stormLightningActive && (
                          <div
                            ref={stormLightningVeilRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20"
                            style={{
                              backgroundColor: 'rgba(10, 11, 24, 0.76)',
                              borderTop: '1.5px solid rgba(253, 224, 71, 0.45)',
                              transformOrigin: 'bottom center',
                              transform: 'scaleY(1)',
                              willChange: 'transform',
                            }}
                          />
                        )}
                      </button>
                    </div>
                  )}

                {/* Thor Only: Flight-Only Lightning Slam Button beside Sprint */}
                {selectedCharacter.id === 'thor' &&
                  flightActive &&
                  !teleportLocked && (
                    <div
                      className="animate-cartoon-pop-in fixed z-20"
                      style={{
                        right: isPc
                          ? 'calc(var(--pc-edge-r, 28px) + var(--pc-sprint, 90px) + var(--pc-gap, 14px))'
                          : 'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + clamp(54px, 8.4vw, 66px) + clamp(10px, 1.8vw, 16px))',
                        bottom: isPc
                          ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px))'
                          : 'calc(max(20px, calc(var(--stage-safe-bottom, 0px) + 14px)) + clamp(50px, 7.8vw, 62px) + 12px)',
                        transform: thorSlamActive
                          ? 'rotate(-1.5deg) translateY(1px) scale(0.96)'
                          : 'rotate(-1.5deg)',
                        opacity:
                          (thorMjolnirAway || thorStormBeamPhase !== 'idle') &&
                          !thorSlamActive &&
                          thorSlamCd === null
                            ? 0.56
                            : 1,
                        transition:
                          'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms ease',
                      }}
                    >
                      {isPc && <KeybindBadge label="E" />}
                      <button
                        type="button"
                        aria-label={THOR_LIGHTNING_SLAM.name}
                        aria-pressed={thorSlamActive}
                        disabled={
                          thorSlamActive ||
                          thorMjolnirAway ||
                          thorStormBeamPhase !== 'idle' ||
                          thorSlamCd !== null
                        }
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isPc) e.currentTarget.blur();
                          handleCastThorLightningSlam();
                        }}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCastThorLightningSlam();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="relative flex flex-col items-center justify-center gap-[2px] overflow-hidden rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                        style={{
                          width: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          height: isPc ? 'var(--pc-sub, 82px)' : 'clamp(50px, 7.8vw, 60px)',
                          backgroundColor: thorSlamActive ? '#113047' : '#25264A',
                          backgroundImage: PURPLE_DOT_PATTERN,
                          backgroundSize: '11px 11px',
                          backgroundPosition: '0 0, 5.5px 5.5px',
                          border: thorSlamActive
                            ? '2.5px solid #56D4FF'
                            : '2.5px solid #0B0D18',
                          boxShadow: thorSlamActive
                            ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(86, 212, 255, 0.55)'
                            : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(86, 212, 255, 0.44)',
                          transition: 'background-color 110ms ease, box-shadow 110ms ease',
                          touchAction: 'none',
                          cursor:
                            thorSlamActive ||
                            thorMjolnirAway ||
                            thorStormBeamPhase !== 'idle' ||
                            thorSlamCd !== null
                              ? 'default'
                              : 'pointer',
                        }}
                      >
                        <AbilityIcon id="lightning-slam" size={isPc ? 32 : 20} />
                        <span
                          className="font-cartoon font-bold italic uppercase text-center leading-[0.95] text-white"
                          style={{
                            fontSize: isPc ? '11.5px' : 'clamp(6.4px, 0.9vw, 7.8px)',
                            textShadow: '0 1.5px 0 #0B0D18',
                          }}
                        >
                          SLAM
                        </span>

                        {thorSlamCd !== null && !thorSlamActive && (
                          <div
                            ref={thorSlamVeilRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20"
                            style={{
                              backgroundColor: 'rgba(10, 11, 24, 0.76)',
                              borderTop: '1.5px solid rgba(86, 212, 255, 0.45)',
                              transformOrigin: 'bottom center',
                              transform: 'scaleY(1)',
                              willChange: 'transform',
                            }}
                          />
                        )}
                      </button>
                    </div>
                  )}

                {/* Mobile Only: Virtual Jump Button anchored in bottom-right corner (supports Jump & Flight Ascend hold) */}
                {!isPc && (
                  <button
                    type="button"
                    aria-label="Jump"
                    aria-pressed={jumpBtnPressed}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (gamePhaseRef.current !== 'playing' || spawnLockedRef.current) return;
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Ignore pointer capture errors
                      }
                      soundEngineRef.current?.unlock();
                      setJumpBtnPressed(true);
                      engineRef.current?.setJumpHeld(true);
                      engineRef.current?.triggerJump();
                    }}
                    onPointerMove={(e) => e.stopPropagation()}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      try {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      } catch {
                        // Ignore pointer release errors
                      }
                      setJumpBtnPressed(false);
                      engineRef.current?.setJumpHeld(false);
                    }}
                    onPointerCancel={(e) => {
                      e.stopPropagation();
                      try {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      } catch {
                        // Ignore pointer release errors
                      }
                      setJumpBtnPressed(false);
                      engineRef.current?.setJumpHeld(false);
                    }}
                    onLostPointerCapture={() => {
                      setJumpBtnPressed(false);
                      engineRef.current?.setJumpHeld(false);
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    className="fixed z-20 flex items-center justify-center rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{
                      width: 'clamp(50px, 7.8vw, 60px)',
                      height: 'clamp(50px, 7.8vw, 60px)',
                      right:
                        'calc(max(18px, calc(var(--stage-safe-right, 0px) + 12px)) + (clamp(54px, 8.4vw, 66px) - clamp(50px, 7.8vw, 60px)) / 2)',
                      bottom: 'max(18px, calc(var(--stage-safe-bottom, 0px) + 12px))',
                      backgroundColor: jumpBtnPressed ? '#1C1D3A' : '#353664',
                      backgroundImage: PURPLE_DOT_PATTERN,
                      backgroundSize: '11px 11px',
                      backgroundPosition: '0 0, 5.5px 5.5px',
                      border: '2.5px solid #0B0D18',
                      boxShadow: jumpBtnPressed
                        ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(185, 198, 255, 0.56)'
                        : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(155, 160, 230, 0.22)',
                      transform: jumpBtnPressed
                        ? 'rotate(-1.2deg) translateY(1px) scale(0.95)'
                        : 'rotate(-1.2deg)',
                      transition:
                        'transform 90ms cubic-bezier(0.16, 1, 0.3, 1), background-color 100ms ease, box-shadow 100ms ease',
                      touchAction: 'none',
                    }}
                  >
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 4.5L5.5 11.5H9.6V19.5H14.4V11.5H18.5L12 4.5Z"
                        fill={jumpBtnPressed ? '#E4EAFF' : '#FFFFFF'}
                        stroke="#0B0D18"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}

                {/* Right Side: Sprint Toggle Button (above Jump on Mobile, bottom-right corner on PC) */}
                <button
                  type="button"
                  aria-label="Sprint"
                  aria-pressed={sprintEnabled}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isPc) e.currentTarget.blur();
                    toggleSprint();
                  }}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onPointerCancel={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSprint();
                    }
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className="fixed z-20 flex items-center justify-center rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                  style={{
                    width: isPc ? 'var(--pc-sprint, 90px)' : 'clamp(54px, 8.4vw, 66px)',
                    height: isPc ? 'var(--pc-sprint, 90px)' : 'clamp(54px, 8.4vw, 66px)',
                    right: isPc
                      ? 'var(--pc-edge-r, 28px)'
                      : 'max(18px, calc(var(--stage-safe-right, 0px) + 12px))',
                    bottom: isPc
                      ? 'var(--pc-edge-b, 28px)'
                      : 'calc(max(18px, calc(var(--stage-safe-bottom, 0px) + 12px)) + clamp(50px, 7.8vw, 60px) + 10px)',
                    backgroundColor: sprintEnabled ? '#1C1D3A' : '#353664',
                    backgroundImage: PURPLE_DOT_PATTERN,
                    backgroundSize: '11px 11px',
                    backgroundPosition: '0 0, 5.5px 5.5px',
                    border: '2.5px solid #0B0D18',
                    boxShadow: sprintEnabled
                      ? '1px 1.5px 0 rgba(8, 10, 18, 0.92), inset 0 0 0 2px rgba(185, 198, 255, 0.56)'
                      : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(155, 160, 230, 0.22)',
                    transform: sprintEnabled
                      ? 'rotate(1.5deg) translateY(1px) scale(0.96)'
                      : 'rotate(1.5deg)',
                    transition:
                      'transform 100ms cubic-bezier(0.16, 1, 0.3, 1), background-color 120ms ease, box-shadow 120ms ease',
                    touchAction: 'none',
                  }}
                >
                  <svg
                    width={isPc ? '40' : '26'}
                    height={isPc ? '40' : '26'}
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="14.5"
                      cy="4.75"
                      r="2.1"
                      fill={sprintEnabled ? '#E4EAFF' : '#FFFFFF'}
                    />
                    <path
                      d="M7.5 11.2L10.4 9.2L13.3 9.7L15.8 11.8L18.2 10.6"
                      stroke={sprintEnabled ? '#E4EAFF' : '#FFFFFF'}
                      strokeWidth="2.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12.6 9.8L11.2 14.3L14.8 16.3L15.6 20.3"
                      stroke={sprintEnabled ? '#E4EAFF' : '#FFFFFF'}
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M11.2 14.3L8.2 17.6L5.6 18.1"
                      stroke={sprintEnabled ? '#E4EAFF' : '#FFFFFF'}
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {sprintEnabled && (
                      <path
                        d="M3.5 9.5H6.5M2.5 12.8H5.5"
                        stroke="rgba(195, 210, 255, 0.9)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    )}
                  </svg>
                </button>

                {/* Cartoon 4/5-Slot Ability Interface */}
                <AbilityBar
                  ref={abilityBarRef}
                  key={respawnKey}
                  isPc={isPc}
                  abilities={resolvedCharacter.abilities}
                  locked={
                    spawnLocked ||
                    teleportLocked ||
                    astralPhase === 'returning' ||
                    phoenixDivePhase !== 'idle' ||
                    forcefieldBarrierLocked ||
                    vampireStompDiving
                  }
                  painChanneling={painChanneling}
                  darkholdActive={darkholdActive}
                  autoShieldActive={autoShieldActive}
                  mindControlPhase={mindControlPhase}
                  astralActive={astralActive}
                  diamondActive={diamondActive}
                  telepathicWaveActive={telepathicWaveActive}
                  swordSummonActive={swordSummonActive}
                  magnetoTornadoActive={magnetoTornadoActive}
                  superSpeedActive={superSpeedActive}
                  rapidPunchActive={rapidPunchActive}
                  speedBlitzActive={speedBlitzActive}
                  windTornadoActive={windTornadoActive}
                  strangeShieldActive={strangeShieldActive}
                  visionLaserActive={visionLaserActive}
                  visionHeadGripActive={visionHeadGripActive}
                  supremeDrainActive={supremeDrainActive}
                  supremeStacks={supremeStacks}
                  zombieBeamActive={zombieBeamActive}
                  zombieStoneActive={zombieStoneActive}
                  agathaDarkholdActive={agathaDarkholdActive}
                  agathaAutoShieldActive={agathaAutoShieldActive}
                  agathaShieldActive={agathaShieldActive}
                  invisibilityActive={invisibilityActive}
                  forcefieldShieldActive={forcefieldShieldActive}
                  forcefieldTransferPhase={forcefieldTransferPhase}
                  vampireAbsorbing={vampireAbsorbing}
                  capShieldDefenseActive={capShieldDefenseActive}
                  capShieldChargeActive={capShieldChargeActive}
                  thorSlamActive={thorSlamActive}
                  thorStormBeamPhase={thorStormBeamPhase}
                  damageAbsorptionActive={damageAbsorptionActive}
                  silverEnergyReady={silverEnergy >= SILVER_SURFER_SONIC_UNLOCK}
                  dualCosmicBeamActive={dualCosmicBeamActive}
                  stormTornadoActive={stormTornadoActive}
                  stormIceSpearActive={stormIceSpearActive}
                  windBlastActive={windBlastActive}
                  stolenAbility={stolenAbility}
                  lockedAbilityIds={lockedAbilityIds}
                  flightCancelVisible={
                    selectedCharacter.id === 'scarlet-witch' && flightActive
                  }
                  onFlightToggle={handleFlightToggle}
                  onFlightStateChange={setFlightActive}
                  onCastChaosBolt={handleCastChaosBolt}
                  onToggleDarkhold={handleToggleDarkhold}
                  onCastTeleport={handleCastTeleport}
                  onCastTelekineticExplosion={handleCastTelekineticExplosion}
                  onCastAutoShield={handleCastAutoShield}
                  onCastChaosImplosion={handleCastChaosImplosion}
                  onStartSupremeDrainHold={handleStartSupremeDrainHold}
                  onStopSupremeDrainHold={handleStopSupremeDrainHold}
                  onFireSupremeStackBolt={handleFireSupremeStackBolt}
                  onCastZombieBeam={handleCastZombieBeam}
                  onCastZombieStoneExplosion={handleCastZombieStoneExplosion}
                  onCastAgathaBolt={handleCastAgathaBolt}
                  onToggleAgathaDarkhold={handleToggleAgathaDarkhold}
                  onCastAgathaTeleport={handleCastAgathaTeleport}
                  onCastAgathaDarkholdBlast={handleCastAgathaDarkholdBlast}
                  onCastAgathaAutoShield={handleCastAgathaAutoShield}
                  onActivateAgathaShield={handleActivateAgathaShield}
                  onCastPurgatoryGrasp={handleCastPurgatoryGrasp}
                  onCastPhoenixWave={handleCastPhoenixWave}
                  onCastPhoenixFireball={handleCastPhoenixFireball}
                  onTogglePainInfliction={handleTogglePainInfliction}
                  onActivateMindControl={handleActivateMindControl}
                  onSelectMindControlOption={handleSelectMindControlOption}
                  onCastMentalAttack={handleCastMentalAttack}
                  onToggleAstral={handleToggleAstral}
                  onToggleDiamond={handleToggleDiamond}
                  onCastTelepathicWave={handleCastTelepathicWave}
                  onActivateSwordSummon={handleActivateSwordSummon}
                  onCastGreenExplosion={handleCastGreenExplosion}
                  onCastSpinningLeap={handleCastSpinningLeap}
                  onCastGroundSword={handleCastGroundSword}
                  onCastMetalProjectile={handleCastMetalProjectile}
                  onCastMagneticMeteor={handleCastMagneticMeteor}
                  onToggleMetalTornado={handleToggleMetalTornado}
                  onToggleSuperSpeed={handleToggleSuperSpeed}
                  onCastRapidPunchCombo={handleCastRapidPunchCombo}
                  onCastSpeedBlitz={handleCastSpeedBlitz}
                  onToggleWindTornado={handleToggleWindTornado}
                  onCastTimeStop={handleCastTimeStop}
                  onToggleMysticShield={handleToggleMysticShield}
                  onCastMysticClones={handleCastMysticClones}
                  onCastEldritchDiscs={handleCastEldritchDiscs}
                  onCastAstralExtraction={handleCastAstralExtraction}
                  onCastMindStoneLaser={handleCastMindStoneLaser}
                  onCastMindStoneProjectile={handleCastMindStoneProjectile}
                  onCastHeadGrip={handleCastHeadGrip}
                  onToggleInvisibility={handleToggleInvisibility}
                  onToggleForcefieldShield={handleToggleForcefieldShield}
                  onTransferForcefieldShield={handleTransferForcefieldShield}
                  onSelectForcefieldOption={handleSelectForcefieldOption}
                  onCastForcefieldBarrier={handleCastForcefieldBarrier}
                  onCastVampireBolt={handleCastVampireBolt}
                  onCastPowerAbsorption={handleCastPowerAbsorption}
                  onCastBanditGun={handleCastBanditGun}
                  onCastPrisonerPunch={handleCastPrisonerPunch}
                  onCastCapShieldThrow={handleCastCapShieldThrow}
                  onToggleCapShieldDefense={handleToggleCapShieldDefense}
                  onCastCapShieldCombo={handleCastCapShieldCombo}
                  onCastCapShieldCharge={handleCastCapShieldCharge}
                  onCastThorMjolnirCombo={handleCastThorMjolnirCombo}
                  onCastThorMjolnirThrow={handleCastThorMjolnirThrow}
                  onCastThorLightningSlam={handleCastThorLightningSlam}
                  onCastThorLightningStormBeam={handleCastThorLightningStormBeam}
                  onToggleDamageAbsorption={handleToggleDamageAbsorption}
                  onCastCosmicBlast={handleCastCosmicBlast}
                  onCastDualCosmicBeam={handleCastDualCosmicBeam}
                  onToggleStormTornado={handleToggleStormTornado}
                  onCastIceSpear={handleCastIceSpear}
                  onToggleWindBlast={handleToggleWindBlast}
                  onAbilitySound={handleAbilitySound}
                />

                {/* Top-Right Death Button positioned directly beside Graphics Settings */}
                <button
                  type="button"
                  aria-label="Trigger death"
                  title="Death / Ragdoll"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isPc) e.currentTarget.blur();
                    handleTriggerDeath();
                  }}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onPointerCancel={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleTriggerDeath();
                    }
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className="fixed z-30 flex items-center justify-center rounded-[3px] transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                  style={{
                    top: isPc
                      ? 'max(20px, var(--stage-safe-top, 0px))'
                      : 'max(6px, var(--stage-safe-top, 0px))',
                    right: isPc
                      ? 'calc(max(24px, var(--stage-safe-right, 0px)) + clamp(56px, 4.2vw, 66px) + 12px)'
                      : 'calc(max(10px, var(--stage-safe-right, 0px)) + clamp(36px, 5.6vw, 42px) + 8px)',
                    width: isPc ? 'clamp(56px, 4.2vw, 66px)' : 'clamp(36px, 5.6vw, 42px)',
                    height: isPc ? 'clamp(56px, 4.2vw, 66px)' : 'clamp(36px, 5.6vw, 42px)',
                    backgroundColor: '#562944',
                    backgroundImage: PURPLE_DOT_PATTERN,
                    backgroundSize: '10px 10px',
                    backgroundPosition: '0 0, 5px 5px',
                    border: '2.5px solid #0B0D18',
                    boxShadow:
                      '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(255, 168, 182, 0.25)',
                    touchAction: 'manipulation',
                  }}
                >
                  <svg
                    width={isPc ? '29' : '20'}
                    height={isPc ? '29' : '20'}
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 3.5C7.6 3.5 4.2 6.7 4.2 10.8C4.2 13.3 5.4 15.4 7.3 16.7V19.2C7.3 19.9 7.9 20.5 8.6 20.5H15.4C16.1 20.5 16.7 19.9 16.7 19.2V16.7C18.6 15.4 19.8 13.3 19.8 10.8C19.8 6.7 16.4 3.5 12 3.5Z"
                      fill="#FFFFFF"
                      stroke="#0B0D18"
                      strokeWidth="1.9"
                      strokeLinejoin="round"
                    />
                    <circle cx="9.2" cy="11.2" r="1.4" fill="#0B0D18" />
                    <circle cx="14.8" cy="11.2" r="1.4" fill="#0B0D18" />
                    <path
                      d="M10.2 20.4V17.9M13.8 20.4V17.9"
                      stroke="#0B0D18"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

                {/* Graphics & Quality Settings */}
                <GraphicsSettingsPanel
                  settings={graphicsSettings}
                  forcedLandscape={forcedLandscape}
                  onChange={handleGraphicsChange}
                  onUiSound={handleUiSound}
                />

                {/* Test Map Only: Top-Center Controls (Spawn NPC, Bot, IA) */}
                {selectedMapId === 'test' && (
                  <div
                    className={`fixed left-1/2 z-30 flex -translate-x-1/2 items-center ${
                      isPc ? 'gap-3' : 'gap-1.5'
                    }`}
                    style={{
                      top: isPc
                        ? 'max(20px, var(--stage-safe-top, 0px))'
                        : 'max(6px, var(--stage-safe-top, 0px))',
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerMove={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onPointerCancel={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleSpawnTestNpc();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSpawnTestNpc();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={`rounded-[5px] font-cartoon font-bold italic uppercase tracking-wide text-[#0B0D18] transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer whitespace-nowrap ${
                        isPc ? 'px-5 py-2.5' : 'px-2.5 py-1'
                      }`}
                      style={{
                        backgroundColor: '#FFD147',
                        border: '2px solid #0B0D18',
                        boxShadow: '2px 2.5px 0 rgba(8, 10, 18, 0.88)',
                        fontSize: isPc
                          ? 'clamp(14.5px, 1.1vw, 17px)'
                          : 'clamp(9.5px, 1.3vw, 11.5px)',
                        touchAction: 'manipulation',
                      }}
                    >
                      Spawn NPC
                    </button>

                    <button
                      type="button"
                      aria-pressed={testBotEnabled}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleToggleTestBot();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleTestBot();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={`rounded-[5px] font-cartoon font-bold italic uppercase tracking-wide text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer whitespace-nowrap ${
                        isPc ? 'px-5 py-2.5' : 'px-2.5 py-1'
                      }`}
                      style={{
                        backgroundColor: testBotEnabled ? '#C92638' : '#353664',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '10px 10px',
                        backgroundPosition: '0 0, 5px 5px',
                        border: testBotEnabled
                          ? '2px solid #FF6B7A'
                          : '2px solid #0B0D18',
                        boxShadow: '2px 2.5px 0 rgba(8, 10, 18, 0.88)',
                        fontSize: isPc
                          ? 'clamp(14.5px, 1.1vw, 17px)'
                          : 'clamp(9.5px, 1.3vw, 11.5px)',
                        textShadow: '0 1px 0 #0B0D18',
                        touchAction: 'manipulation',
                      }}
                    >
                      Bot
                    </button>

                    <button
                      type="button"
                      aria-pressed={testAiEnabled}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleToggleTestAi();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleTestAi();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={`rounded-[5px] font-cartoon font-bold italic uppercase tracking-wide text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer whitespace-nowrap ${
                        isPc ? 'px-5 py-2.5' : 'px-2.5 py-1'
                      }`}
                      style={{
                        backgroundColor: testAiEnabled ? '#1E7A56' : '#353664',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '10px 10px',
                        backgroundPosition: '0 0, 5px 5px',
                        border: testAiEnabled
                          ? '2px solid #4DFF9E'
                          : '2px solid #0B0D18',
                        boxShadow: '2px 2.5px 0 rgba(8, 10, 18, 0.88)',
                        fontSize: isPc
                          ? 'clamp(14.5px, 1.1vw, 17px)'
                          : 'clamp(9.5px, 1.3vw, 11.5px)',
                        textShadow: '0 1px 0 #0B0D18',
                        touchAction: 'manipulation',
                      }}
                    >
                      IA
                    </button>
                  </div>
                )}

                {/* Test Map Only: Left-Side Utility Stack (Respawn, Change Character, Back) */}
                {selectedMapId === 'test' && (
                  <div
                    className={`fixed z-30 flex flex-col items-start ${
                      isPc ? 'gap-2.5' : 'gap-1.5'
                    }`}
                    style={{
                      left: isPc
                        ? 'max(24px, var(--stage-safe-left, 0px))'
                        : 'max(10px, var(--stage-safe-left, 0px))',
                      top: isPc
                        ? 'calc(max(20px, var(--stage-safe-top, 0px)) + clamp(128px, 9.2vw, 156px))'
                        : 'calc(max(6px, var(--stage-safe-top, 0px)) + clamp(80px, 12vw, 94px))',
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerMove={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onPointerCancel={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleInstantTestRespawn();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleInstantTestRespawn();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={`rounded-[5px] font-cartoon font-bold italic uppercase tracking-wide text-[#0B0D18] transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer whitespace-nowrap ${
                        isPc ? 'px-4.5 py-2' : 'px-2.5 py-1'
                      }`}
                      style={{
                        backgroundColor: '#FFD147',
                        border: '2px solid #0B0D18',
                        boxShadow: '2px 2.5px 0 rgba(8, 10, 18, 0.88)',
                        fontSize: isPc
                          ? 'clamp(13.5px, 1.05vw, 15.5px)'
                          : 'clamp(9px, 1.25vw, 11px)',
                        touchAction: 'manipulation',
                      }}
                    >
                      Respawn
                    </button>

                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleChangeCharacterFromTestMap();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleChangeCharacterFromTestMap();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={`rounded-[5px] font-cartoon font-bold italic uppercase tracking-wide text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer whitespace-nowrap ${
                        isPc ? 'px-4.5 py-2' : 'px-2.5 py-1'
                      }`}
                      style={{
                        backgroundColor: '#353664',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '10px 10px',
                        backgroundPosition: '0 0, 5px 5px',
                        border: '2px solid #0B0D18',
                        boxShadow: '2px 2.5px 0 rgba(8, 10, 18, 0.88)',
                        fontSize: isPc
                          ? 'clamp(13.5px, 1.05vw, 15.5px)'
                          : 'clamp(9px, 1.25vw, 11px)',
                        textShadow: '0 1px 0 #0B0D18',
                        touchAction: 'manipulation',
                      }}
                    >
                      Change Character
                    </button>

                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPc) e.currentTarget.blur();
                        handleBackToMainMenu();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleBackToMainMenu();
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={`rounded-[5px] font-cartoon font-bold italic uppercase tracking-wide text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer whitespace-nowrap ${
                        isPc ? 'px-4.5 py-2' : 'px-2.5 py-1'
                      }`}
                      style={{
                        backgroundColor: '#292B52',
                        backgroundImage: PURPLE_DOT_PATTERN,
                        backgroundSize: '10px 10px',
                        backgroundPosition: '0 0, 5px 5px',
                        border: '2px solid #0B0D18',
                        boxShadow: '2px 2.5px 0 rgba(8, 10, 18, 0.88)',
                        fontSize: isPc
                          ? 'clamp(13.5px, 1.05vw, 15.5px)'
                          : 'clamp(9px, 1.25vw, 11px)',
                        textShadow: '0 1px 0 #0B0D18',
                        touchAction: 'manipulation',
                      }}
                    >
                      Back
                    </button>
                  </div>
                )}

                {/* Configurable Aim Reticle + Hit Confirmation Marker (Mobile Only; PC uses direct mouse crosshair) */}
                {!isPc && (
                  <ReticleHud
                    ref={reticleRef}
                    isPc={isPc}
                    styleType={graphicsSettings.crosshairStyle}
                  />
                )}
              </>
            )}

            {/* Cartoon Death Screen */}
            {gamePhase === 'dead' && deathPanelVisible && (
              <DeathScreen
                onRespawn={handleRespawn}
                onChangeCharacter={handleChangeCharacterFromDeath}
              />
            )}

            {/* Cartoon Screen Transition Overlay */}
            <ScreenTransition phase={transitionPhase} />
          </>
        )}
      </div>
    </div>
  );
}
