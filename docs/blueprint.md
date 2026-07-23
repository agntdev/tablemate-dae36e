# Restaurant Reservation Bot — Bot specification

**Archetype:** booking

**Voice:** friendly and professional — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that enables guests to reserve restaurant tables by displaying only genuinely available date/time/party-size slots. Guests receive instant confirmations with reference codes, can reschedule/cancel via inline buttons, and get automated reminders. The owner gets a private view of bookings, remaining capacity, and can mark no-shows.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Restaurant guests seeking quick reservations
- Restaurant owners/managers needing booking oversight

## Success criteria

- Guests can complete reservations with real-time slot availability
- Owner receives all booking updates in private Telegram chat

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu for guests or owner dashboard for admin
- **Book a table** (button, actor: user, callback: booking:start) — Initiates reservation flow
  - inputs: party_size, date, time_slot
  - outputs: confirmation_code, booking_details
- **Reschedule** (button, actor: user, callback: booking:reschedule) — Opens rescheduling options for existing bookings
  - inputs: new_date, new_time_slot
  - outputs: updated_confirmation
- **Cancel booking** (button, actor: user, callback: booking:cancel) — Initiates cancellation flow
  - inputs: confirmation_code
  - outputs: cancellation_status
- **/bookings** (command, actor: owner, command: /bookings) — Displays owner dashboard with upcoming bookings and capacity

## Flows

### Guest reservation flow
_Trigger:_ /start

1. Show main menu
2. Select date via calendar
3. Choose party size
4. Display available time slots
5. Select time slot
6. Request optional guest details
7. Generate confirmation code
8. Show reschedule/cancel buttons

_Data touched:_ booking, table_configuration

### Rescheduling flow
_Trigger:_ booking:reschedule

1. Validate existing booking
2. Select new date
3. Select new time slot
4. Update booking
5. Send old and new confirmation

_Data touched:_ booking

### Cancellation flow
_Trigger:_ booking:cancel

1. Confirm cancellation
2. Update booking status
3. Notify owner

_Data touched:_ booking

### Owner dashboard
_Trigger:_ /bookings

1. Show today's capacity summary
2. List upcoming bookings
3. Allow no-show marking

_Data touched:_ booking, table_configuration

### Reminder flow
_Trigger:_ scheduled_event

1. Send pre-booking reminder
2. Include quick cancel/reschedule buttons

_Data touched:_ booking

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **table_configuration** _(retention: persistent)_ — Restaurant table setup and operating hours
  - fields: total_tables_by_size, sitting_duration_minutes, opening_hours, timezone
- **booking** _(retention: persistent)_ — Reservation records and status tracking
  - fields: guest_name, phone, party_size, date_time_slot, table_allocation, status, reference_code, created_at
- **owner_settings** _(retention: persistent)_ — Restaurant-specific configuration parameters
  - fields: require_phone, reminder_lead_time_minutes

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- /bookings - View today's bookings and capacity
- /capacity - Get current capacity summary
- /settings - Configure phone requirement and reminder timing
- /mark_no_show - Mark a booking as no-show

## Notifications

- Guests receive confirmation with reference code
- Guests get reminder with cancel/reschedule buttons
- Owner notified of all booking changes
- Owner receives daily summary of bookings

## Permissions & privacy

- Guest details stored privately and only accessible via owner view
- All communications occur within Telegram to protect guest data

## Edge cases

- Guest attempts to book outside operating hours
- Overlapping bookings due to simultaneous requests
- No-show marking after sitting duration has passed
- Invalid reference code usage

## Required tests

- End-to-end reservation flow with availability checks
- Owner dashboard updates after booking changes
- Reminder notification timing accuracy
- No-show marking affects capacity calculations

## Assumptions

- Opening hours and table sizes will be configured by owner during setup
- Restaurant operates in a single timezone set by owner
- Default sitting duration of 90 minutes is sufficient for most bookings
