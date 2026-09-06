import { factSentence, type GraphFact } from "./facts";
import type { ExploreCell, ExploreRow } from "./explore";

const MONEY_COLUMN = /amount|total|sum|dollars|spent|gave|raised/i;
const MONEY_RELATIONS = new Set(["GAVE", "PAID", "TARGETED", "CAMPAIGN_OF"]);

export function isMoneyCell(column: string, cell: ExploreCell): boolean {
  return cell.t === "number" && MONEY_COLUMN.test(column);
}

export function formatExploreNumber(value: number, money = false): string {
  return money ? `$${Math.round(value).toLocaleString("en-US")}` : value.toLocaleString("en-US");
}

export function exploreCellText(column: string, cell: ExploreCell): string {
  switch (cell.t) {
    case "node":
      return cell.node.name;
    case "edge":
      return factSentence(cell.fact).replace(/\.$/, "");
    case "number":
      return formatExploreNumber(cell.value, isMoneyCell(column, cell));
    case "text":
      return cell.value;
    case "list":
      return cell.values.join(", ");
    case "null":
      return "—";
  }
}

export function rowSentence(row: ExploreRow): string {
  return Object.entries(row.cells)
    .map(([column, cell]) => {
      if (cell.t === "edge") {
        return `${column}: ${factSentence(cell.fact).replace(/\.$/, "")}`;
      }
      if (cell.t === "number") {
        return `${column}: ${formatExploreNumber(cell.value, MONEY_COLUMN.test(column))}`;
      }
      return `${column}: ${exploreCellText(column, cell)}`;
    })
    .join("; ");
}

export function edgeIsMoney(fact: GraphFact): boolean {
  return MONEY_RELATIONS.has(fact.rel);
}
