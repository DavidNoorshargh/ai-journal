export function todayFieldDate(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function storedDate(field: string): string {
  const trimmed = field.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    return `${match[1]}${match[2]}${match[3]}`;
  }
  if (/^\d{8}$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error("Date must be YYYYMMDD.");
}

export function fieldDate(stored: string): string {
  if (!/^\d{8}$/.test(stored)) {
    return stored;
  }
  return `${stored.slice(0, 4)}-${stored.slice(4, 6)}-${stored.slice(6, 8)}`;
}

export function listDate(stored: string): string {
  const shown = fieldDate(stored);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(shown);
  if (!match) {
    return stored;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
