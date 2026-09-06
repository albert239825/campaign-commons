import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { clamp, fitAll, kBucket, scaleOf, toLayoutPoint, viewBoxOf, zoomAbout, type Camera } from "./camera";

/** Zoom factor of one `[+]` / `[−]` step, `+` / `-` key, or one mouse-wheel notch. */
export const ZOOM_STEP = 1.5;
/** Pan distance of one `Shift`+arrow press, in viewport px. */
const KEY_PAN_PX = 80;
/** `Ctrl`+wheel: scale multiplier per px of `deltaY` (a 100-px mouse notch ≈ ×1.65; trackpad pinch deltas are a few px). */
const WHEEL_ZOOM = 0.005;

const isCanvas = (target: EventTarget | null) =>
  target instanceof Element && target.closest(".chain-node, .chain-ribbon") === null;

/**
 * Camera state for the chain SVG. React renders the fit viewBox (the server's) and never changes it; the camera is
 * written straight to the `viewBox` attribute, once per animation frame, so zooming and panning never re-render the
 * picture. The scale bucket (`data-k`, for the semantic-zoom CSS) and the zoom readout are written the same way:
 * nothing about the camera lives in React state, so a gesture never re-renders the diagram.
 */
export function useCamera(
  svgRef: RefObject<SVGSVGElement | null>,
  layout: { width: number; height: number },
  kMax: number,
) {
  const bounds = useMemo(() => fitAll(layout), [layout]);
  const cam = useRef<Camera>(bounds);
  const pending = useRef<{ next: Camera | null; frame: number } | null>(null);
  const readoutRef = useRef<HTMLElement | null>(null);

  const viewportOf = (svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  const write = (next: Camera | null) => {
    const svg = svgRef.current;
    if (!svg) return;
    const vp = viewportOf(svg);
    const c = next ? clamp(next, bounds, vp, kMax) : bounds;
    cam.current = c;
    svg.setAttribute("viewBox", viewBoxOf(c));
    const b = kBucket(scaleOf(c, vp));
    if (svg.dataset.k !== String(b)) svg.dataset.k = String(b);
    if (readoutRef.current) readoutRef.current.textContent = `zoom ${(b / 10).toFixed(1)}×`;
  };
  /** Queue a camera for the next frame; `null` means fit. */
  const set = (next: Camera | null) => {
    if (pending.current) {
      pending.current.next = next;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const p = pending.current;
      pending.current = null;
      if (p) write(p.next);
    });
    pending.current = { next, frame };
  };
  /** The camera as it will be after the queued frame. */
  const current = () => (pending.current ? (pending.current.next ?? bounds) : cam.current);
  const scale = () => (svgRef.current ? scaleOf(current(), viewportOf(svgRef.current)) : 1);
  /** Layout-unit coordinates of a client point, against the camera being written. */
  const toLayout = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const r = svg.getBoundingClientRect();
    return toLayoutPoint(current(), { w: r.width, h: r.height }, clientX - r.left, clientY - r.top);
  };

  const zoomAt = (factor: number, px: number, py: number) => set(zoomAbout(current(), factor, px, py));
  const zoomCentre = (factor: number) => {
    const c = current();
    zoomAt(factor, c.x + c.w / 2, c.y + c.h / 2);
  };
  const controls = {
    zoomIn: () => zoomCentre(ZOOM_STEP),
    zoomOut: () => zoomCentre(1 / ZOOM_STEP),
    fit: () => set(null),
    /** k = 1: labels at their designed size. */
    actual: () => zoomCentre(1 / scale()),
    /** Pan by viewport px. */
    panPx: (dx: number, dy: number) => {
      const k = scale();
      const c = current();
      set({ ...c, x: c.x + dx / k, y: c.y + dy / k });
    },
    keyPanPx: KEY_PAN_PX,
  };

  // A new layout (expand / fold / hide) starts from fit, as the server would have drawn it.
  useLayoutEffect(() => {
    if (pending.current) cancelAnimationFrame(pending.current.frame);
    pending.current = null;
    write(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- write reads refs; bounds is the only input
  }, [bounds]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pointers = new Map<number, [number, number]>();

    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return; // plain wheel scrolls the page
      ev.preventDefault();
      const [px, py] = toLayout(ev.clientX, ev.clientY);
      const dy = ev.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? ev.deltaY : ev.deltaY * 100;
      zoomAt(Math.min(2, Math.max(0.5, Math.exp(-dy * WHEEL_ZOOM))), px, py);
    };
    const onPointerDown = (ev: PointerEvent) => {
      if (!isCanvas(ev.target) && ev.pointerType !== "touch") return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      // Touch pointers are captured implicitly by their target, which keeps a tap on a node a click.
      if (ev.pointerType !== "touch") svg.setPointerCapture(ev.pointerId);
      svg.classList.add("chain-grabbing");
    };
    const onPointerMove = (ev: PointerEvent) => {
      const prev = pointers.get(ev.pointerId);
      if (!prev) return;
      const k = scale();
      if (pointers.size === 1) {
        controls.panPx(prev[0] - ev.clientX, prev[1] - ev.clientY);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.entries()];
        const other = a[0] === ev.pointerId ? b[1] : a[1];
        const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
        const d1 = Math.hypot(ev.clientX - other[0], ev.clientY - other[1]);
        const mid0 = [(prev[0] + other[0]) / 2, (prev[1] + other[1]) / 2];
        const mid1 = [(ev.clientX + other[0]) / 2, (ev.clientY + other[1]) / 2];
        const [px, py] = toLayout(mid1[0], mid1[1]);
        const c = current();
        const panned = { ...c, x: c.x + (mid0[0] - mid1[0]) / k, y: c.y + (mid0[1] - mid1[1]) / k };
        set(d0 > 0 ? zoomAbout(panned, d1 / d0, px, py) : panned);
      }
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    };
    const onPointerEnd = (ev: PointerEvent) => {
      if (!pointers.delete(ev.pointerId)) return;
      if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
      if (pointers.size === 0) svg.classList.remove("chain-grabbing");
    };
    const onDblClick = (ev: MouseEvent) => {
      if (!isCanvas(ev.target)) return;
      ev.preventDefault();
      const [px, py] = toLayout(ev.clientX, ev.clientY);
      zoomAt(2, px, py);
    };
    const onResize = () => set(current());

    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerEnd);
    svg.addEventListener("pointercancel", onPointerEnd);
    svg.addEventListener("dblclick", onDblClick);
    const ro = new ResizeObserver(onResize);
    ro.observe(svg);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerEnd);
      svg.removeEventListener("pointercancel", onPointerEnd);
      svg.removeEventListener("dblclick", onDblClick);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read refs; rebinding per layout is enough
  }, [bounds, kMax]);

  return { controls, readoutRef, viewBox: viewBoxOf(bounds) };
}
