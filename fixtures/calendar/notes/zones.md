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
---

# Zones
