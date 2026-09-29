---
tags:
    - ical
events:
    Weekly plus an extra:
        start: 2024-05-06 10:00:00+09:00
        end: 2024-05-06 11:00:00+09:00
        repeat:
            byday:
                - mon
            count: 3
            freq: weekly
            tz: Asia/Tokyo
            wkst: mon
        instances:
            - end: 2024-05-09 20:00:00+09:00
              start: 2024-05-09 19:00:00+09:00
        ical:
            calendar: fixture
            uid: rdate@example
---

# Weekly plus an extra
