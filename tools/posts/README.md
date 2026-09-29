# Posting queue

`content/posts.json` is the queue; `content/primitives.json` is the inventory of what the launchpad
offers. `render.mjs` turns both into one page built for a phone — every post in a tap-to-copy block
with its image beside it.

```sh
node tools/posts/render.mjs          # -> tools/posts/out/queue.html
bash tools/posts/check-assets.sh     # every asset URL on that page resolves
```

## Why this is JSON and not a document

Because the alternative is writing a bespoke page per campaign beat, and a pipeline whose first
step is "write the page again" is not a pipeline. Adding a post is adding an entry.

It also makes the state answerable instead of remembered: `status` is `posted | ready | drafted |
blocked`, so "what is left to post" is a query rather than a scroll, and a blocked item carries the
reason it is blocked next to the copy it is blocking.

## Two rules the tooling enforces

**Links are hash-form.** The published bundle routes on the hash; `/collections` returns 504 from
the gateway and `/#/collections` renders. One character, invisible in a rendered post.

**Asset URLs are checked, not assumed.** A page of 404s renders identically to a page that works —
the images have alt text and the Save buttons look like buttons. `POSTS_ASSET_REF` selects the ref
assets are served from; it points at the branch that carries them until that branch merges, and
`check-assets.sh` fails if the ref in use does not actually serve them.
