import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getTableConfig,
  getOwnerSettings,
  getBookingsForDate,
  getBookingsByUser,
  bookingStore,
  ownerSettingsStore,
  tableConfigStore,
  isOwner,
  formatDate,
  type BookingRecord,
  type OwnerSettings,
  type TableConfig,
} from "../store.js";

const composer = new Composer<Ctx>();

function todayStr(): string {
  return new Date().toISOString().split("T")[0]!;
}

composer.command("bookings", async (ctx) => {
  if (!(await isOwner(ctx.from!.id))) {
    await ctx.reply("This command is for the restaurant owner only.");
    return;
  }

  const date = todayStr();
  const bookings = await getBookingsForDate(date);
  const config = await getTableConfig();

  const totalTables = Object.values(config.totalTablesBySize).reduce(
    (a, b) => a + b,
    0,
  );
  const totalSeats = Object.entries(config.totalTablesBySize).reduce(
    (a, [size, count]) => a + Number(size) * count,
    0,
  );
  const bookedSeats = bookings.reduce((a, b) => a + b.partySize, 0);

  let text = `📋 Today's bookings (${formatDate(date)})\n\n`;
  text += `Capacity: ${bookedSeats}/${totalSeats} seats booked\n`;
  text += `Tables: ${bookings.length} active reservations\n\n`;

  if (bookings.length === 0) {
    text += "No bookings today.";
  } else {
    for (const b of bookings) {
      text += `• ${b.timeSlot} — ${b.guestName} (${b.partySize}) ref:${b.referenceCode}\n`;
    }
  }

  await ctx.reply(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("📊 Capacity", "owner:capacity")],
      [inlineButton("⚙️ Settings", "owner:settings")],
      [inlineButton("🚫 Mark no-show", "owner:mark_no_show")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.command("capacity", async (ctx) => {
  if (!(await isOwner(ctx.from!.id))) {
    await ctx.reply("This command is for the restaurant owner only.");
    return;
  }

  await showCapacity(ctx);
});

composer.command("settings", async (ctx) => {
  if (!(await isOwner(ctx.from!.id))) {
    await ctx.reply("This command is for the restaurant owner only.");
    return;
  }

  await showSettings(ctx);
});

composer.command("mark_no_show", async (ctx) => {
  if (!(await isOwner(ctx.from!.id))) {
    await ctx.reply("This command is for the restaurant owner only.");
    return;
  }

  await showNoShowList(ctx);
});

composer.callbackQuery("owner:capacity", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from!.id))) return;
  await showCapacity(ctx);
});

composer.callbackQuery("owner:settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from!.id))) return;
  await showSettings(ctx);
});

composer.callbackQuery("owner:mark_no_show", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from!.id))) return;
  await showNoShowList(ctx);
});

composer.callbackQuery(/^owner:toggle_phone$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from!.id))) return;

  const settings = await getOwnerSettings();
  const updated: OwnerSettings = {
    ...settings,
    requirePhone: !settings.requirePhone,
  };
  await ownerSettingsStore.write("default", updated);

  await showSettings(ctx);
});

composer.callbackQuery(/^owner:set_reminder:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from!.id))) return;

  const minutes = parseInt(ctx.match[1]);
  const settings = await getOwnerSettings();
  const updated: OwnerSettings = {
    ...settings,
    reminderLeadTimeMinutes: minutes,
  };
  await ownerSettingsStore.write("default", updated);

  await showSettings(ctx);
});

composer.callbackQuery(/^owner:set_owner:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from!.id))) return;

  const chatId = parseInt(ctx.match[1]);
  const settings = await getOwnerSettings();
  const updated: OwnerSettings = { ...settings, ownerChatId: chatId };
  await ownerSettingsStore.write("default", updated);

  await ctx.reply("Owner chat ID updated.", {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to settings", "owner:settings")],
    ]),
  });
});

composer.callbackQuery(/^owner:no_show:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isOwner(ctx.from!.id))) return;

  const ref = ctx.match[1];
  const booking = await bookingStore.read(ref);

  if (!booking || booking.status !== "confirmed") {
    await ctx.reply("Booking not found or already processed.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const updated: BookingRecord = { ...booking, status: "no_show" };
  await bookingStore.write(ref, updated);

  await ctx.reply(`Marked ${booking.guestName} (${ref}) as no-show.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("🚫 Mark another", "owner:mark_no_show")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

async function showCapacity(ctx: Ctx) {
  const date = todayStr();
  const bookings = await getBookingsForDate(date);
  const config = await getTableConfig();

  const totalSeats = Object.entries(config.totalTablesBySize).reduce(
    (a, [size, count]) => a + Number(size) * count,
    0,
  );
  const bookedSeats = bookings.reduce((a, b) => a + b.partySize, 0);
  const available = totalSeats - bookedSeats;

  let text = `📊 Capacity for ${formatDate(date)}\n\n`;
  text += `Total seats: ${totalSeats}\n`;
  text += `Booked: ${bookedSeats}\n`;
  text += `Available: ${available}\n\n`;

  text += `Tables:\n`;
  for (const [size, count] of Object.entries(config.totalTablesBySize)) {
    const booked = bookings.filter((b) => b.partySize <= Number(size)).length;
    text += `• ${size}-top: ${count} total\n`;
  }

  await ctx.reply(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to dashboard", "owner:dashboard")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
}

async function showSettings(ctx: Ctx) {
  const settings = await getOwnerSettings();
  const config = await getTableConfig();

  let text = `⚙️ Settings\n\n`;
  text += `Require phone: ${settings.requirePhone ? "Yes" : "No"}\n`;
  text += `Reminder: ${settings.reminderLeadTimeMinutes} min before\n`;
  text += `Sitting duration: ${config.sittingDurationMinutes} min\n`;
  text += `Timezone: ${config.timezone}\n`;

  const rows: { text: string; callback_data: string }[][] = [
    [
      inlineButton(
        settings.requirePhone ? "📱 Phone: ON" : "📱 Phone: OFF",
        "owner:toggle_phone",
      ),
    ],
    [
      inlineButton("30 min", "owner:set_reminder:30"),
      inlineButton("60 min", "owner:set_reminder:60"),
      inlineButton("90 min", "owner:set_reminder:90"),
    ],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ];

  await ctx.reply(text, { reply_markup: inlineKeyboard(rows) });
}

async function showNoShowList(ctx: Ctx) {
  const date = todayStr();
  const bookings = await getBookingsForDate(date);

  if (bookings.length === 0) {
    await ctx.reply("No active bookings today to mark as no-show.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  let text = `🚫 Tap to mark as no-show:\n\n`;
  const rows: { text: string; callback_data: string }[][] = [];

  for (const b of bookings) {
    rows.push([
      inlineButton(
        `${b.timeSlot} ${b.guestName} (${b.partySize})`,
        `owner:no_show:${b.referenceCode}`,
      ),
    ]);
  }

  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.reply(text, { reply_markup: inlineKeyboard(rows) });
}

export default composer;
