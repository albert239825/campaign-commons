/** Spend guard for /api/ask-graph: two model calls and a graph query per ask, so a tighter bucket than the router's (D-75 caveats apply). */
import { AskLimiter } from "../ask-limits";

export const GRAPH_RATE_PER_MINUTE = 6;
export const GRAPH_MAX_IN_FLIGHT = 2;
export const graphLimiter = new AskLimiter(GRAPH_RATE_PER_MINUTE, GRAPH_MAX_IN_FLIGHT);
