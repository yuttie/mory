---
events:
    Past midnight:
        start: 2024-05-03 23:00
        end: '01:00'
    At its own start:
        start: 2024-05-03 09:00
        end: '09:00'
    A month from the 31st:
        start: 2024-01-31 09:00
        end: +1M
    A month and a half:
        start: 2024-01-15 09:00
        end: +1.5M
    A year from a leap day:
        start: 2024-02-29 09:00
        end: +1 year
    More months than a date holds:
        start: 2024-02-29 10:00
        end: +99999999999999999999M
    More years than a date holds:
        start: 2024-02-29 11:00
        end: +99999999999999999999y
    Past the year 9999:
        start: 2024-02-29 12:00
        end: +8000y
    Hours past the year 9999:
        start: 2024-02-29 13:00
        end: +70000000h
    A week and a half:
        start: 2024-04-01 09:00
        end: +1.5w
    Half a day:
        start: 2024-04-02 09:00
        end: +.5d
    An hour and a half:
        start: 2024-04-03 09:00
        end: +1.5h
    A fraction of a millisecond:
        start: 2024-04-03 10:00
        end: +1.5ms
    Seconds:
        start: 2024-04-03 11:00
        end: +90 Seconds
    A long s:
        start: 2024-04-03 12:00
        end: +1 hourſ
    A day across the spring change:
        start: 2024-03-09 12:00
        end: +1d
    Hours across the spring change:
        start: 2024-03-09 12:00
        end: +24h
    Into the hour that is skipped:
        start: 2024-03-10 01:00
        end: '02:30'
    Days on a date:
        start: 2024-05-10
        end: +2d
    Hours on a date:
        start: 2024-05-12
        end: +36h
    A date with an offset end:
        start: 2024-05-14 09:00
        end: 2024-05-14 20:00:00+00:00
    Time of day on a rule:
        start: 2024-05-20 22:00
        end: '01:30'
        repeat:
            freq: daily
            count: 2
    Hours on a rule:
        start: 2024-05-22 09:00
        end: +45m
        repeat:
            freq: daily
            count: 2
    Absolute end on a rule across the autumn change:
        start: 2024-11-02 09:00
        end: 2024-11-02 10:15
        repeat:
            freq: daily
            count: 3
    Whole days on an all-day rule:
        start: 2024-06-01
        end: 2024-06-03
        repeat:
            freq: weekly
            count: 2
    Instances inherit the end as written:
        start: 2024-06-20 09:00
        end: 2024-06-20 10:00
        instances:
            - start: 2024-06-24 09:00
            - start: 2024-06-25 09:00
              end: +30m
    An override's own end:
        start: 2024-07-01 09:00
        end: +1h
        repeat:
            freq: daily
            count: 2
        overrides:
            - at: 2024-07-02 09:00
              end: '12:00'
---

Ends as the calendar draws them: durations in every unit, with fractions, across daylight-saving
changes in the reader's zone, and on dates; times of day, including one past midnight and one at
the start itself; and the ends a rule's occurrences, its overrides and its instances inherit.

And ends that hide their occurrence: a duration longer than a date can reach or than the calendar
can spell the year of, and a unit spelt with a long s, which Unicode's case folding takes for an
`s` and JavaScript's does not.
