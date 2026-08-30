# mory

*mory is designed to be a part of your memory.*

With mory, you can capture notes, manage your calendar, and track tasks—freeing
your mind to focus on what matters. Think of it as: **my memory = me + mory**.

The core design principle is simple: your content should always be accessible
and editable locally, without relying on a web app. To achieve this, mory is
built on two key ideas:

- **Git-powered storage** — all data is versioned and managed through a Git
  repository instead of a traditional database.  
- **Markdown-native format** — everything is stored as plain Markdown files,
  ensuring your data stays portable, human-readable, and future-proof.

External calendars can be subscribed to by their iCal address, so the calendar
shows the whole day rather than only what mory itself owns. Imported events are
read-only and never written to the repository — they are a live view of someone
else's calendar. Any one of them can be adopted with a single button, which
writes an ordinary Markdown note for it; from then on the event is yours to
edit, and the read-only original steps aside.

mory is a **personal tool for private use only**. It is intentionally designed
without multi-user support or collaboration features. This single-user focus
helps keep the app **simple** and ensures your data remains **private and under
your control**, making it a dependable companion for personal productivity.
