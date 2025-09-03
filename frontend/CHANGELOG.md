## [1.8.0] - 2025-09-03

### 🚀 Features

- *(frontend/components/DateSelector)* Add localtime hint to DateSelector when timezone differs from local #172
- *(frontend/views/TasksNext)* Sort tasks by due date/deadline in descendants views with proper date handling (#171)
- *(frontend/views/Home)* Redesign Home view with quick create, events columns, and tasks columns (#155)

### 🐛 Bug Fixes

- *(frontend/components/DateSelector)* Fix DateSelector clear button to properly handle empty values (#168)

### 🚜 Refactor

- *(frontend)* Remove redundant CSS styles from index.html (#170)

## [1.7.4] - 2025-09-03

### 🐛 Bug Fixes

- *(frontend)* Disable page overscroll

## [1.7.3] - 2025-09-03

### 🐛 Bug Fixes

- *(frontend/notification)* Add feature detection for Notification API
- *(pwa)* Use background-color of `.theme--light.v-application` as theme_color and background_color

## [1.7.2] - 2025-09-01

### 🐛 Bug Fixes

- *(components/DateSelector)* Fix timezone wheel scroll issue in time picker component (#167)
- *(components/DateSelector)* Fix DateSelector timeEnabled not updating when value prop changes (#161)
- *(components/DateSelector)* Replace U+2212 (full-width minus) with U+002D (ASCII hyphen)

## [1.7.1] - 2025-08-30

### 🐛 Bug Fixes

- *(components/TaskScheduleView)* Sort dates in descending order

## [1.7.0] - 2025-08-30

### 🚀 Features

- *(composables/localStorage)* Make localStorage composable reactive to external changes (#152)
- *(views/Tasks, views/TasksNext)* Make hideCompleted* variables persistent using localStorage (#151)

### 🚜 Refactor

- *(views/TasksNext)* Extract descendants views into separate components for better code organization (#149)

## [1.6.0] - 2025-08-30

### 🚀 Features

- *(components/DateSelector)* Enhanced DateSelector with local timezone defaults (#146)
- *(components/TaskEditorNext)* Use DateSelector component for start date, due date and deadline
- *(components/DateSelector)* Enhance DateSelector with includeTime prop and user-controlled time toggle (#142)
- *(views/TasksNext)* Add dual toggle controls for completed task filtering with intelligent view-specific behavior (#141)
- *(components/TaskTree)* Change appearance of items based on their status like TaskListItemNext
- *(components/TaskListItemNext)* Show canceled tasks with strikethrough and appropriate icon
- *(views/TasksNext)* Display task statistics in UI
- *(frontend/views/TasksNext)* Improve responsive layout
- *(views/TasksNext)* Add browser history support to TasksNext view with enhanced tab switching and tree navigation fixes (#140)

### 🐛 Bug Fixes

- *(views/Calendar)* Fix Calendar navigation to use URL as single source of truth (#145)
- *(views/TasksNext)* Ensure one view switcher button is selected
- *(views/TasksNext)* Specify `v-bind:key=`

### ⚙️ Miscellaneous Tasks

- *(views/TasksNext)* Give primary color to Add button

## [1.5.1] - 2025-08-27

### 🐛 Bug Fixes

- *(frontend/views/TasksNext)* Keep all Eisenhower Matrix quadrants uniformly sized

### 🎨 Styling

- *(frontend/views/TasksNext)* Remove trailing spaces

### ⚙️ Miscellaneous Tasks

- *(frontend)* Add cliff.toml
- *(docs)* Add top-level README.md

## [1.5.0] - 2025-08-26

### 🚀 Features

- *(views/Search)* Trigger search on Enter key
- *(metadata)* Update metadata schema to support task management from tasks-next branch merge (#124)
- *(components/TaskEditorNext)* Prevent page transition when there are unsaved changes in TaskEditorNext (#128)
- *(components/TaskEditorNext)* Implement auto-completion functionality for contact field in TaskEditorNext component (#130)
- *(components/TaskTree)* Show task completion status of parent tasks
- *(components/TaskTree)* Implement tag grouping with Pinia store architecture and fix task editor visibility (#125)
- *(components/TaskEditorNext, views/TasksNext)* Add parent task context, switching capability, cancel option, and tag-based task creation (#134)
- *(views/TasksNext)* Add Eisenhower Matrix view to the descendants tab page (#129)
- *(views/TasksNext)* Add mobile screen support for TasksNext view (#136)
- *(mobile)* Improve navigation drawer and app bar
- *(views/TasksNext)* Show task group for each possible task status kind
- *(views/TasksNext)* Extract "Scheduled" task group into separate view
- *(views/TasksNext)* Use <v-btn-toggle> instead of <v-select> for switching view
- *(file-types)* Implement Media viewer component for images, videos, and PDFs (#135)

### 🚜 Refactor

- *(import)* Let unplugin-vue-components auto-import components

### 📚 Documentation

- *(README)* Describe summary of app
- *(README)* Add note about single-user focus and privacy

### 🎨 Styling

- Remove trailing spaces
- *(views/About)* Show only author name

### ⚙️ Miscellaneous Tasks

- Ignore components.d.ts

## [1.4.1] - 2025-08-19

### 🐛 Bug Fixes

- *(views/TasksNext)* Correct overflow behavior so that task tree can have scrollbar
- *(views/Tasks)* Refresh taskForest store on mounted

## [1.4.0] - 2025-08-18

### 🚀 Features

- *(views/TasksNext)* Activate corresponding tree item when task is clicked in 'descendants' tab view
- *(views/TasksNext)* Automatically open tree nodes up to selected task

### ⚙️ Miscellaneous Tasks

- *(components/TaskListItemNext)* Remove toggle functionality of done status
- *(components/TaskTree)* Preserve original event name

## [1.3.0] - 2025-08-18

### 🚀 Features

- *(components/TaskEditorNext)* List all selected dates under calendar

### 🐛 Bug Fixes

- *(App)* Correct lock icon position
- *(components/TaskEditorNext)* Correct text field label
- *(views/TasksNext)* Always refresh task editor after save

### ⚙️ Miscellaneous Tasks

- *(components/TaskEditorNext)* Hide scheduled date list if none is selected

## [1.2.0] - 2025-08-18

### 🚀 Features

- *(views/Tasks)* Add migrate button to create copy of task in new task management view

## [1.1.0] - 2025-08-17

### 🚀 Features

- *(tasks-next)* Add button to open task as note

### 🐛 Bug Fixes

- *(views/Files)* Add top padding to prevent overlap of search box and buttons
- *(views/Files)* Restore appearance and functionality by adding missing icons
- *(views/Home)* Add missing icons
- *(App)* Restore missing icons
- *(components/TaskListItem)* Restore missing icons
- *(components/TaskEditor)* Restore missing icons
- *(views/Tasks)* Restore missing icons

### ⚙️ Miscellaneous Tasks

- *(App)* Remove redundant login overlay

## [1.0.0] - 2025-08-17

### 🚀 Features

- *(files)* Add dedicated icons for task notes and event notes
- *(tasks-next)* Add reworked task management view

### 🐛 Bug Fixes

- *(tasks-next)* Improve appearance of loader overlay
- *(tasks-next)* Correct type names

### 🚜 Refactor

- *(api)* Rename confusing function name from getTaskDataV2() to getTaskData(), overwriting old function
- *(tasks-next)* Reorganize task-related API
- *(tasks-next)* Move logic to fetch task forest to taskForest store
- *(tasks-next)* Emphasize return type by rename
- *(tasks-next)* Move background color specification for .item-view from inline CSS to <style>

### ⚙️ Miscellaneous Tasks

- *(tasks-next)* Copy Task.vue to TaskNext.vue and add /tasks-next route for v2 development
- *(tasks-next)* Add TaskTree component to TasksNext view
- *(tasks-next)* TaskTree emits 'change' event when selection changed
- *(tasks-next)* Await call of load()
- *(tasks-next)* Remove unnecessary top-level tree node
- *(tasks-next)* Show all or descendants of selected task in right pane
- *(tasks-next)* Update implementation of knownTags computed property
- *(tasks-next)* Rename src/stores/task_forest.ts to src/stores/taskForest.ts
- *(tasks-next)* Add selectedNode computed property
- *(tasks-next)* Add flattenDescendants action to TaskForest store, which is useful for external selection management
- *(tasks-next)* Add to TaskForest store actions for creating, replacing, and deleting node locally
- *(tasks-next)* Add composable for asynchronously fetching task
- *(tasks-next)* Add module for frontend task types and utilities
- *(tasks-next)* Add extractFrontmatterH1AndRest utility function
- *(tasks-next)* Add getTask() function for retrieving task by path
- *(tasks-next)* Add extractFileUuid() utility
- *(tasks-next)* Apply task representation change to TaskTree component
- *(tasks-next)* Add 'active' prop to TaskTree in order to allow programmatic item activation
- *(tasks-next)* Update TaskListItemNext component for new task representation
- *(tasks-next)* Improve event name of TaskListItemNext
- *(tasks-next)* Add date selection component
- *(tasks-next)* Add reworked task editor component
- *(tasks-next)* Remove debug prints in TaskListItemNext component
- *(tasks-next)* Remove unused 'busy' prop from TaskEditorNext
- *(tasks-next)* Expose refresh method from TaskEditorNext so that parent component can manually refresh data
- *(tasks-next)* Align checkbox and texts to top in TaskListItemNext component

## [0.20.0] - 2025-08-07

### 🚀 Features

- *(Home)* Sort entries by title
- *(Home)* Show ages of notes
- Show tag selector menu when dedicated button is clicked
- *(Home)* Add sort buttons
- *(Home)* Add icons indicating sort order
- Prevent images on the page from being dragged and dropped within it
- Add support for time-only event end values
- Omit seconds format normalized event end time if possible
- Move global error messages to the top
- Catch also errors from Vue components
- *(TaskEditor)* Allow task name text field to be multiline
- Show errors on UI only in development
- *(Find)* Show titles instead of paths if available
- Truncate long titles/paths and show full text in a tooltip
- *(Find)* Use different types of icons based on MIME types
- *(Find)* Color icons
- Lazy load images in rendered notes
- Lower the contrast of the background
- Remove because About.vue uses the SVG image
- Update icons
- Name new notes using UUIDv7
- *(EditableViewer)* Make right sidebar collapsible like main sidebar
- *(EditableViewer)* Fix position of toolbar during expansion of right sidebar for better usability
- *(Tasks)* Always show today slot even if there are no tasks for today
- *(Tasks)* Add reload button
- *(Tasks)* Add search function
- *(Tasks)* Adjust sizes of control on small screens
- *(Tasks)* Make button sizes on dialogs flexible for mobile devices
- *(Tasks)* Improve layout of date headers
- *(Tasks)* Also always show slot of tomorrow
- *(Calendar)* Allow one to go to previous/next year with PageDown/PageUp keys, respectively
- *(Calendar)* Allow one to go to today by Home key
- *(Calendar)* Show event definition errors on UI
- *(Dockerfile)* Allow one to run arbitrary command after setup
- Add Search view
- *(Tasks)* Fetch task data via API v2 using conditional GET (If-None-Match)
- *(Tasks)* Refresh task data on window focus
- Use UUIDv4 for default note filename instead of UUIDv7

### 🐛 Bug Fixes

- *(Note)* Always show upstream state notifications regardless of current view mode
- *(math)* Use SVG variant of rehype-mathjax
- Handle only relevant drag-and-drop events and defer others to browser
- *(Editor)* Fix errors on key input of <C-c>
- *(EditableViewer)* Fix NavigationDuplicated error by avoiding replacing the route with the same value
- *(App)* Adjust z-index values
- *(App)* Improve margins of top right buttons
- *(App)* Fix z-order of left sidebar and line numbers in editor
- *(EditableViewer)* Correct z-order of right sidebar's border and v-expansion-panels inside this element
- *(EditableViewer)* Place editor and viewer panes vertically in small screen
- *(EditableViewer)* Fix behavior of mode selection buttons
- *(EditableViewer)* Hide horizontal scroll bar of view pane
- *(App)* Fix spaces around v-divider
- *(api)* Assign new UUID to task only when it doesn't have one yet
- Define order of task's properties including `id`
- *(Tasks)* Properly assign unique IDs to new tasks
- *(Tasks)* Do not reload when window gets focused because it reverts drag-and-drop operation
- *(Tasks)* Keep default minimum width of buttons for easier operation on touch devices
- *(App)* Add button for user to request notification
- *(Calendar)* Use horizontal wheel scroll to go to previous/next month
- *(Calendar)* Solve problem that v-touch directive is not available
- *(EditableViewer)* Show horizontal border between editor and viewer in small screen
- *(App)* Fix typo
- *(App)* Correct wrong type
- *(Calendar)* Validate event start and end times more strictly
- *(Calendar)* Rename variable name so that it will not shadow reactive state variable `error`
- *(service-worker)* Prefix notification icon path with app root
- *(service-worker)* Fix typo
- *(Dockerfile)* Fix FromAsCasing problem
- *(docker)* Correct shebang path
- *(service-worker)* Eliminate use of import.meta
- *(Editor)* Expose methods that are used by EditableViewer
- *(EditableViewer)* Remove also `template` query parameter
- *(EditableViewer)* Always give focus to editor if visible
- *(EditableViewer)* Restore ToC highlighting and scroll synchronization
- *(EditableViewer)* Replace `id` attr of top-level element with `class` for better portability as component
- *(Editor)* Eliminate initial empty text from undo stack

### 💼 Other

- Enable sourcemap generation

### 🚜 Refactor

- *(Editor)* Add methods to avoid direct access from EditableViewer
- *(EditableViewer)* Fix comment that is no longer applicable
- Replace `Object.prototype.hasOwnProperty.call()` with `Object.hasOwn()`
- *(App)* Add the global error handlers that capture errors and promise rejections and show them in the UI
- Remove imports of compiler macros: defineProps(), defineEmits() and defineExpose()
- Remove debug prints
- *(App)* Implement Notion-style collapsing sidebar
- *(App)* Replace app bar with minimal toolbar overlay
- *(App)* Replace v-app-bar with v-row for Notion-style top-right layout
- *(App)* Rename mini-sidebar to mini-main-sidebar
- *(EditableViewer)* Integrate .toolbar into right sidebar
- *(EditableViewer)* Move minimize button in right sidebar to top when expanded
- *(EditableViewer)* Simplify mode switch
- *(EditableViewer)* Remove unused CSS rules
- *(App)* Use denser UI layout
- *(App)* Use smaller icons for dense UI
- *(Tasks)* Improve usability by adjusting column layout
- *(Tasks, api)* Give unique IDs to tasks when loading and use them as keys in v-for
- *(Tasks)* Ensure `load()` method replaces values keeping their reactivity
- *(Tasks)* Make margin between special columns and user-defined columns customizable via class
- *(api)* Define interface of task data
- *(api, Tasks)* Save cleaned copy of task data instead of mutating original which Tasks component holds
- *(Tasks)* Replace `JSON.parse(JSON.stringify())` with `structuredClone()` for better performance
- *(Tasks)* Simplify `add` method
- *(Tasks)* Ensure draggable component and its inner v-for refer to same task array
- *(Tasks)* Use nullish coalescing assignment (??=) instead of ||=
- *(App)* Use `pa-0` instead of `style="padding: 0;"`
- *(icon)* Replace @mdi/font with @mdi/js for optimizing bundle size
- Remove unnecessary '?' from fields of defineProps type specifications
- *(Gravatar)* Brush up implementation
- *(vue-router)* Use official implementations of useRoute() and useRouter()
- Remove defineExpose() usages that seem unused
- *(Calendar)* Improve message
- *(stores/app.ts)* Remove service worker registration object from successful registration message
- *(service-worker)* Fix present time to compare with
- *(Dockerfile)* Wrap CMD commandline in a shell script
- Rename view "Find" to "Files"
- *(Tasks)* Replace api.putTaskData() instead of api.addNote()
- *(Editor)* Simplify key binding customization
- *(Editor)* Use `Vim.mapCommand()` for non-key-to-key mappings for better consistency
- *(Editor)* Brush up code for loading 'vim-modified' keybinding
- *(EditableViewer)* Remove unnecessary dependency to `document` object

### 📚 Documentation

- *(Tasks)* Add comments to template
- *(Tasks)* Add comment
- Add reason why we need to manually enable directives
- Use better name for the concept

### ⚡ Performance

- Optimize PNG files further

### 🎨 Styling

- Add semicolons
- *(Calendar)* Double the indent size
- *(App)* Double the indent size
- *(Tasks)* Double the indent size
- *(TaskEditor)* Double the indent size
- Use indent size of 4
- *(EditableViewer)* Increase indent width to 4 spaces

### ⚙️ Miscellaneous Tasks

- Switch package manager from yarn to npm
- Analyze bundle with "rollup-plugin-visualizer"
- *(eslint)* Configure indent size to 4 spaces
- Update dependencies
- Update dependencies to latest versions
- Remove gathering and showing uncaught errors
- Update axios

## 0.19.6 (2024-09-13)
* feat(Home): Show title instead of path if available
* Use randomUUID() from Web Crypto API instead of uuid package
* feat(Conifg): Make <v-select> centers menu list on selected item

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
