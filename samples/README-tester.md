# Felix TM — beta tester guide

Thank you for trying out Felix TM. This is an early build for feedback;
please assume rough edges and report anything that surprises you.

The sample data in this folder is from a fictional deck-builder card
game (English source → Japanese target). Use it to try the features
without needing to bring your own translation memory.

## Install

1. Download the zip and unzip it somewhere on your disk.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked**, then select the `felix-tm-v0.1.0/` folder
   from the unzipped contents.
5. The Felix TM extension should appear in the list. Pin its icon to
   the toolbar if you'd like easy access to the side panel.

## Open the side panel and load the samples

1. Open a new Google Sheet (any sheet works for the side panel features).
2. Click the Felix TM toolbar icon — the side panel opens on the right.
3. **TM tab → Drop TMX/TSV file**: drop or click to upload
   `sample-tm.tmx`. You should see "Imported 31 new entries from TMX".
4. **Glossary tab → drop zone**: upload `sample-glossary.tsv`.
   You should see ~17 entries appear in the Browse list.

## Things to try

- **Fuzzy match** — In the Sheet, type something like
  `Deal 25 damage` in a cell. Open the Felix overlay (an icon should
  appear near the active cell) and confirm the engine surfaces
  "Deal 20 damage" / "Deal 10 damage" near-matches with their
  Japanese translations.
- **Number placement** — Pick a fuzzy match where the only difference
  is a number; Felix should swap the number into the Japanese target
  automatically. The placed digit shows in blue.
- **Glossary placement** — Try a query that contains a glossary term
  the TM doesn't already cover (e.g. `Apply Weak to all enemies for 2
  turns`). The glossary translations should be inserted into the
  target.
- **QC Check** (Tools tab): click **Run QC**. Each flagged span has a
  hover tooltip explaining the issue. Click the span to register the
  word as a glossary term.
- **Search & Replace** (Tools tab): try queries like
  `Energy`, `source:Deal`, `regex:\\d+ damage`. The `<field>:*` form
  rewrites the entire field on every record.

## What we'd love feedback on

- **Confusing copy or icons** — anything that made you stop and think
  "what does this do?"
- **Wrong matches** — cases where Felix surfaced something obviously
  wrong, or missed something obviously right
- **Performance** — any noticeable lag or freezes (especially during
  Auto Translate or QC)
- **Workflow gaps** — features you wanted that don't exist yet, or
  features that exist but feel awkward to use

## Reporting

Please send feedback by **whatever channel works for you** —
DM, email, voice chat, etc. Screenshots help a lot for visual issues.

## Known limits in this build

- Google Sheets only (Excel Online is on the roadmap)
- The TM is per-extension (not per-Sheet), so all your sheets share
  the same memory until we add scoping
- No undo for `Replace All` yet — back up the TM before running
  destructive replacements
