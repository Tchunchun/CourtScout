const COLUMN_ALIASES = Object.freeze({
  matchId: ["match id", "matchid", "id", "source id"],
  opponent: ["opponent", "opponent team", "team", "team name"],
  date: ["date", "match date"],
  time: ["time", "match time"],
  location: ["location", "site", "courts", "venue"],
  round: ["round", "flight", "pool"],
  designation: ["home away", "home/away", "designation", "side"],
  status: ["status", "match status"],
  opponentUrl: ["opponent url", "team url", "tennisrecord url"]
});

function normalizedHeader(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  if (!rows.length) throw new Error("CSV file is empty.");
  const width = Math.max(...rows.map(item => item.length));
  return rows.map(item => [
    ...item,
    ...Array.from({ length: width - item.length }, () => "")
  ]);
}

export function suggestScheduleColumns(headers) {
  const normalized = headers.map(normalizedHeader);
  return Object.fromEntries(Object.entries(COLUMN_ALIASES).map(
    ([field, aliases]) => [
      field,
      normalized.findIndex(header => aliases.includes(header))
    ]
  ));
}

function normalizeDate(value) {
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return text;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function mappedValue(row, index) {
  return index >= 0 ? row[index]?.trim() ?? "" : "";
}

export function scheduleRowsFromCsv(rows, mapping) {
  return rows.slice(1).map((row, index) => {
    const opponent = mappedValue(row, mapping.opponent);
    const date = normalizeDate(mappedValue(row, mapping.date));
    const designationText = mappedValue(row, mapping.designation)
      .toLocaleLowerCase();
    const designation = ["home", "away", "neutral"].includes(designationText)
      ? designationText
      : "unknown";
    const statusText = mappedValue(row, mapping.status).toLocaleLowerCase();
    const status = ["scheduled", "postponed", "completed", "cancelled"]
      .includes(statusText)
      ? statusText
      : "scheduled";
    const errors = [];
    if (!opponent) errors.push("Opponent is required.");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push("Date must use YYYY-MM-DD or MM/DD/YYYY.");
    }
    return {
      rowNumber: index + 2,
      included: true,
      sourceOpponentName: opponent,
      sourceMatchId: mappedValue(row, mapping.matchId) ||
        `csv-row:${index + 2}`,
      sourceOpponentUrl: mappedValue(row, mapping.opponentUrl) || null,
      date,
      time: mappedValue(row, mapping.time) || null,
      timezone: null,
      round: mappedValue(row, mapping.round) || null,
      site: mappedValue(row, mapping.location) || null,
      designation,
      status,
      sourceType: "csv",
      sourceReference: null,
      errors
    };
  });
}
