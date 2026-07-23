import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  bookingStore,
  getAvailableSlots,
  getOwnerSettings,
  type BookingRecord,
} from "../store.js";

const composer = new Composer<Ctx>();

composer.callbackQuery(/^booking:reschedule:(.+)$/, async (ctx) => {
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

  ctx.session.rescheduleFlow = { bookingRef: ref };
  ctx.session.step = "reschedule_awaiting_date";

  const today = new Date();
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().split("T")[0]!;
    const label =
      i === 0
        ? "Today"
        : i === 1
          ? "Tomorrow"
          : d.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
    rows.push([inlineButton(label, `reschedule:date:${dateStr}`)]);
  }

  await ctx.reply("Pick a new date:", { reply_markup: inlineKeyboard(rows) });
});

composer.callbackQuery(/^reschedule:date:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const date = ctx.match[1];
  if (!ctx.session.rescheduleFlow) return;

  const booking = await bookingStore.read(ctx.session.rescheduleFlow.bookingRef!);
  if (!booking) return;

  ctx.session.rescheduleFlow.newDate = date;
  ctx.session.step = "reschedule_awaiting_time";

  const slots = await getAvailableSlots(date, booking.partySize);

  if (slots.length === 0) {
    await ctx.reply("No available slots for that date. Try another day.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to dates", `booking:reschedule:${ctx.session.rescheduleFlow.bookingRef}`)],
      ]),
    });
    return;
  }

  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < slots.length; i += 3) {
    rows.push(
      slots
        .slice(i, i + 3)
        .map((s) => inlineButton(s, `reschedule:slot:${s}`)),
    );
  }

  await ctx.reply("Pick a new time:", { reply_markup: inlineKeyboard(rows) });
});

composer.callbackQuery(/^reschedule:slot:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const newTime = ctx.match[1];
  if (!ctx.session.rescheduleFlow) return;

  const ref = ctx.session.rescheduleFlow.bookingRef!;
  const newDate = ctx.session.rescheduleFlow.newDate!;
  const booking = await bookingStore.read(ref);

  if (!booking) return;

  const oldDate = booking.date;
  const oldTime = booking.timeSlot;

  const updated: BookingRecord = {
    ...booking,
    date: newDate,
    timeSlot: newTime,
  };
  await bookingStore.write(ref, updated);

  ctx.session.rescheduleFlow = undefined;
  ctx.session.step = undefined;

  await ctx.reply(
    `✅ Rescheduled!\n\n` +
      `Ref: ${ref}\n` +
      `Was: ${oldDate} at ${oldTime}\n` +
      `Now: ${newDate} at ${newTime}`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("Reschedule", `booking:reschedule:${ref}`),
          inlineButton("Cancel", `booking:cancel:${ref}`),
        ],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );

  const settings = await getOwnerSettings();
  if (settings.ownerChatId) {
    try {
      await ctx.api.sendMessage(
        settings.ownerChatId,
        `🔄 Booking rescheduled\n\nRef: ${ref}\nName: ${booking.guestName}\nWas: ${oldDate} at ${oldTime}\nNow: ${newDate} at ${newTime}`,
      );
    } catch {
      // Owner might not have started the bot yet
    }
  }
});

export default composer;
