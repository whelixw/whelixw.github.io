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

## Deploying to `whelixw.github.io`

1. **Replace the old repo** — either rename this repo to `whelixw.github.io` or add the existing GitHub Pages repo as a new remote:
	 ```powershell
	 git remote rename origin old-origin
	 git remote add origin git@github.com:whelixw/whelixw.github.io.git
	 ```
	 Push the current content:
	 ```powershell
	 git push -u origin master
	 ```
2. **Enable GitHub Pages** — in the repository settings, set *Source* to `Deploy from a branch`, branch `master` (or `main`) and folder `/ (root)`.
3. **Optional: GitHub Actions build** — instead of committing the `public/` folder, let GitHub build Zola for you. Create `.github/workflows/deploy.yml` with:
	 ```yaml
	 name: Deploy site
	 on:
		 push:
			 branches: [ master ]
	 jobs:
		 build:
			 runs-on: ubuntu-latest
			 steps:
				 - uses: actions/checkout@v4
					 with:
						 submodules: recursive
				 - uses: shalzz/zola-deploy-action@v0.20.1
					 env:
						 GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
						 BUILD_DIR: public
	 ```
	 This workflow runs `zola build` on every push and publishes directly to the `gh-pages` branch used by GitHub Pages.

## Updating thesis files

1. Export your manuscript and final thesis as PDF files.
2. Save them as `static/assets/manuscript.pdf` and `static/assets/thesis_final.pdf`.
3. Rebuild the site so the files are copied to `public/assets/`.

The homepage buttons will automatically point to these filenames.
