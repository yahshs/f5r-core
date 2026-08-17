export function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getSupportedTimeZones() {
  const withIntl = (Intl as any).supportedValuesOf;
  if (typeof withIntl === "function") {
    try {
      return withIntl("timeZone") as string[];
    } catch {
      // ignore
    }
  }

  return [
    "Asia/Riyadh",
    "Asia/Dubai",
    "Asia/Kuwait",
    "Asia/Qatar",
    "Africa/Cairo",
    "Europe/Istanbul",
    "Europe/London",
    "UTC",
  ];
}

export function formatInTimeZone(date: Date, timeZone: string, opts?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...opts,
  }).format(date);
}

export function getTimePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

export function isLastDayOfMonthInTimeZone(date: Date, timeZone: string) {
  const current = getTimePartsInTimeZone(date, timeZone);
  const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const next = getTimePartsInTimeZone(nextDay, timeZone);
  return current.month !== next.month;
}
