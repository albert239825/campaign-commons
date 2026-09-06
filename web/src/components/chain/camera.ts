/**
 * viewBox camera for the chain picture. The layout (layout.ts) is server-rendered in its own unit space and never
 * changes on zoom; the camera is the rectangle of that space written to `<svg viewBox>`. Pure functions, no DOM.
 *
 * Scale k = rendered px per layout unit. The SVG uses the default `preserveAspectRatio="xMidYMid meet"`, so
 * k = min(viewport.w / cam.w, viewport.h / cam.h). The camera keeps the layout's aspect ratio, so the picture is
 * letterboxed exactly as it is today at fit.
 */

export type Camera = { x: number; y: number; w: number; h: number };
export type Rect = Camera;
/** Size of the SVG element in CSS px. */
export type Viewport = { w: number; h: number };

/** The camera that shows the whole layout: identical to the server-rendered `viewBox`. */
export function fitAll(layout: { width: number; height: number }): Camera {
  return { x: 0, y: 0, w: layout.width, h: layout.height };
}

/** Rendered px per layout unit (`xMidYMid meet`). */
export function scaleOf(cam: Camera, viewport: Viewport): number {
  return Math.min(viewport.w / cam.w, viewport.h / cam.h);
}

/** Layout-unit coordinates of a point given in px from the SVG's top-left corner (honours the letterbox). */
export function toLayoutPoint(cam: Camera, viewport: Viewport, px: number, py: number): [number, number] {
  const k = scaleOf(cam, viewport);
  const offX = (viewport.w - cam.w * k) / 2;
  const offY = (viewport.h - cam.h * k) / 2;
  return [cam.x + (px - offX) / k, cam.y + (py - offY) / k];
}

/**
 * Scale by `factor` (k' = k·f) keeping the layout point (px, py) under the pointer:
 * the camera shrinks to w/f and moves so that (px − x') / w' = (px − x) / w.
 */
export function zoomAbout(cam: Camera, factor: number, px: number, py: number): Camera {
  return {
    x: px - (px - cam.x) / factor,
    y: py - (py - cam.y) / factor,
    w: cam.w / factor,
    h: cam.h / factor,
  };
}

/** Move the camera by (dx, dy) layout units. */
export function pan(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, x: cam.x + dx, y: cam.y + dy };
}

/** The scale at which `fontPx`-unit labels render at `targetPx` px (the zoom ceiling). */
export function kMaxFor(fontPx: number, targetPx = 18): number {
  return targetPx / fontPx;
}

const centerOf = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/**
 * Keep the camera inside `bounds` and its scale inside [kMin, kMax] (kMin defaults to the scale that fits `bounds`).
 * The scale is clamped about the camera's centre; then, on each axis, a camera wider than the bounds is centred on
 * them and a narrower one is slid so it never shows space outside them.
 */
export function clamp(
  cam: Camera,
  bounds: Rect,
  viewport: Viewport,
  kMax: number,
  kMin: number = scaleOf(bounds, viewport),
): Camera {
  const lo = Math.min(kMin, kMax);
  const hi = Math.max(kMin, kMax);
  const k = scaleOf(cam, viewport);
  let c = cam;
  if (k < lo || k > hi) {
    const [cx, cy] = centerOf(cam);
    c = zoomAbout(cam, Math.min(hi, Math.max(lo, k)) / k, cx, cy);
  }
  const axis = (pos: number, size: number, bPos: number, bSize: number) =>
    size >= bSize ? bPos - (size - bSize) / 2 : Math.min(Math.max(pos, bPos), bPos + bSize - size);
  return { x: axis(c.x, c.w, bounds.x, bounds.w), y: axis(c.y, c.h, bounds.y, bounds.h), w: c.w, h: c.h };
}

/**
 * The smallest camera that shows every rect plus `padding` layout units around them, grown to `aspect` (w / h) when
 * given. With no rects the result is the zero rect at the origin.
 */
export function fitToNodes(rects: readonly Rect[], padding: number, aspect?: number): Camera {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const box = { x: x0 - padding, y: y0 - padding, w: x1 - x0 + 2 * padding, h: y1 - y0 + 2 * padding };
  return aspect === undefined ? box : withAspect(box, aspect);
}

/** Grow `box` (never shrink it) to the aspect ratio w / h, keeping its centre. */
export function withAspect(box: Rect, aspect: number): Camera {
  const [cx, cy] = centerOf(box);
  const w = Math.max(box.w, box.h * aspect);
  const h = Math.max(box.h, box.w / aspect);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** `viewBox` attribute value. */
export function viewBoxOf(cam: Camera): string {
  const f = (n: number) => String(Math.round(n * 100) / 100);
  return `${f(cam.x)} ${f(cam.y)} ${f(cam.w)} ${f(cam.h)}`;
}

/** Scale rounded to a tenth, for the `data-k` semantic-zoom attribute; clamped so the CSS buckets stay finite. */
export function kBucket(k: number): number {
  return Math.min(30, Math.max(1, Math.round(k * 10)));
}

/** The `data-k` buckets at which a box `h` layout units tall renders shorter than `minPx`. */
export function shortBuckets(h: number, minPx = 20, maxBucket = 30): number[] {
  const out: number[] = [];
  for (let b = 1; b <= maxBucket; b++) if (h * (b / 10) < minPx) out.push(b);
  return out;
}
