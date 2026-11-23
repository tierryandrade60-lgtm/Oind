interface DeathScreenProps {
  onRespawn: () => void;
  onChangeCharacter: () => void;
}

export function DeathScreen({
  onRespawn,
  onChangeCharacter,
}: DeathScreenProps) {
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="death-screen-title"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center select-none"
      style={{
        top: 'max(14px, calc(var(--stage-safe-top, 0px) + 10px))',
      }}
    >
      <div
        className="animate-cartoon-pop-in pointer-events-auto flex flex-col items-center gap-1.5 text-center"
        style={{ touchAction: 'manipulation' }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onPointerCancel={(e) => e.stopPropagation()}
      >
        {/* Top-Center Skull */}
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          style={{
            filter: 'drop-shadow(0 2px 3px rgba(8, 10, 18, 0.85))',
          }}
        >
          <path
            d="M12 3.5C7.6 3.5 4.2 6.7 4.2 10.8C4.2 13.3 5.4 15.4 7.3 16.7V19.2C7.3 19.9 7.9 20.5 8.6 20.5H15.4C16.1 20.5 16.7 19.9 16.7 19.2V16.7C18.6 15.4 19.8 13.3 19.8 10.8C19.8 6.7 16.4 3.5 12 3.5Z"
            fill="#FFFFFF"
            stroke="#0B0D18"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="9.2" cy="11.1" r="1.45" fill="#0B0D18" />
          <circle cx="14.8" cy="11.1" r="1.45" fill="#0B0D18" />
          <path
            d="M10.2 20.4V17.9M13.8 20.4V17.9"
            stroke="#0B0D18"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>

        <h2
          id="death-screen-title"
          className="font-cartoon text-lg font-extrabold italic uppercase tracking-wide text-white leading-none"
          style={{
            WebkitTextStroke: '2.5px #0B0D18',
            paintOrder: 'stroke fill',
            textShadow: '0 2px 4px rgba(8, 10, 18, 0.85)',
          }}
        >
          You Died
        </h2>

        {/* Two Small Transparent Action Buttons */}
        <div className="mt-0.5 flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRespawn();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onRespawn();
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="cursor-pointer rounded-[6px] px-3 py-1 font-cartoon text-[11px] font-bold italic uppercase tracking-wide text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              backgroundColor: 'rgba(14, 18, 36, 0.28)',
              backdropFilter: 'blur(4px)',
              border: '1.8px solid rgba(255, 255, 255, 0.72)',
              boxShadow: '0 2px 6px rgba(8, 10, 18, 0.45)',
              textShadow: '0 1.5px 2px rgba(8, 10, 18, 0.9)',
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
              onChangeCharacter();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChangeCharacter();
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="cursor-pointer rounded-[6px] px-3 py-1 font-cartoon text-[11px] font-bold italic uppercase tracking-wide text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              backgroundColor: 'rgba(14, 18, 36, 0.28)',
              backdropFilter: 'blur(4px)',
              border: '1.8px solid rgba(255, 255, 255, 0.72)',
              boxShadow: '0 2px 6px rgba(8, 10, 18, 0.45)',
              textShadow: '0 1.5px 2px rgba(8, 10, 18, 0.9)',
              touchAction: 'manipulation',
            }}
          >
            Change
          </button>
        </div>
      </div>
    </div>
  );
}
