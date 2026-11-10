# Home banner improvements

## Direction

Keep the homepage banner edge-to-edge so it remains a distinctive first impression, but make it more compact and responsive. Reuse the inner pages' clearer content hierarchy without copying their framed, shorter banner treatment wholesale.

## Changes implemented

- **Desktop height:** The full-width hero now uses `clamp(30rem, 58vh, 42rem)` instead of `clamp(38rem, 72vh, 54rem)`. This should reduce how much of a typical desktop viewport the banner occupies while preserving room for the headline, supporting text, and actions.
- **Mobile image:** At widths up to 760px, the hero image now uses a `3 / 2` aspect ratio instead of `1.9 / 1`. At a 390px image width, this is about 260px tall rather than about 205px.
- **Mobile carousel controls:** The controls now sit in a compact rail below the image at mobile widths, rather than overlaying the artwork. Their existing labels and pause behavior are retained.
- **Desktop composition:** The carousel remains full-bleed, with the controls over the artwork at desktop sizes and the copy layered on the right.
- **Content Security Policy:** The inline script's allowlisted SHA-256 hash must include the newline immediately after its opening `<script>` tag. The hash is now calculated from the exact script text the browser executes; a mismatch had blocked page rendering.

## Relationship to inner-page banners

Inner-page `.page-banner`s are framed and rounded, with a 15rem minimum height on desktop and 12rem on mobile. That treatment works well for a page heading, but is too short for the homepage's introduction, calls to action, social links, and rotating artwork. The implemented approach borrows the more restrained scale while retaining the home page's full-width visual identity.

## Follow-up visual checks

The CSS and carousel markup have been validated, but the artwork should still be reviewed in a browser at representative viewport sizes:

- Confirm the desktop hero leaves more of the next section visible without making the headline or actions feel cramped.
- Review every carousel slide on narrow phones. The taller crop may need image-specific `object-position` adjustments to keep important subjects in frame.
- Confirm the control rail is easy to tap, visually distinct, and does not crowd the artwork or the hero copy.
- Check that focus indicators and the pause control remain clear and usable on both mobile and desktop.
