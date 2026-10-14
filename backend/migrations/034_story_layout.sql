-- Migration 034: stories carry the editor's layout.
--
-- A story is its original photo plus a layout: where the photo sits, the
-- filter, and the text, stickers and drawing over it. The app draws the layout
-- rather than uploading a flattened image. Stories posted before this have no
-- layout and are shown whole over a blurred fill.
--
-- A text-only story has no photo, so media_url may now be null; the server
-- only accepts that when a layout comes with it.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS layout JSONB;
ALTER TABLE stories ALTER COLUMN media_url DROP NOT NULL;
