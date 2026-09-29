---
events:
    Weekly day off:
        start: 2024-05-04
        end: 2024-05-05
        repeat:
            freq: weekly
            count: 3
    Monthly review:
        start: 2024-05-01
        repeat:
            freq: monthly
            until: 2024-08-01
        exclusions:
            - 2024-07-01
    Named zone on a date:
        start: 2024-05-10
        repeat:
            freq: daily
            count: 2
            tz: Asia/Tokyo
---

# All day
