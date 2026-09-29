---
tags:
    - ical
events:
    Rust release:
        start: 2015-06-25 10:00:00-07:00
        end: 2015-06-25 11:00:00-07:00
        repeat:
            byday:
                - thu
            freq: weekly
            interval: 6
            tz: America/Los_Angeles
            wkst: mon
        exclusions:
            - 2015-09-17 10:00:00-07:00
            - 2015-12-10 10:00:00-08:00
        overrides:
            - at: 2015-08-06 10:00:00-07:00
              end: 2015-08-06 17:30:00-07:00
              name: Moved to the afternoon
              start: 2015-08-06 16:00:00-07:00
        ical:
            calendar: fixture
            uid: series@example
---

# Rust release
