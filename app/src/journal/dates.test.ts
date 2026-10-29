import { fieldDate, listDate, storedDate, todayFieldDate } from "@/journal/dates";

describe("note dates", () => {
  it("defaults the editor to today", () => {
    expect(todayFieldDate(new Date(2026, 9, 29))).toBe("2026-10-29");
  });

  it("stores a field date as YYYYMMDD and shows it back", () => {
    expect(storedDate("2026-10-29")).toBe("20261029");
    expect(storedDate("20261029")).toBe("20261029");
    expect(fieldDate("20261029")).toBe("2026-10-29");
    expect(listDate("20261029")).toBe("29 Oct");
  });

  it("rejects a date that is not a day", () => {
    expect(() => storedDate("29 Oct 2026")).toThrow("Date must be YYYYMMDD.");
  });
});
