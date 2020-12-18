## 0.7.0 (2020-12-19)
* Note templates
* Enhancements of the calendar
* Allow root metadata properties to be null



## 0.6.0 (2020-12-18)
* Validate metadata on Note view
* Define the JSON scheme for metadata



## 0.5.0 (2020-12-18)
* Change URL according to current state of calendar
* Use first `<h1>` as page title



## 0.4.0 (2020-12-17)
* Update dependencies
* More flexible search
* Better display of metadata
* Fix autocomplete for username and password
* Remove tabs' indicator when it is not necessary
* Better appearance of note toolbar
* Improved note appearance
* Add 'api' module



## 0.3.3 (2020-09-02)
* Add some documentation using docsify
* Improve UI usability
    + Make login errors recoverable
    + App bar
        - Organize the content
        - Change the appearance of center buttons into tabs
    + List
        - Move pagination controls to the top of a table
        - Add the "delete" button
    + Note view
        - Autofocus and select the rename text field
        - Make it possible to execute rename by Enter key
        - Focus the editor if it's visible after re-login
        - Toggle the viewer by Shift-Enter
        - Lower the frequency of rendering notes
        - Hide the right toolbar when loading a note
        - Simplify the appearance of buttons
        - Limit the maximum width of images
        - Limit the height of images to 500px
        - Support math rendering with MathJax
* Calendar
    + Separate the calendar view from Home
    + Report invalid events on console
    + Fix judgement of past events for day-long events
    + Event colors
        - Support specifying a color for multiple occurrences of an event
        - Adjust colors for events
        - Use a gray color for events without color specification
        - Support two-word color names of Material Design, e.g. "light-green"



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
