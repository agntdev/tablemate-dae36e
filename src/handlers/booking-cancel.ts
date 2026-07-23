import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  bookingStore,
  getOwnerSettings,
  type BookingRecord,
} from "../store.js";

const composer = new Composer<Ctx>();

composer.callbackQuery(/^booking:cancel:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ref = ctx.match[1];
  const booking = await bookingStore.read(ref);

  if (!booking || booking.userId !== ctx.from!.id) {
    await ctx.reply("Booking not found. Check the reference code and try again.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  if (booking.status !== "confirmed") {
    await ctx.reply("This booking has already been cancelled or completed.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  await ctx.reply(
    `Cancel this booking?\n\n` +
      `Ref: ${ref}\n` +
      `Name: ${booking.guestName}\n` +
      `Party: ${booking.partySize}\n` +
      `Date: ${booking.date}\n` +
      `Time: ${booking.timeSlot}`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("Yes, cancel it", `booking:cancel_confirm:${ref}`),
          inlineButton("Keep it", `booking:cancel_deny:${ref}`),
        ],
      ]),
    },
  );
});

composer.callbackQuery(/^booking:cancel_confirm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ref = ctx.match[1];
  const booking = await bookingStore.read(ref);

  if (!booking || booking.userId !== ctx.from!.id) {
    await ctx.reply("Booking not found.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const updated: BookingRecord = { ...booking, status: "cancelled" };
  await bookingStore.write(ref, updated);

  await ctx.reply("Booking cancelled.", {
    reply_markup: inlineKeyboard([
      [inlineButton("📅 Book a table", "booking:start")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });

  const settings = await getOwnerSettings();
  if (settings.ownerChatId) {
    try {
      await ctx.api.sendMessage(
        settings.ownerChatId,
        `❌ Booking cancelled\n\nRef: ${ref}\nName: ${booking.guestName}\nParty: ${booking.partySize}\nDate: ${booking.date}\nTime: ${booking.timeSlot}`,
      );
    } catch {
      // Owner might not have started the bot yet
    }
  }
});

composer.callbackQuery(/^booking:cancel_deny:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("No worries — your booking is still confirmed.", {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

export default composer;
