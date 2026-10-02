---
events:
    Not set:
        start: 2024-05-06 09:00
    All day not set:
        start: 2024-05-07
    On the event:
        start: 2024-05-06 10:00
        alarms: [-10m]
    A single string:
        start: 2024-05-06 11:00
        alarms: -1h
    Silenced:
        start: 2024-05-06 12:00
        alarms: []
    An empty list is not set:
        start: 2024-05-06 13:00
        alarms:
    Malformed entries are dropped:
        start: 2024-05-06 14:00
        alarms: [-5m, 5m, soon, 1h, 7, -1.5d, '-1d 25:00', null, [-1h], -400d]
    Every spelling:
        start: 2024-05-06 15:00
        alarms: [-90 minutes, -1.5h, -30s, +2 hours, 0m, -1w, 09:00, '-1d 18:00', '+1 day 08:30', -0.5s]
    The same alarm twice:
        start: 2024-05-06 16:00
        alarms: [-1h, -60m, 0m, +0d]
    All day with times:
        start: 2024-05-08
        alarms: ['-1d 18:00', 09:00, -6h]
    A single string for a time of day:
        start: 2024-05-09
        alarms: '-1d 18:00'
    A series:
        start: 2024-05-13 09:00
        repeat: { freq: weekly, count: 4 }
        alarms: [-15m]
        overrides:
            - at: 2024-05-20 09:00
              alarms: []
            - at: 2024-05-27 09:00
              alarms: [-1h, 0m]
            - at: 2024-06-03 09:00
              location: Room 2
    A series with none set:
        start: 2024-05-14 09:00
        repeat: { freq: weekly, count: 2 }
        overrides:
            - at: 2024-05-21 09:00
              alarms: [-5m]
    Listed:
        alarms: [-30m]
        instances:
            - start: 2024-06-10 14:00
            - start: 2024-06-11 14:00
              alarms: [0m]
            - start: 2024-06-12 14:00
              alarms: []
            - start: 2024-06-13 14:00
              alarms:
    Listed with none set:
        instances:
            - start: 2024-06-14 14:00
            - start: 2024-06-15
            - start: 2024-06-16 14:00
              alarms: -2h
    A start and a list:
        start: 2024-06-17 14:00
        alarms: [-20m]
        instances:
            - start: 2024-06-18 14:00
            - start: 2024-06-19 14:00
              alarms: [+1h]
    Finished:
        start: 2024-06-20 14:00
        finished: true
        alarms: [-1h]
    A category:
        start: 2024-07-01 09:00
        category: meeting
    A nested category:
        start: 2024-07-02 09:00
        category: meeting/1on1
    A nested category that sets none:
        start: 2024-07-03 09:00
        category: meeting/standup
    A category that silences:
        start: 2024-07-04 09:00
        category: meeting/quiet
    A category that is not configured:
        start: 2024-07-05 09:00
        category: nowhere
    A category misspelt:
        start: 2024-07-08 09:00
        category: meeting/1no1
    A category with nothing in it:
        start: 2024-07-09 09:00
        category: unset
    All day with a category with nothing in it:
        start: 2024-07-21
        category: unset
    All day with a category that silences:
        start: 2024-07-22
        category: meeting/quiet
    Through an ancestor that is not configured:
        start: 2024-07-10 09:00
        category: a/b/c/d
    A category and a list on the event:
        start: 2024-07-11 09:00
        category: meeting
        alarms: [-1m]
    A category on a series:
        start: 2024-07-15 09:00
        repeat: { freq: daily, count: 3 }
        category: meeting
        overrides:
            - at: 2024-07-16 09:00
              alarms: [-1h]
    All day in a category:
        start: 2024-07-20
        category: meeting
---

# Alarms
