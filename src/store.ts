import { MemorySessionStorage } from "./toolkit/session/memory.js";
import type { StorageAdapter } from "grammy";

// --- Data types (durable domain data — must survive a restart) ---

export interface BookingRecord {
  guestName: string;
  phone?: string;
  partySize: number;
  date: string;
  timeSlot: string;
  tableAllocation: string;
  status: "confirmed" | "cancelled" | "no_show" | "completed";
  referenceCode: string;
  createdAt: number;
  userId: number;
  chatId: number;
  reminderSent?: boolean;
}

export interface TableConfig {
  totalTablesBySize: Record<number, number>;
  sittingDurationMinutes: number;
  openingHours: Record<string, { open: string; close: string }>;
  timezone: string;
}

export interface OwnerSettings {
  requirePhone: boolean;
  reminderLeadTimeMinutes: number;
  ownerChatId: number;
}

// --- Stores ---

function createStore<T>(): StorageAdapter<T> {
  return new MemorySessionStorage<T>();
}

export const bookingStore = createStore<BookingRecord>();
export const tableConfigStore = createStore<TableConfig>();
export const ownerSettingsStore = createStore<OwnerSettings>();
export const userBookingsIndex = createStore<string[]>();
export const dateBookingsIndex = createStore<string[]>();

// --- Defaults ---

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  totalTablesBySize: { 2: 4, 4: 3, 6: 2 },
  sittingDurationMinutes: 90,
  openingHours: {
    Monday: { open: "11:00", close: "22:00" },
    Tuesday: { open: "11:00", close: "22:00" },
    Wednesday: { open: "11:00", close: "22:00" },
    Thursday: { open: "11:00", close: "22:00" },
    Friday: { open: "11:00", close: "23:00" },
    Saturday: { open: "10:00", close: "23:00" },
    Sunday: { open: "10:00", close: "21:00" },
  },
  timezone: "UTC",
};

export const DEFAULT_OWNER_SETTINGS: OwnerSettings = {
  requirePhone: false,
  reminderLeadTimeMinutes: 60,
  ownerChatId: 0,
};

// --- Helpers ---

export async function getTableConfig(): Promise<TableConfig> {
  return (await tableConfigStore.read("default")) ?? DEFAULT_TABLE_CONFIG;
}

export async function getOwnerSettings(): Promise<OwnerSettings> {
  return (await ownerSettingsStore.read("default")) ?? DEFAULT_OWNER_SETTINGS;
}

export function generateRefCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateTimeSlots(config: TableConfig, date: string): string[] {
  const dayOfWeek = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: config.timezone,
  });
  const hours = config.openingHours[dayOfWeek];
  if (!hours) return [];

  const slots: string[] = [];
  const [openH, openM] = hours.open.split(":").map(Number);
  const [closeH, closeM] = hours.close.split(":").map(Number);

  let current = openH * 60 + openM;
  const close = closeH * 60 + closeM;

  while (current + config.sittingDurationMinutes <= close) {
    const h = Math.floor(current / 60);
    const m = current % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    current += 30;
  }

  return slots;
}

export async function getBookingsForDate(date: string): Promise<BookingRecord[]> {
  const refs = (await dateBookingsIndex.read(date)) ?? [];
  const bookings: BookingRecord[] = [];
  for (const ref of refs) {
    const b = await bookingStore.read(ref);
    if (b && b.status === "confirmed") bookings.push(b);
  }
  return bookings;
}

export async function getAvailableSlots(
  date: string,
  partySize: number,
): Promise<string[]> {
  const config = await getTableConfig();
  const allSlots = generateTimeSlots(config, date);
  const bookings = await getBookingsForDate(date);

  return allSlots.filter((slot) => {
    const [slotH, slotM] = slot.split(":").map(Number);
    const slotStart = slotH * 60 + slotM;
    const slotEnd = slotStart + config.sittingDurationMinutes;

    for (const booking of bookings) {
      if (booking.partySize > partySize) continue;
      const [bookH, bookM] = booking.timeSlot.split(":").map(Number);
      const bookStart = bookH * 60 + bookM;
      const bookEnd = bookStart + config.sittingDurationMinutes;

      if (slotStart < bookEnd && slotEnd > bookStart) {
        return false;
      }
    }
    return true;
  });
}

export async function createBookingRecord(
  booking: BookingRecord,
): Promise<void> {
  await bookingStore.write(booking.referenceCode, booking);

  const userBookings =
    (await userBookingsIndex.read(String(booking.userId))) ?? [];
  userBookings.push(booking.referenceCode);
  await userBookingsIndex.write(String(booking.userId), userBookings);

  const dateBookings =
    (await dateBookingsIndex.read(booking.date)) ?? [];
  dateBookings.push(booking.referenceCode);
  await dateBookingsIndex.write(booking.date, dateBookings);
}

export async function getBookingsByUser(
  userId: number,
): Promise<BookingRecord[]> {
  const refs = (await userBookingsIndex.read(String(userId))) ?? [];
  const bookings: BookingRecord[] = [];
  for (const ref of refs) {
    const b = await bookingStore.read(ref);
    if (b && b.status === "confirmed") bookings.push(b);
  }
  return bookings;
}

export async function isOwner(userId: number): Promise<boolean> {
  const settings = await getOwnerSettings();
  if (settings.ownerChatId && settings.ownerChatId !== 0) {
    return userId === settings.ownerChatId;
  }
  if (typeof process !== "undefined" && process.env?.OWNER_USER_ID) {
    return userId === parseInt(process.env.OWNER_USER_ID);
  }
  return userId === 1;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
