import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getTableConfig,
  getOwnerSettings,
  getAvailableSlots,
  generateRefCode,
  createBookingRecord,
  type BookingRecord,
} from "../store.js";

registerMainMenuItem({
  label: "📅 Book a table",
  data: "booking:start",
  order: 20,
});

const composer = new Composer<Ctx>();

composer.callbackQuery("booking:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const config = await getTableConfig();
  const maxSize = Math.min(
    8,
    Math.max(...Object.keys(config.totalTablesBySize).map(Number)),
  );

  const buttons: { text: string; callback_data: string }[][] = [];
  for (let i = 1; i <= maxSize; i++) {
    buttons.push([inlineButton(String(i), `booking:party:${i}`)]);
  }

  ctx.session.step = "awaiting_party_size";
  await ctx.reply("How many guests?", {
    reply_markup: inlineKeyboard(buttons),
  });
});

composer.callbackQuery(/^booking:party:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const partySize = parseInt(ctx.match[1]);
  ctx.session.bookingFlow = { partySize };
  ctx.session.step = "awaiting_date";

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
    rows.push([inlineButton(label, `booking:date:${dateStr}`)]);
  }

  await ctx.reply("Pick a date:", { reply_markup: inlineKeyboard(rows) });
});

composer.callbackQuery(/^booking:date:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const date = ctx.match[1];
  if (!ctx.session.bookingFlow) return;
  ctx.session.bookingFlow.date = date;
  ctx.session.step = "awaiting_time_slot";

  const slots = await getAvailableSlots(date, ctx.session.bookingFlow.partySize!);

  if (slots.length === 0) {
    await ctx.reply("No available slots for that date. Try another day.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to dates", "booking:start")],
      ]),
    });
    return;
  }

  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < slots.length; i += 3) {
    rows.push(
      slots
        .slice(i, i + 3)
        .map((s) => inlineButton(s, `booking:slot:${s}`)),
    );
  }

  await ctx.reply("Available times:", { reply_markup: inlineKeyboard(rows) });
});

composer.callbackQuery(/^booking:slot:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const timeSlot = ctx.match[1];
  if (!ctx.session.bookingFlow) return;
  ctx.session.bookingFlow.timeSlot = timeSlot;
  ctx.session.step = "awaiting_name";

  await ctx.reply("What name should the booking be under?", {
    reply_markup: {
      force_reply: true,
      input_field_placeholder: "Guest name…",
    },
  });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_name") return next();

  const name = ctx.message.text.trim();
  if (name.length < 2) {
    await ctx.reply("Name too short — try again.");
    return;
  }
  if (!ctx.session.bookingFlow) return;
  ctx.session.bookingFlow.guestName = name;

  const settings = await getOwnerSettings();
  if (settings.requirePhone) {
    ctx.session.step = "awaiting_phone";
    await ctx.reply("Phone number for the reservation?", {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "Phone number…",
      },
    });
  } else {
    await finishBooking(ctx);
  }
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_phone") return next();

  const phone = ctx.message.text.trim();
  if (!ctx.session.bookingFlow) return;
  ctx.session.bookingFlow.phone = phone;

  await finishBooking(ctx);
});

async function finishBooking(ctx: Ctx) {
  const flow = ctx.session.bookingFlow;
  if (!flow?.partySize || !flow.date || !flow.timeSlot || !flow.guestName)
    return;

  const refCode = generateRefCode();
  const config = await getTableConfig();

  const tableSize =
    Object.keys(config.totalTablesBySize)
      .map(Number)
      .filter((s) => s >= flow.partySize!)
      .sort((a, b) => a - b)[0] ?? flow.partySize;

  const booking: BookingRecord = {
    guestName: flow.guestName,
    phone: flow.phone,
    partySize: flow.partySize,
    date: flow.date,
    timeSlot: flow.timeSlot,
    tableAllocation: `Table for ${tableSize}`,
    status: "confirmed",
    referenceCode: refCode,
    createdAt: Date.now(),
    userId: ctx.from!.id,
    chatId: ctx.chat!.id,
  };

  await createBookingRecord(booking);

  ctx.session.bookingFlow = undefined;
  ctx.session.step = undefined;

  await ctx.reply(
    `✅ Booked!\n\n` +
      `Ref: ${refCode}\n` +
      `Name: ${flow.guestName}\n` +
      `Party: ${flow.partySize}\n` +
      `Date: ${flow.date}\n` +
      `Time: ${flow.timeSlot}\n` +
      `${booking.tableAllocation}`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("Reschedule", `booking:reschedule:${refCode}`),
          inlineButton("Cancel", `booking:cancel:${refCode}`),
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
        `📅 New booking\n\nRef: ${refCode}\nName: ${flow.guestName}\nParty: ${flow.partySize}\nDate: ${flow.date}\nTime: ${flow.timeSlot}`,
      );
    } catch {
      // Owner might not have started the bot yet
    }
  }
}

export default composer;
