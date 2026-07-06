import { useEffect, useRef, type ReactNode } from "react";

interface Rect {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/**
 * A movable, resizable popup. Drag anywhere on a child marked `.fp-drag`
 * (panels put it on their header); resize via the native CSS handle in the
 * bottom-right corner. Position and size persist per `id`.
 */
export function FloatingPanel({
  id,
  className,
  defaultRect,
  resizable = true,
  children,
}: {
  id: string;
  className?: string;
  /** Initial placement; negative x/y measure from the right/bottom edge. */
  defaultRect: Rect;
  resizable?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `gather:panel:${id}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const clamp = (r: Rect): Rect => ({
      ...r,
      x: Math.min(Math.max(r.x, 8 - el.offsetWidth + 40), innerWidth - 40),
      y: Math.min(Math.max(r.y, 0), innerHeight - 40),
    });

    const apply = (r: Rect) => {
      el.style.left = `${r.x}px`;
      el.style.top = `${r.y}px`;
      if (r.w) el.style.width = `${r.w}px`;
      if (r.h) el.style.height = `${r.h}px`;
    };

    let saved: Rect | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? "");
    } catch {
      // first open
    }
    const initial = saved ?? {
      ...defaultRect,
      x:
        defaultRect.x >= 0
          ? defaultRect.x
          : innerWidth - (defaultRect.w ?? el.offsetWidth) + defaultRect.x,
      y:
        defaultRect.y >= 0
          ? defaultRect.y
          : innerHeight - (defaultRect.h ?? el.offsetHeight) + defaultRect.y,
    };
    apply(clamp(initial));

    const save = () => {
      localStorage.setItem(
        key,
        JSON.stringify({
          x: el.offsetLeft,
          y: el.offsetTop,
          w: el.offsetWidth,
          h: el.offsetHeight,
        })
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".fp-drag") || target.closest("button, input")) {
        return;
      }
      e.preventDefault();
      const startX = e.clientX - el.offsetLeft;
      const startY = e.clientY - el.offsetTop;
      const onMove = (ev: PointerEvent) => {
        apply(
          clamp({ x: ev.clientX - startX, y: ev.clientY - startY })
        );
      };
      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        save();
      };
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
    };
    el.addEventListener("pointerdown", onPointerDown);

    const handle = el.querySelector<HTMLElement>(".fp-resize");
    const onResizeDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startW = el.offsetWidth - e.clientX;
      const startH = el.offsetHeight - e.clientY;
      const onMove = (ev: PointerEvent) => {
        el.style.width = `${Math.max(220, startW + ev.clientX)}px`;
        el.style.height = `${Math.max(120, startH + ev.clientY)}px`;
      };
      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        save();
      };
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
    };
    handle?.addEventListener("pointerdown", onResizeDown);

    // Persist native CSS resizes.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(save, 300);
    });
    ro.observe(el);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      handle?.removeEventListener("pointerdown", onResizeDown);
      ro.disconnect();
      clearTimeout(resizeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div
      ref={ref}
      className={`floating-panel ${resizable ? "fp-resizable" : ""} ${className ?? ""}`}
    >
      {children}
      {resizable && <div className="fp-resize" title="Resize" />}
    </div>
  );
}
