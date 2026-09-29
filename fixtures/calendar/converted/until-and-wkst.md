---
tags:
    - ical
events:
    Bounded fortnightly:
        start: 2020-01-01 10:00:00-08:00
        end: 2020-01-01 11:00:00-08:00
        repeat:
            byday:
                - wed
                - sun
            freq: weekly
            interval: 2
            tz: America/Los_Angeles
            until: 2020-02-10 10:00:00-08:00
            wkst: sun
        ical:
            calendar: fixture
            uid: until@example
---

# Bounded fortnightly
