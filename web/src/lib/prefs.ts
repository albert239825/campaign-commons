import { z } from "zod";
import { IssueIdSchema } from "@campaign-commons/contracts";

export const OpinionSchema = z.number().int().min(1).max(5);
export const ImportanceSchema = z.number().int().min(1).max(3);
export const UserPrefsSchema = z.object({
  version: z.literal(1),
  state: z.string().length(2).nullable(),
  opinions: z.record(IssueIdSchema, OpinionSchema).default({}),
  importance: z.record(IssueIdSchema, ImportanceSchema).default({}),
});
export type UserPrefs = z.infer<typeof UserPrefsSchema>;
export const EMPTY_PREFS: UserPrefs = { version: 1, state: null, opinions: {}, importance: {} };
export const PREFS_KEY = "citizen-gotham:prefs:v1";

export function loadPrefs(): UserPrefs {
  if (typeof window === "undefined") return EMPTY_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return EMPTY_PREFS;
    const parsed = UserPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_PREFS;
  } catch {
    return EMPTY_PREFS;
  }
}

export function savePrefs(p: UserPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Keep the in-memory preferences usable when browser storage is blocked.
  }
}
