import { money } from "@/lib/format";
import type { VisibleNode } from "./view";

/**
 * Label fitting for node boxes. The picture is a static SVG scaled with the viewport, so widths are estimated from
 * per-glyph advances (Arial Bold, the detail-page fallback face, in 1/1000 em) rather than measured after render.
 * Estimates run a few percent wide on purpose: a label that stops short is fine, one that overflows its box is not.
 */

const ADVANCE: Record<string, number> = {
  " ": 278, "!": 333, '"': 474, "#": 556, "$": 556, "%": 889, "&": 722, "'": 238, "(": 333, ")": 333, "*": 389,
  "+": 584, ",": 278, "-": 333, ".": 278, "/": 278, ":": 333, ";": 333, "=": 584, "?": 611, "@": 975, "~": 584,
  "·": 278, "→": 1000, "…": 1000,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
};
const DIGIT = 556;
const OTHER = 650;
const SAFETY = 1.04;

export function textWidth(s: string, fontSize: number): number {
  let em = 0;
  for (const ch of s) em += ch >= "0" && ch <= "9" ? DIGIT : (ADVANCE[ch] ?? OTHER);
  return (em / 1000) * fontSize * SAFETY;
}

/** Cut `s` to the widest prefix (plus an ellipsis) that fits `maxWidth`; whole when it already fits. */
export function ellipsize(s: string, maxWidth: number, fontSize: number): string {
  if (textWidth(s, fontSize) <= maxWidth) return s;
  const ell = textWidth("…", fontSize);
  let out = "";
  for (const ch of s) {
    if (textWidth(out + ch, fontSize) + ell > maxWidth) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Greedy word wrap of `s` into at most `budgets.length` lines, line i no wider than budgets[i]; the last line is
 * ellipsized when the text runs on. Lines are never empty unless `s` is.
 */
export function fitLines(s: string, budgets: number[], fontSize: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < budgets.length) {
    const budget = budgets[lines.length];
    const last = lines.length === budgets.length - 1;
    let line = words[i];
    i += 1;
    while (i < words.length && textWidth(`${line} ${words[i]}`, fontSize) <= budget) {
      line = `${line} ${words[i]}`;
      i += 1;
    }
    if (last && i < words.length) line = ellipsize(`${line} ${words.slice(i).join(" ")}`, budget, fontSize);
    else if (textWidth(line, fontSize) > budget) {
      // a single word wider than the line: cut it, unless a later line can take the overflow
      line = ellipsize(line, budget, fontSize);
    }
    lines.push(line);
  }
  return lines;
}

export const isRootNode = (n: Pick<VisibleNode, "side" | "depth">) => n.side === "in" && n.depth === 0;

/** Whether the box carries a +/− control (spending side: has children; funding side: sources it can show or fold). */
export function isTogglable(n: VisibleNode): boolean {
  if (n.side === "out") return n.children > 0;
  return !isRootNode(n) && (n.state === "closed" || n.state === "partial" || n.userOpened);
}

/** The dollar figure printed in the box. Spend-range midpoints and folded-ad totals are marked approximate. */
export function amountText(n: VisibleNode): string {
  return n.kind === "ad" || (n.side === "out" && n.kind === "aggregate") ? `~${money(n.amount_in)}` : money(n.amount_in);
}

export const NAME_FONT = 11;
export const SUB_FONT = 10;
/** Inner geometry shared by the layout (which needs to know how tall a label is) and the box renderer. */
export const TEXT_X = 10;
export const TEXT_RIGHT = 8;
export const TOGGLE_W = 22;
export const AMOUNT_GAP = 8;
export const THUMB_W = 64;
/** Boxes at least this tall stack the name above its sub-label and print the amount on its own row at the bottom. */
export const TWO_ROW_H = 42;

/** Width the name may take in a box that has a single text row (name and amount side by side). */
export function oneRowNameBudget(n: VisibleNode, nodeW: number): number {
  return nodeW - TEXT_X - TEXT_RIGHT - textWidth(amountText(n), NAME_FONT) - AMOUNT_GAP - (isTogglable(n) ? TOGGLE_W : 0);
}

export const nameFitsOneRow = (n: VisibleNode, nodeW: number) =>
  textWidth(n.name, NAME_FONT) <= oneRowNameBudget(n, nodeW);
