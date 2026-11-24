interface KeybindBadgeProps {
  label: string;
}

/**
 * Compact desktop-only keybind chip rendered strictly on ability buttons.
 */
export function KeybindBadge({ label }: KeybindBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[5px] px-1.5 font-cartoon font-extrabold uppercase leading-none text-white"
      style={{
        top: '-11px',
        left: '-9px',
        minWidth: '25px',
        height: '25px',
        fontSize: '13.5px',
        backgroundColor: '#141733',
        border: '2px solid #0B0D18',
        boxShadow:
          '1.5px 2px 0 rgba(8, 10, 18, 0.9), inset 0 0 0 1px rgba(210, 218, 255, 0.32)',
        textShadow: '0 1px 0 #0B0D18',
      }}
    >
      {label}
    </span>
  );
}
