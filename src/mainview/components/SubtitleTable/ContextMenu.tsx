import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: (MenuItem | "sep")[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismiss = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    const el = ref.current;
    // Keep the menu inside the viewport.
    if (el) {
      const r = el.getBoundingClientRect();
      const dx = Math.min(0, window.innerWidth - (x + r.width));
      const dy = Math.min(0, window.innerHeight - (y + r.height));
      if (dx || dy) el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose, x, y]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className="ctx-item"
            disabled={it.disabled}
            onClick={() => {
              if (!it.disabled) it.onClick();
              onClose();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
