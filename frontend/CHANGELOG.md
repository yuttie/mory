## 0.3.2 (2020-08-14)
* Fix the malfunctioning service worker
* Stop using @vue/cli-plugin-pwa
* Add more variations of the icon
* Upgrade dependencies



## 0.3.1 (2020-08-12)
* Add a toolbar for controlling the calendar



## 0.3.0 (2020-08-11)
* Implement calendar on the Home view
    + New metadata entry `events`
    + Currently support names, start/end times and colors of events
    + Automatically select default colors for events based on note names
    + Jump to a note corresponding to an event by click
* Note view
    + Enable the save button when a new note has just been created but not saved
    + Disable the reload button if a note hasn't been saved
    + Insert a template text when creating a new note
    + Render notes' metadata separately
* Find view
    + Sort by time in descending order by default
    + Force sorting
