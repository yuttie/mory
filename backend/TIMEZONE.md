# Timezone Customization

The mory backend now supports timezone customization at container runtime through an environment variable.

## Environment Variable

`MORIED_TIMEZONE_OFFSET` - Sets the timezone offset in seconds that will be used for all timestamps instead of the git commit's original timezone.

## Examples

### UTC (0 seconds offset)
```bash
docker run -e MORIED_TIMEZONE_OFFSET=0 your-mory-image
```

### Eastern Standard Time (-5 hours = -18000 seconds)
```bash
docker run -e MORIED_TIMEZONE_OFFSET=-18000 your-mory-image
```

### Central European Time (+1 hour = 3600 seconds)
```bash
docker run -e MORIED_TIMEZONE_OFFSET=3600 your-mory-image
```

### Pacific Standard Time (-8 hours = -28800 seconds)
```bash
docker run -e MORIED_TIMEZONE_OFFSET=-28800 your-mory-image
```

## Behavior

- **When set**: All file timestamps will use the specified timezone offset instead of the git commit's original timezone
- **When not set**: Uses the original git commit timezone (existing behavior)
- **Invalid values**: Falls back to git commit timezone if the environment variable cannot be parsed as an integer

## Notes

- Positive values are for timezones east of UTC
- Negative values are for timezones west of UTC
- The offset is in seconds, not hours or minutes
- This setting affects how timestamps are stored and displayed for file entries