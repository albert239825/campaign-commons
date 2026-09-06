import { test } from "vitest";
import assert from "node:assert/strict";
import {
  clamp,
  fitAll,
  fitToNodes,
  kBucket,
  kMaxFor,
  pan,
  scaleOf,
  shortBuckets,
  toLayoutPoint,
  viewBoxOf,
  withAspect,
  zoomAbout,
  type Camera,
} from "./camera";

const layout = { width: 2250, height: 622 };
const bounds = fitAll(layout);
const viewport = { w: 1300, h: 359.4 }; // 1300 px wide, height follows the layout's aspect

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const sameCam = (a: Camera, b: Camera) => {
  near(a.x, b.x);
  near(a.y, b.y);
  near(a.w, b.w);
  near(a.h, b.h);
};

test("fitAll is the server-rendered viewBox", () => {
  assert.deepEqual(bounds, { x: 0, y: 0, w: 2250, h: 622 });
  assert.equal(viewBoxOf(bounds), "0 0 2250 622");
});

test("scaleOf is px per unit under xMidYMid meet", () => {
  near(scaleOf(bounds, viewport), 1300 / 2250, 1e-6);
  near(scaleOf(bounds, { w: 1300, h: 100 }), 100 / 622);
});

test("toLayoutPoint inverts the letterboxed viewBox mapping", () => {
  // Viewport twice as tall as the camera needs: content is centred with 100 px bands above and below.
  const vp = { w: 1000, h: 400 };
  const cam = { x: 500, y: 100, w: 2000, h: 400 };
  assert.deepEqual(toLayoutPoint(cam, vp, 0, 100), [500, 100]);
  assert.deepEqual(toLayoutPoint(cam, vp, 1000, 300), [2500, 500]);
  assert.deepEqual(toLayoutPoint(cam, vp, 500, 200), [1500, 300]);
});

test("zoomAbout keeps the point under the pointer and multiplies the scale", () => {
  const px = 1700;
  const py = 400;
  const cam = zoomAbout(bounds, 2, px, py);
  near(scaleOf(cam, viewport), 2 * scaleOf(bounds, viewport));
  near((px - cam.x) / cam.w, (px - bounds.x) / bounds.w);
  near((py - cam.y) / cam.h, (py - bounds.y) / bounds.h);
  sameCam(zoomAbout(cam, 0.5, px, py), bounds);
});

test("pan moves the camera and keeps its size", () => {
  assert.deepEqual(pan(bounds, 10, -5), { x: 10, y: -5, w: 2250, h: 622 });
});

test("kMax puts 11-unit labels at 18 px", () => {
  near(kMaxFor(11), 18 / 11);
  near(kMaxFor(11, 11), 1);
});

test("clamp never lets the scale drop below fit", () => {
  const out = zoomAbout(bounds, 0.5, 0, 0);
  sameCam(clamp(out, bounds, viewport, kMaxFor(11)), bounds);
});

test("clamp caps the scale at kMax about the camera centre", () => {
  const kMax = kMaxFor(11);
  const cam = zoomAbout(bounds, 10, 1125, 311);
  const c = clamp(cam, bounds, viewport, kMax);
  near(scaleOf(c, viewport), kMax, 1e-9);
  near(c.x + c.w / 2, 1125);
  near(c.y + c.h / 2, 311);
});

test("clamp slides a zoomed camera back inside the bounds", () => {
  const cam = pan(zoomAbout(bounds, 2, 0, 0), -500, -500);
  const c = clamp(cam, bounds, viewport, kMaxFor(11));
  assert.equal(c.x, 0);
  assert.equal(c.y, 0);
  const far = pan(zoomAbout(bounds, 2, 0, 0), 5000, 5000);
  const f = clamp(far, bounds, viewport, kMaxFor(11));
  near(f.x + f.w, bounds.w);
  near(f.y + f.h, bounds.h);
});

test("clamp leaves an in-bounds camera alone", () => {
  const cam = zoomAbout(bounds, 1.5, 1000, 300);
  sameCam(clamp(cam, bounds, viewport, kMaxFor(11)), cam);
});

test("fitToNodes covers every rect plus padding at the requested aspect", () => {
  const rects = [
    { x: 100, y: 50, w: 210, h: 40 },
    { x: 440, y: 200, w: 210, h: 80 },
  ];
  const cam = fitToNodes(rects, 20, 2);
  near(cam.w / cam.h, 2);
  assert.ok(cam.x <= 80 && cam.x + cam.w >= 670);
  assert.ok(cam.y <= 30 && cam.y + cam.h >= 300);
  // The tight box is 590 × 250; aspect 2 grows the height, centred.
  near(cam.w, 590);
  near(cam.h, 295);
  near(cam.y + cam.h / 2, 165);
  assert.deepEqual(fitToNodes([], 20, 2), { x: 0, y: 0, w: 0, h: 0 });
});

test("withAspect only grows", () => {
  const wide = withAspect({ x: 0, y: 0, w: 100, h: 10 }, 1);
  assert.deepEqual(wide, { x: 0, y: -45, w: 100, h: 100 });
  const tall = withAspect({ x: 0, y: 0, w: 10, h: 100 }, 1);
  assert.deepEqual(tall, { x: -45, y: 0, w: 100, h: 100 });
});

test("semantic zoom buckets", () => {
  assert.equal(kBucket(0.578), 6);
  assert.equal(kBucket(1), 10);
  assert.equal(kBucket(1.636), 16);
  // A 28-unit box is shorter than 20 px while k < 0.714.
  assert.deepEqual(shortBuckets(28), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(shortBuckets(58), [1, 2, 3]);
  assert.deepEqual(shortBuckets(400), []);
});
