import { z } from "zod";
import { IssueIdSchema } from "@citizen-gotham/contracts";

export const OpinionSchema = z.number().int().min(1).max(5);
export const ImportanceSchema = z.number().int().min(1).max(3);
export const UserPrefsSchema = z.object({
  version: z.literal(1),
  state: z.string().length(2).nullable(),
  opinions: z.record(IssueIdSchema, OpinionSchema).default({}),
  importance: z.record(IssueIdSchema, ImportanceSchema).default({}),
  statement_weight: z.number().min(0).max(1).default(0.5),
});
export type UserPrefs = z.infer<typeof UserPrefsSchema>;
export const EMPTY_PREFS: UserPrefs = { version: 1, state: null, opinions: {}, importance: {}, statement_weight: 0.5 };
export const PREFS_KEY = "citizen-gotham:prefs:v1";

export function loadPrefs(): UserPrefs {
  if (typeof window === "undefined") return EMPTY_PREFS;
  const raw = window.localStorage.getItem(PREFS_KEY);
  if (!raw) return EMPTY_PREFS;
  try {
    const parsed = UserPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_PREFS;
  } catch {
    return EMPTY_PREFS;
  }
}

export function savePrefs(p: UserPrefs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}
