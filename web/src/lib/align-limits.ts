import { AskLimiter } from "./ask-limits";

export const ALIGN_RATE_PER_MINUTE = 6;
export const ALIGN_MAX_IN_FLIGHT = 2;
export const alignLimiter = new AskLimiter(ALIGN_RATE_PER_MINUTE, ALIGN_MAX_IN_FLIGHT);
