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
    Day out of range with an offset:
        start: 2024-01-32 10:00+09:00
    Date with an offset:
        start: 2024-05-12+09:00
    Date with Z:
        start: 2024-05-13Z
    End of the day with an offset:
        start: 2024-05-14 24:00+09:00
    Until that does not parse:
        start: 2024-04-28 20:00
        repeat:
            freq: daily
            tz: Asia/Tokyo
            until: 2024-04-32 12:00:00+00:00
    Week start named as no weekday:
        start: 2024-05-05 09:00
        repeat:
            freq: weekly
            interval: 2
            byday: [sun, mon]
            wkst: toString
            count: 4
    Start the calendar cannot read:
        start: 2024/08/13 11:00
    Start only Date reads:
        start: August 12, 2024 10:00
    End only Date reads:
        start: 2024-09-17 10:00
        end: September 17, 2024 11:00
    End in American order:
        start: 2024-09-19 10:00
        end: 9/19/2024 11:00
    End the calendar cannot read:
        start: 2024-09-20 10:00
        end: 2024/09/20 11:00
    True as an end:
        start: 2024-09-21 10:00
        end: true
    Number as an end:
        start: 2024-09-22 10:00
        end: 90
    Duration without a number:
        start: 2024-09-23 10:00
        end: +.h
    Time of day with a fraction:
        start: 2024-09-24 10:00
        end: '11:30.5'
    Time of day Date reads as a year:
        start: 2024-09-25 10:00
        end: '11'
    Start with a space after it:
        start: '2024-09-26 10:00 '
    Exclusions only Date reads:
        start: 2024-10-21 10:00
        repeat:
            freq: daily
            count: 6
        exclusions:
            - October 22, 2024 10:00
            - 10/26/2024 10:00
            - 2024-10-23 10:00
    Override only Date reads:
        start: 2024-10-28 10:00
        repeat:
            freq: daily
            count: 2
        overrides:
            - at: October 29, 2024 10:00
              start: 2024-10-29 15:00
    Day past its month's end with an offset:
        start: 2024-02-30 10:00+09:00
---

# Quirks
