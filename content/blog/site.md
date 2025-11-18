+++
title = "About this site"
date = 2024-06-30

[taxonomies]
categories = ["Tools"]

[extra]
math = true
+++

This page describes how the site is assembled and why it closely mirrors Samy Haffoudhi’s original build. I’m standing on Samy’s shoulders here—the layout, tone, and most of the nice touches come directly from his repo at [github.com/samyhaff/samyhaff.github.io](https://github.com/samyhaff/samyhaff.github.io). For context on his setup you can read [Samy’s own write-up](https://samyhaff.github.io/blog/site/), which also links to the decisions behind the Serene theme.

<!-- more -->

## Stack

* **Generator:** [Zola](https://www.getzola.org/) — single binary, Markdown content, [Tera](https://keats.github.io/tera/) templates.
* **Theme:** [Serene](https://github.com/isunjn/serene) (tracked as a git submodule). Dark/light modes, categories, and KaTeX just work out of the box.
* **Content:** Plain Markdown files in `content/`, the same structure Samy uses so that the homepage/about/projects/blog templates drop in without edits.

## Deployment

Everything is built locally with `zola build` and deployed to GitHub Pages. I’m following Samy’s recipe of pushing the source to the `master` branch and serving the built site from `gh-pages` via [shalzz/zola-deploy-action](https://github.com/shalzz/zola-deploy-action). No extra JavaScript or analytics—just static files.

## Why copy the structure?

Samy’s site hits the sweet spot for me: minimal navigation, quick load times, and just enough room for notes, projects, and a blog-like logbook. Rather than reinvent the wheel, I’m reusing the pieces he shared publicly and swapping in my own content.
