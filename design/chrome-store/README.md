# Cookit store assets — review draft

Based on `feat/app-matching-popup` version 0.4.4 and the Notion brief:
https://app.notion.com/p/41b744e7ce4481a5830cfc58512e04a9

## Contents

- `screenshots/source-save-email-removed.png`: supplied real screenshot, original dimensions. Only the account email was removed; all other pixels are unchanged. This is a source image, not a 1280×800 store export.
- `icons/store-icon-128.png`: transparent 128×128 PNG, yellow smiling ravioli artwork centered within 96×96; 16/32/48 pixel variants included. A generated adaptation of the current app mascot, pending identity review.
- `concepts/01-save-en-1280x800.png`: English save promotional concept.
- `concepts/02-open-en-1280x800.png`: English saved/open promotional concept.
- `concepts/promo-marquee-1400x560.png` and `promo-small-440x280.png`: promotional concepts.

## Review status

The concepts are generated illustrations/mockups, NOT live screenshots or evidence of tested flows. They must not be submitted as actual product screenshots. The two popup concepts differ in card imagery and framing; replace their product areas with consistent real captures before store submission. The marquee wordmark is serif and requires correction to the existing sans serif identity before approval. Small promo uses a center crop and needs composition review.

No popup implementation, manifest icon replacement, version bump, store publication, or merge is included. Hebrew assets, live saved-state and tags captures, and end-to-end testing remain outside this asset draft.

## Visual direction and generation

Forest green #162D25, cream #FFF8E9, gold #EAC883, and existing smiling yellow ravioli from `Arnonfr/how-to-app/assets/icon.png`. Generated with the built-in image tool. Prompts specified preserving mascot identity, removing its off-white background, and composing restrained green/gold recipe-saving and saved/open scenes without personal data, arrows, unsupported controls, or store badges.

## Validation

The supplied screenshot was visually checked after account email removal. Generated concepts were visually reviewed and the issues above retained explicitly for review. PNG dimensions/modes checked during export. Runtime tests are not applicable to this asset-only change.
