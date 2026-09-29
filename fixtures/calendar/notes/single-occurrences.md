---
events:
    With offset:
        start: 2024-05-01 10:00:00+09:00
    Wall clock:
        start: 2024-05-01 10:00
    With seconds:
        start: 2024-05-01 10:00:30
    ISO with Z:
        start: 2024-05-01T17:00:00Z
    All day:
        start: 2024-05-02
    Listed:
        instances:
            - start: 2024-05-03 09:00
            - start: 2024-05-04 09:00-07:00
              name: Renamed instance
            - start: 2024-05-05
            - start: not a date
            - just text
    Older spelling:
        times:
            - start: 2024-05-06 09:00
    Both:
        start: 2024-05-07 09:00
        instances:
            - start: 2024-05-08 09:00
    Unusable start:
        start: someday
---

# Single occurrences
