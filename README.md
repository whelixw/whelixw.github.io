# André Jørgensen — Bioinformatics site

This repository contains the source for my CV/notes site powered by [Zola](https://www.getzola.org/) and the [Serene theme](https://github.com/isunjn/serene). The homepage mirrors Samy Haffoudhi’s presentation: avatar + nav up top, with my bioinformatics-focused content living in Markdown under `content/_index.md`. Thesis downloads are linked directly from the intro section.

## Project structure

- `config.toml` — global metadata and build settings.
- `content/_index.md` — homepage content rendered via Serene’s `home.html` layout.
- `templates/` — overrides for Serene templates (blog/prose/projects/taxonomy) to keep behaviour consistent while enabling tweaks.
- `static/assets/` — place `manuscript.pdf` and `thesis_final.pdf` here so the download buttons work.
- `content/` — optional blog, projects, and teaching sections for future expansion.

## Development

```powershell
.\zola.exe serve
```

The command spins up a local dev server (default `http://127.0.0.1:1111`) with live reload. Stop it with `Ctrl+C`.

## Building for deployment

```powershell
.\zola.exe build
```

The generated static site will be written to `public/`. Push that to GitHub Pages or serve it from any static host.

## Updating thesis files

1. Export your manuscript and final thesis as PDF files.
2. Save them as `static/assets/manuscript.pdf` and `static/assets/thesis_final.pdf`.
3. Rebuild the site so the files are copied to `public/assets/`.

The homepage buttons will automatically point to these filenames.
