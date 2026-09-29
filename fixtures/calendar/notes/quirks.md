---
events:
    Empty end on a start:
        start: 2024-05-01 09:00
        end:
    Empty end on instances:
        end:
        instances:
            - start: 2024-05-02 09:00
    Empty end on a rule:
        start: 2024-05-03 09:00
        end:
        repeat:
            freq: daily
            count: 2
    Numeric name:
        start: 2024-05-04 09:00
        name: 5
    Blank name:
        start: 2024-05-04 10:00
        name: ''
    Numeric colour:
        start: 2024-05-04 11:00
        color: 5
    Durations:
        start: 2024-05-05 09:00
        end: +90m
    Long duration:
        start: 2024-05-05 10:00
        end: +2 hours
    Time of day:
        start: 2024-05-05 11:00
        end: '12:00'
    Unreadable end:
        start: 2024-05-05 12:00
        end: soon
    Absolute end on a rule:
        start: 2024-05-06 09:00
        end: 2024-05-06 10:00
        repeat:
            freq: daily
            count: 2
    Rule without a mapping:
        start: 2024-05-07 09:00
        repeat:
    Unknown frequency:
        start: 2024-05-07 10:00
        repeat:
            freq: hourly
    Ordinal under weekly:
        start: 2024-05-07 11:00
        repeat:
            freq: weekly
            byday: [2mon]
    Unknown zone:
        start: 2024-05-07 12:00
        repeat:
            freq: daily
            count: 2
            tz: Mars/Olympus_Mons
    Instances in a null:
        instances:
        times:
            - start: 2024-05-08 09:00
    Finished:
        start: 2024-05-09 09:00
        finished: true
    Renamed overrides keep no series name:
        start: 2024-05-10 09:00
        name: Ignored on a rule
        repeat:
            freq: daily
            count: 2
---

# Quirks
