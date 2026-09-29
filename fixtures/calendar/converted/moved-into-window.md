---
tags:
    - ical
events:
    Maintenance:
        start: 2024-01-18 18:00:00+09:00
        end: 2024-01-18 22:00:00+09:00
        repeat:
            byday:
                - 3thu
            freq: monthly
            tz: Asia/Tokyo
            wkst: mon
        overrides:
            - at: 2024-05-16 18:00:00+09:00
              end: 2024-05-27 20:00:00+09:00
              name: Maintenance, moved
              start: 2024-05-27 18:00:00+09:00
        ical:
            calendar: fixture
            uid: moved-into-window@example
---

# Maintenance
