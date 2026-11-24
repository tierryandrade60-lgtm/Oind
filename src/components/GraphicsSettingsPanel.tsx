import { useRef, useState } from 'react';
import {
  applyPresetToSettings,
  CrosshairStyle,
  getDefaultGraphicsSettings,
  GraphicsSettings,
  MAX_CAMERA_ZOOM,
  MIN_CAMERA_ZOOM,
  QualityPreset,
} from '../game/graphicsSettings';
import { useIsPc } from '../utils/platform';

const PURPLE_DOT_PATTERN =
  'radial-gradient(circle, rgba(142, 145, 218, 0.34) 1.4px, transparent 1.5px), radial-gradient(circle, rgba(142, 145, 218, 0.34) 1.4px, transparent 1.5px)';

interface CartoonRangeSliderProps {
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  forcedLandscape: boolean;
  isPc: boolean;
  onChange: (nextVal: number) => void;
}

function CartoonRangeSlider({
  label,
  valueText,
  min,
  max,
  step,
  value,
  forcedLandscape,
  isPc,
  onChange,
}: CartoonRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingPointerRef = useRef<number | null>(null);

  const computeValueFromPointer = (clientX: number, clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();

    // When forcedLandscape rotates appRootRef +90deg clockwise, stage left->right runs screen top->bottom
    const rawRatio = forcedLandscape
      ? (clientY - rect.top) / Math.max(rect.height, 1)
      : (clientX - rect.left) / Math.max(rect.width, 1);

    const clampedRatio = Math.min(1, Math.max(0, rawRatio));
    const rawVal = min + clampedRatio * (max - min);
    const snapped = Math.round((rawVal - min) / step) * step + min;
    const finalVal = Number(Math.min(max, Math.max(min, snapped)).toFixed(4));
    onChange(finalVal);
  };

  const ratio = Math.min(1, Math.max(0, (value - min) / Math.max(max - min, 0.0001)));

  return (
    <div className={`flex flex-col ${isPc ? 'gap-1' : 'gap-0.5'}`}>
      <div className="flex items-center justify-between">
        <span
          className={`font-cartoon font-bold uppercase tracking-wide text-indigo-100 ${
            isPc ? 'text-[12px]' : 'text-[9px]'
          }`}
        >
          {label}
        </span>
        <span
          className={`font-cartoon font-bold tabular-nums text-white ${
            isPc ? 'text-[12px]' : 'text-[9px]'
          }`}
        >
          {valueText}
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingPointerRef.current = e.pointerId;
          computeValueFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (draggingPointerRef.current !== e.pointerId) return;
          e.preventDefault();
          e.stopPropagation();
          computeValueFromPointer(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (draggingPointerRef.current === e.pointerId) {
            e.stopPropagation();
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            draggingPointerRef.current = null;
          }
        }}
        onPointerCancel={(e) => {
          if (draggingPointerRef.current === e.pointerId) {
            e.stopPropagation();
            draggingPointerRef.current = null;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(Math.min(max, Number((value + step).toFixed(4))));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(Math.max(min, Number((value - step).toFixed(4))));
          }
        }}
        className={`relative flex w-full cursor-pointer items-center select-none focus:outline-none ${
          isPc ? 'h-6' : 'h-4.5'
        }`}
        style={{ touchAction: 'none' }}
      >
        <div
          className={`relative w-full overflow-hidden rounded-full ${
            isPc ? 'h-3' : 'h-2'
          }`}
          style={{
            backgroundColor: '#171936',
            border: '1.5px solid #0B0D18',
          }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${ratio * 100}%`,
              backgroundColor: '#FFD147',
            }}
          />
        </div>

        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${ratio * 100}%`,
            width: isPc ? '17px' : '13px',
            height: isPc ? '17px' : '13px',
            backgroundColor: '#FFD147',
            border: '2px solid #0B0D18',
            boxShadow: '0 1px 0 rgba(8, 10, 18, 0.85)',
          }}
        />
      </div>
    </div>
  );
}

interface GraphicsSettingsPanelProps {
  settings: GraphicsSettings;
  forcedLandscape?: boolean;
  onChange: (next: GraphicsSettings) => void;
  onUiSound?: () => void;
}

export function GraphicsSettingsPanel({
  settings,
  forcedLandscape = false,
  onChange,
  onUiSound,
}: GraphicsSettingsPanelProps) {
  const isPc = useIsPc();
  const [open, setOpen] = useState(false);

  const selectPreset = (preset: QualityPreset) => {
    onUiSound?.();
    onChange(applyPresetToSettings(settings, preset));
  };

  const selectCrosshair = (crosshairStyle: CrosshairStyle) => {
    onUiSound?.();
    onChange({
      ...settings,
      crosshairStyle,
    });
  };

  return (
    <div
      className="fixed z-30 select-none"
      style={{
        top: isPc ? 'max(20px, var(--stage-safe-top, 0px))' : 'max(6px, var(--stage-safe-top, 0px))',
        right: isPc ? 'max(24px, var(--stage-safe-right, 0px))' : 'max(10px, var(--stage-safe-right, 0px))',
        touchAction: 'manipulation',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
    >
      {/* Fixed-position Toggle Button */}
      <button
        type="button"
        aria-label="Settings / Configurações"
        aria-expanded={open}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isPc) e.currentTarget.blur();
          onUiSound?.();
          setOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onUiSound?.();
            setOpen((prev) => !prev);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="flex items-center justify-center rounded-[3px] transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
        style={{
          width: isPc ? 'clamp(56px, 4.2vw, 66px)' : 'clamp(36px, 5.6vw, 42px)',
          height: isPc ? 'clamp(56px, 4.2vw, 66px)' : 'clamp(36px, 5.6vw, 42px)',
          backgroundColor: open ? '#1C1D3A' : '#353664',
          backgroundImage: PURPLE_DOT_PATTERN,
          backgroundSize: '10px 10px',
          backgroundPosition: '0 0, 5px 5px',
          border: '2.5px solid #0B0D18',
          boxShadow: open
            ? '1px 1.5px 0 rgba(8, 10, 18, 0.9), inset 0 0 0 1.5px rgba(185, 198, 255, 0.5)'
            : '2px 3px 0 rgba(8, 10, 18, 0.85), inset 0 0 0 1.5px rgba(155, 160, 230, 0.22)',
        }}
      >
        <svg
          width={isPc ? '28' : '19'}
          height={isPc ? '28' : '19'}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
            stroke="#FFFFFF"
            strokeWidth="2.2"
          />
          <path
            d="M19.4 15a1.6 1.6 0 0 0 .32 1.76l.06.06a1.94 1.94 0 1 1-2.74 2.74l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.46V21a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.94 1.94 0 1 1-2.74-2.74l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.97H3a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.94 1.94 0 1 1 2.74-2.74l.06.06a1.6 1.6 0 0 0 1.76.32h.08a1.6 1.6 0 0 0 .97-1.46V3a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.94 1.94 0 1 1 2.74 2.74l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97H21a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.51 1.05Z"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Compact Positioned Popover */}
      {open && (
        <div
          className={`absolute right-0 ${
            isPc
              ? 'mt-2 w-[clamp(320px,24vw,380px)] rounded-[7px] p-4'
              : 'mt-1.5 w-[198px] max-w-[78vw] rounded-[5px] p-1.5'
          }`}
          style={{
            top: '100%',
            backgroundColor: '#2A2B52',
            backgroundImage: PURPLE_DOT_PATTERN,
            backgroundSize: '10px 10px',
            backgroundPosition: '0 0, 5px 5px',
            border: '2px solid #0B0D18',
            boxShadow:
              '2.5px 3.5px 0 rgba(8, 10, 18, 0.88), inset 0 0 0 1px rgba(155, 160, 230, 0.24)',
          }}
        >
          <div
            className={`flex items-center justify-between border-b border-white/15 ${
              isPc ? 'mb-3 pb-2' : 'mb-1.5 pb-1'
            }`}
          >
            <span
              className={`font-cartoon font-bold uppercase italic tracking-wide text-white ${
                isPc ? 'text-[16px]' : 'text-[9.5px]'
              }`}
              style={{ textShadow: '0 1px 0 rgba(8, 10, 18, 0.9)' }}
            >
              Settings
            </span>
          </div>

          <div className={`flex flex-col ${isPc ? 'gap-2.5' : 'gap-1.5'}`}>
            {/* 1. Graphics: Low, Medium, High, Ultra */}
            <div className={`flex flex-col ${isPc ? 'gap-1' : 'gap-0.5'}`}>
              <span
                className={`font-cartoon font-bold uppercase tracking-wide text-indigo-100 ${
                  isPc ? 'text-[12px]' : 'text-[9px]'
                }`}
              >
                Graphics
              </span>
              <div className={`grid grid-cols-4 ${isPc ? 'gap-1.5' : 'gap-1'}`}>
                {(['low', 'medium', 'high', 'ultra'] as const).map((presetKey) => {
                  const active = settings.preset === presetKey;
                  return (
                    <button
                      key={presetKey}
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectPreset(presetKey);
                      }}
                      className={`rounded-[4px] font-cartoon font-bold uppercase italic transition-transform active:scale-95 focus:outline-none cursor-pointer ${
                        isPc ? 'py-1.5 text-[11.5px]' : 'py-[2px] text-[8.5px]'
                      }`}
                      style={{
                        backgroundColor: active ? '#5659A8' : '#1E2040',
                        color: active ? '#FFFFFF' : 'rgba(210, 216, 244, 0.8)',
                        border: '1.5px solid #0B0D18',
                        boxShadow: active
                          ? 'inset 0 0 0 1px rgba(215, 222, 255, 0.45)'
                          : 'none',
                      }}
                    >
                      {presetKey}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Crosshair (Mobile touch reticle only; PC aims directly with mouse crosshair) */}
            {!isPc && (
              <div className="flex flex-col gap-0.5">
                <span className="font-cartoon text-[9px] font-bold uppercase tracking-wide text-indigo-100">
                  Crosshair
                </span>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { value: 'circle-dot', label: 'Circle' },
                      { value: 'crosshair', label: 'Cross' },
                      { value: 'dot', label: 'Dot' },
                    ] as const
                  ).map((opt) => {
                    const active = settings.crosshairStyle === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          selectCrosshair(opt.value);
                        }}
                        className="rounded-[3px] px-1 py-[2px] font-cartoon text-[8.5px] font-bold uppercase transition-transform active:scale-95 focus:outline-none truncate"
                        style={{
                          backgroundColor: active ? '#5659A8' : '#1E2040',
                          color: active ? '#FFFFFF' : 'rgba(210, 216, 244, 0.8)',
                          border: '1.5px solid #0B0D18',
                          boxShadow: active
                            ? 'inset 0 0 0 1px rgba(215, 222, 255, 0.45)'
                            : 'none',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Master Volume (0-100) */}
            <CartoonRangeSlider
              label="Volume"
              valueText={`${settings.masterVolume}%`}
              min={0}
              max={100}
              step={1}
              value={settings.masterVolume}
              forcedLandscape={forcedLandscape}
              isPc={isPc}
              onChange={(v) => onChange({ ...settings, masterVolume: v })}
            />

            {/* 4. Sensitivity (0-100) */}
            <CartoonRangeSlider
              label="Sensitivity"
              valueText={`${settings.sensitivity}`}
              min={0}
              max={100}
              step={1}
              value={settings.sensitivity}
              forcedLandscape={forcedLandscape}
              isPc={isPc}
              onChange={(v) => onChange({ ...settings, sensitivity: v })}
            />

            {/* 5. Camera Zoom */}
            <CartoonRangeSlider
              label="Zoom"
              valueText={settings.cameraZoom.toFixed(1)}
              min={MIN_CAMERA_ZOOM}
              max={MAX_CAMERA_ZOOM}
              step={0.05}
              value={settings.cameraZoom}
              forcedLandscape={forcedLandscape}
              isPc={isPc}
              onChange={(v) => onChange({ ...settings, cameraZoom: v })}
            />

            {/* 6. Independent Camera Shake & Screen Effects Toggles */}
            <div className={`flex flex-col pt-0.5 ${isPc ? 'gap-1.5' : 'gap-1'}`}>
              <button
                type="button"
                role="switch"
                aria-checked={settings.cameraShake}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onUiSound?.();
                  onChange({ ...settings, cameraShake: !settings.cameraShake });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onUiSound?.();
                    onChange({ ...settings, cameraShake: !settings.cameraShake });
                  }
                }}
                className={`flex w-full items-center justify-between rounded-[4px] transition-transform active:scale-[0.98] focus:outline-none cursor-pointer ${
                  isPc ? 'px-2.5 py-2' : 'px-1.5 py-[3px]'
                }`}
                style={{
                  backgroundColor: '#1E2040',
                  border: '1.5px solid #0B0D18',
                }}
              >
                <span
                  className={`font-cartoon font-bold uppercase tracking-wide text-indigo-100 ${
                    isPc ? 'text-[12px]' : 'text-[9px]'
                  }`}
                >
                  Camera Shake
                </span>
                <span
                  className={`rounded-[3px] font-cartoon font-extrabold uppercase ${
                    isPc ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-[1px] text-[8px]'
                  }`}
                  style={{
                    backgroundColor: settings.cameraShake ? '#2ECC71' : '#33365E',
                    color: settings.cameraShake ? '#0B0D18' : 'rgba(210, 216, 244, 0.72)',
                    border: '1px solid #0B0D18',
                  }}
                >
                  {settings.cameraShake ? 'ON' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={settings.screenEffects}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onUiSound?.();
                  onChange({ ...settings, screenEffects: !settings.screenEffects });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onUiSound?.();
                    onChange({ ...settings, screenEffects: !settings.screenEffects });
                  }
                }}
                className={`flex w-full items-center justify-between rounded-[4px] transition-transform active:scale-[0.98] focus:outline-none cursor-pointer ${
                  isPc ? 'px-2.5 py-2' : 'px-1.5 py-[3px]'
                }`}
                style={{
                  backgroundColor: '#1E2040',
                  border: '1.5px solid #0B0D18',
                }}
              >
                <span
                  className={`font-cartoon font-bold uppercase tracking-wide text-indigo-100 ${
                    isPc ? 'text-[12px]' : 'text-[9px]'
                  }`}
                >
                  Screen Effects
                </span>
                <span
                  className={`rounded-[3px] font-cartoon font-extrabold uppercase ${
                    isPc ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-[1px] text-[8px]'
                  }`}
                  style={{
                    backgroundColor: settings.screenEffects ? '#2ECC71' : '#33365E',
                    color: settings.screenEffects ? '#0B0D18' : 'rgba(210, 216, 244, 0.72)',
                    border: '1px solid #0B0D18',
                  }}
                >
                  {settings.screenEffects ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>

            {/* 7. Reset */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onUiSound?.();
                onChange(getDefaultGraphicsSettings(isPc));
              }}
              className={`mt-0.5 w-full rounded-[4px] font-cartoon font-bold uppercase tracking-wide text-indigo-100 transition-transform active:scale-95 focus:outline-none cursor-pointer ${
                isPc ? 'py-2 text-[12px]' : 'py-[3px] text-[9px]'
              }`}
              style={{
                backgroundColor: '#1E2040',
                border: '1.5px solid #0B0D18',
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
