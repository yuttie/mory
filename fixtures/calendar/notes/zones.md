---
events:
    Tokyo morning:
        start: 2024-03-04 09:00
        repeat:
            freq: weekly
            byday: [mon]
            tz: Asia/Tokyo
            until: 2024-03-26
    New York across spring forward:
        start: 2024-03-08 10:00:00-05:00
        repeat:
            freq: daily
            count: 4
            tz: America/New_York
    London across autumn:
        start: 2024-10-25 15:00:00+01:00
        repeat:
            freq: daily
            count: 4
            tz: Europe/London
    Until with an offset:
        start: 2024-04-01 20:00
        repeat:
            freq: daily
            tz: Asia/Tokyo
            until: 2024-04-04 12:00:00+00:00
    Until the reader's clock skips:
        start: 2024-03-08 03:00
        repeat:
            freq: daily
            tz: Asia/Tokyo
            until: 2024-03-10 02:30:00+09:00
    Wall clock in the spring gap:
        start: 2024-03-08 02:30
        repeat:
            freq: daily
            count: 4
    Wall clock in the repeated hour:
        start: 2024-11-02 01:30
        repeat:
            freq: daily
            count: 3
    Excluded by instant:
        start: 2024-04-08 08:00
        repeat:
            freq: daily
            count: 3
            tz: Asia/Tokyo
        exclusions:
            - 2024-04-08 23:00:00Z
    Zone in lower case:
        start: 2024-06-03 09:00
        repeat:
            freq: daily
            count: 2
            tz: asia/tokyo
    Empty zone:
        start: 2024-06-05 09:00
        repeat:
            freq: daily
            count: 2
            tz: ''
    Unknown zone on dates:
        start: 2024-06-07
        repeat:
            freq: daily
            count: 2
            tz: Mars/Olympus_Mons
    Zone that is zero:
        start: 2024-06-09 09:00
        repeat:
            freq: daily
            count: 2
            tz: 0
    Zone that is false:
        start: 2024-06-09 10:00
        repeat:
            freq: daily
            count: 2
            tz: false
    Zone in a list:
        start: 2024-06-09 11:00
        repeat:
            freq: daily
            count: 2
            tz: [Asia/Tokyo]
    Zone only ICU knows:
        start: 2024-06-09 12:00
        repeat:
            freq: daily
            count: 2
            tz: JST
    Zone as an offset:
        start: 2024-06-09 13:00
        repeat:
            freq: daily
            count: 2
            tz: '+09:00'
    Zone the database abbreviates:
        start: 2024-06-09 14:00
        repeat:
            freq: daily
            count: 2
            tz: EST
    Zone that is zero on dates, until an instant:
        start: 2024-06-11
        repeat:
            freq: daily
            tz: 0
            until: 2024-06-12 23:00:00+00:00
    Zone that is zero on dates:
        start: 2024-06-13
        repeat:
            freq: daily
            count: 2
            tz: 0
    Until at its start in its zone:
        start: 2024-05-26 20:00
        repeat:
            freq: daily
            tz: Asia/Tokyo
            until: 2024-05-26 11:00:00+00:00
    All-day until its first midnight in its zone:
        start: 2024-05-27
        repeat:
            freq: daily
            tz: Asia/Tokyo
            until: 2024-05-26 15:00:00+00:00
    Until past spring forward in its zone:
        start: 2024-03-10 03:00
        repeat:
            freq: daily
            tz: America/New_York
            until: 2024-03-10 07:30:00+00:00
---

# Zones
