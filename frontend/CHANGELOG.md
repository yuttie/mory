## 0.19.5 (2024-08-17)
* feat(EditableViewer): Tag visible TOC items with "visible" class
* feat(EditableViewer): Tag level X TOC items with `level${X}` class
* fix(EditableViewer): Compute offsetTop of elements more accurately for scroll map
* feat(EditableViewer): Compute section range more precisely
* feat(EditableViewer): Consider the app bar height when checking the visibility of a section

## 0.19.4 (2024-08-16)
* chore(deps): Update dependencies
* fix(markdown): Rewrite URLs found inside embedded HTML

## 0.19.3 (2024-08-16)
* fix(markdown): Re-enable the support for HTML in Markdown
* fix(EditableViewer): Allow users to select rendered note text
* feat(EditableViewer): Make "Metadata" panel more accessible
* feat(EditableViewer): Improve usability of Table of Contents navigation

## 0.19.2 (2024-08-15)
* fix(EditableViewer): Repair broken ToC link navigation

## 0.19.1 (2024-08-15)
* fix(service-worker): Fix typo
* fix(Tasks): Rename error-related ref variables that are conflicting with catched 'error'
* Refactoring and cleanup of the codebase
* Improve development settings

## 0.19.0 (2024-08-15)
* Migrate from Vue CLI to Vite

## 0.18.0 (2024-08-14)
* Display rendered notes within a shadow DOM
* Replace markdown-it with remark
* Update dependencies
* Downgrade sass to ~1.32 to suppress warnings
* Remove NODE_OPTIONS='--openssl-legacy-provider'

## 0.17.3 (2024-06-20)
* Update @vue/cli-* packages with `vue upgrade`

## 0.17.2 (2024-06-20)
* Fix: Use `del` insetad of `Vue.delete`

## 0.17.1 (2024-06-18)
* Fix: Show <v-main> properly after successful login

## 0.17.0 (2024-06-18)
* Introduce Pinia for global state management

## 0.16.0 (2024-06-06)
* Migrate to Composition API toward future upgrade to Vue 3

## 0.15.0 (2024-03-27)
* So many changes!

## 0.14.0 (2021-04-16)
* Detect unsafe note overwrite
* Scroll sync
* Improved appearance
* Better handling of authorization tokens
* Fixed ToC links
* Fixed src values of <img>s
* Better handling of inline codes and code blocks
* Organized internal API functions
* Many fixes.

## 0.13.0 (2021-02-22)
* Change Markdown parser/renderer to markdown-it from marked
    * Better handling of base URL for images
* Implement proper recognition of regions of maths
* Support Markdown extensions with markdown-it's plugins
    * (Pandoc-style) Definition lists
    * Custom <div> with arbitrary class name

## 0.12.0 (2021-02-12)
This release provides enhanced customizability, optimized startup time, and
more improvements.

* Customization
    * Removed built-in style sheet for rendered notes
    * Support custom style sheet written in LESS
    * Make code block's syntax highlight theme selectable
    * Make editor's theme selectable
    * Make editor's keybinding selectable
* Optimized load time by utilizing lazy loading
* Fix
    * Fixed broken realtime math rendering
    * Fixed ugly line breakings in note list
    * Bump marked from 1.2.7 to 2.0.0 for fixing a security vulnerability
* Misc.
    * Use full version of tex-chtml of MathJax
    * Too long table of contents is now scrollable
    * Allow one to put default values of event attributes for multiple occurrences of a single event
    * Use yarn instead of npm in Dockerfile
    * Remove 'event color' metadata

## 0.11.0 (2021-01-11)
* UI improvements
    * Support narrow screens
    * Focus editor by 'e' when editor is already shown
    * Support fractional event durations
    * Change color of "Delete Note" button
* Remove <link>s which are no longer needed
* Replace Moment.js with Day.js

## 0.10.0 (2020-12-31)
* Brush up Docker image

## 0.9.1 (2020-12-27)
* Now event's end time can be a relative time to its start

## 0.9.0 (2020-12-27)

* Dependencies are upgraded
* App
    * Menus are shown just by hovering
* Logo
    * Replace PNG version with SVG
* Calendar
    * Finished events are now semi-transparent
    * Calendar now fills all available space on Safari
    * Use Moment.js for parsing datetimes
    * Now one can use arrow keys to go to next/prev month
* Note
    * Add functionality to create a new note from existing one
* Find
    * Limit height of tags area



## 0.8.2 (2020-12-19)
* Fix an old icon entry in manifest.json



## 0.8.1 (2020-12-19)
* Prefix path to manifest.json with '<%= BASE_URL %>'
* Optimize icons
* Provide an apple touch icon



## 0.8.0 (2020-12-19)
* New logo
* Improved appearance
* Include manifest.json



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
