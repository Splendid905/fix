# Home banner improvement

## Recommendation

Keep the home banner's edge-to-edge artwork, but make it a more compact, responsive hero. This preserves a distinctive first impression on the homepage without making it feel like a full-screen takeover. Borrow the inner pages' clearer, bounded content treatment, rather than copying their framed banner layout wholesale.

## What the current layout does

- On desktop, `.hero` spans the viewport width and has a minimum height of `38rem`, scales to `72vh`, and can reach `54rem`. The artwork fills that area, with the headline and supporting content layered over the right side.
- On screens up to 760px wide, the hero stacks the artwork above its copy. The artwork uses a `1.9 / 1` aspect ratio, so at a 390px content width it is only about 205px tall.
- The four carousel controls (previous, four slide indicators, pause, and next) sit over the lower-left of the artwork. That takes attention and picture area away from the images, especially on a small screen.
- Inner-page `.page-banner`s are framed and rounded, with a 15rem minimum height on desktop and 12rem on mobile. Reusing that exact treatment would create consistency, but would also remove some of the homepage's visual impact.

## Suggested direction

Use the full-bleed treatment as the visual anchor, with a restrained height and cleaner mobile controls:

1. **Reduce desktop height** to a target range around `30–42rem` (roughly `58vh`, with sensible minimum and maximum values). Keep the text overlay and image, but ensure the headline and primary actions remain legible and prominent.
2. **Give the mobile image more height** by changing its crop from `1.9 / 1` toward approximately `3 / 2`. At 390px wide, that gives the artwork about 260px of height instead of about 205px. Check the actual slides at phone widths and adjust `object-position` per image if important subjects are cropped.
3. **Keep the carousel controls out of the picture area on phones.** Put them in a compact, high-contrast control rail directly below the image, or otherwise reserve a distinct strip for them. This avoids covering focal details while keeping the controls easy to find and tap.
4. **Retain the existing carousel accessibility behavior**—including meaningful button labels, visible focus states, and the pause control—when changing its placement or styling.

The result should still read as a full-width home hero, while feeling less oversized on desktop and making the artwork and controls easier to see on mobile.

## Why not use the inner-page banner as-is?

The inner-page banner is a good reference for scale and content hierarchy, but its 12–15rem height is designed for a page heading rather than the homepage's larger introduction, actions, social links, and rotating artwork. Applying that height directly would likely make the home experience feel cramped. A reduced-height full-bleed hero is the better compromise; a subtle border or other restrained styling from the inner-page banners could be reused if extra visual consistency is desired.

## How to evaluate the change

- On a typical desktop viewport, the banner should leave more of the next section visible without weakening the main headline or calls to action.
- On a narrow phone viewport, the artwork should be tall enough to register clearly, and the controls should not cover its important subjects.
- Check every carousel slide at both sizes: a single centered crop may not work equally well for all four images.
