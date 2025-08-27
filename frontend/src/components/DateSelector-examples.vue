<!-- Example usage of enhanced DateSelector component -->

<!-- Basic date-only picker (default behavior) -->
<DateSelector
  v-model="dateValue"
  label="Select Date"
/>

<!-- Date and time picker -->
<DateSelector
  v-model="dateTimeValue"
  label="Select Date and Time"
  :include-time="true"
/>

<!-- With validation rules -->
<DateSelector
  v-model="scheduledDateTime"
  label="Scheduled DateTime"
  :include-time="true"
  :rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
  required
/>

<!-- 
Supported value formats:
- Date only: "2023-12-25"
- Date with time: "2023-12-25 14:30"
- ISO format: "2023-12-25T14:30" (automatically converted to space format)

When includeTime is false (default):
- Only shows date picker
- Icon is calendar
- Returns date in YYYY-MM-DD format

When includeTime is true:
- Shows both date and time pickers
- Icon changes to clock
- Returns datetime in "YYYY-MM-DD HH:mm" format (with space separator)
- Time picker uses 24-hour format
-->