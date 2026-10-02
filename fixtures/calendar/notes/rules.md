---
events:
    Daily with count:
        start: 2024-05-06 09:00
        repeat:
            freq: daily
            count: 5
        exclusions:
            - 2024-05-07 09:00
            - 2024-05-08 09:00:00-07:00
        overrides:
            - at: 2024-05-09 09:00
              start: 2024-05-09 11:30
              name: Moved and renamed
            - at: 2024-05-10 09:00
              location: Room 2
    Every other Tuesday and Thursday:
        start: 2024-01-02 18:00
        repeat:
            freq: weekly
            interval: 2
            byday: [tue, thu]
            wkst: sun
            until: 2024-03-01
    Third Wednesday:
        start: 2024-01-17 12:00
        repeat:
            freq: monthly
            byday: [3wed]
            count: 6
    Last Friday:
        start: 2024-01-26 17:00
        repeat:
            freq: monthly
            byday: [-1fri]
            until: 2024-06-30 23:00
    Last day of the month:
        start: 2024-01-31 08:00
        repeat:
            freq: monthly
            bymonthday: [-1]
            count: 5
    The 31st:
        start: 2024-01-31 08:00
        repeat:
            freq: monthly
            bymonthday: [31]
            count: 4
    Twice a year:
        start: 2020-03-15 10:00
        repeat:
            freq: yearly
            bymonth: [3, 9]
            until: 2025-12-31
    Moved across a week:
        start: 2024-06-03 10:00
        repeat:
            freq: weekly
            count: 3
        overrides:
            - at: 2024-06-10 10:00
              start: 2024-06-15 16:00
    Null parts:
        start: 2024-07-01 07:00
        repeat:
            freq: monthly
            bymonthday: null
            bymonth: null
            count: null
            until: 2024-09-30
    Start off the rule:
        start: 2024-08-01 09:00
        repeat:
            freq: weekly
            byday: [mon]
            count: 2
    A month day, not a list:
        start: 2024-07-15 08:00
        repeat:
            freq: monthly
            bymonthday: 15
            count: 3
    A month, not a list:
        start: 2024-07-04 08:00
        repeat:
            freq: yearly
            bymonth: 7
            count: 2
    An empty weekday list:
        start: 2024-10-06 08:00
        repeat:
            freq: monthly
            byday: []
            count: 3
    An empty month day list:
        start: 2024-10-07 08:00
        repeat:
            freq: monthly
            bymonthday: []
            count: 3
    An empty month list:
        start: 2024-10-08 08:00
        repeat:
            freq: yearly
            bymonth: []
            count: 2
    A weekday, not a list:
        start: 2024-10-14 08:00
        repeat:
            freq: weekly
            byday: wed
            count: 2
    An ordinal weekday, not a list:
        start: 2024-10-14 09:00
        repeat:
            freq: monthly
            byday: 3wed
            count: 2
    A null weekday list:
        start: 2024-10-14 10:00
        repeat:
            freq: weekly
            byday:
            count: 2
    A blank interval is none:
        start: 2024-10-15 08:00
        repeat:
            freq: weekly
            interval:
            count: 2
    An interval of one:
        start: 2024-10-15 09:00
        repeat:
            freq: weekly
            interval: 1
            count: 2
    An interval that is zero is no rule:
        start: 2024-10-15 10:00
        repeat:
            freq: weekly
            interval: 0
            count: 2
    An interval that is negative is no rule:
        start: 2024-10-15 11:00
        repeat:
            freq: weekly
            interval: -1
            count: 2
    An interval that is text is no rule:
        start: 2024-10-15 12:00
        repeat:
            freq: weekly
            interval: twice
            count: 2
    An interval that is not whole is no rule:
        start: 2024-10-15 13:00
        repeat:
            freq: weekly
            interval: 1.5
            count: 2
    An interval too large is no rule:
        start: 2024-10-15 14:00
        repeat:
            freq: weekly
            interval: 70000
            count: 2
    The largest interval:
        start: 2024-10-15 15:00
        repeat:
            freq: daily
            interval: 65535
            count: 2
---

# Rules
