<!-- Example usage of enhanced DateSelector component -->

<!-- Basic date picker with user-controlled time toggle -->
<DateSelector
  v-model="dateValue"
  label="Select Date"
/>

<!-- Date picker with initial time enabled (users can still toggle it off) -->
<DateSelector
  v-model="dateTimeValue"
  label="Select Date and Time"
  :include-time="true"
/>

<!-- With validation rules -->
<DateSelector
  v-model="scheduledDateTime"
  label="Scheduled DateTime"
  :rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
  required
/>

<!-- 
Key Features:
- Users can enable/disable time selection using the "Include time" toggle in the picker menu
- The icon changes automatically: calendar for date-only, clock when time is included
- Menu behavior adapts: closes after date selection when time is disabled, after time selection when enabled

Supported value formats:
- Date only: "2023-12-25"
- Date with time: "2023-12-25 14:30"
- ISO format: "2023-12-25T14:30" (automatically converted to space format)

When time is disabled by user:
- Shows only date picker
- Icon displays calendar
- Returns date in YYYY-MM-DD format
- Menu closes after date selection

When time is enabled by user:
- Shows both date and time pickers
- Icon changes to clock
- Returns datetime in "YYYY-MM-DD HH:mm" format (with space separator)
- Time picker uses 24-hour format
- Menu closes after time selection

The includeTime prop can be used to set the initial state, but users have full control via the UI toggle.
-->