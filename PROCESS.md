# Process overview

## What I built

Play the Wind is a browser wind-chime instrument: eleven pentatonic chimes,
in three timbres (metal, bamboo, glass), that you tap, strum, or set ringing
by dragging wind through the field — rendered as a fūrin garden scene at
dusk. All sound is synthesised live with the Web Audio API. The build moved
through several turning points: replacing an oscillator-per-note piano sound
with proper chime synthesis, separating "wind" from "touch" so dragging
through a chime only rings it, giving each material a genuinely distinct
voice, and rebuilding the field from plain grey bars into an illustrated
scene. The two moments below are where the direction changed, not just the
numbers.

## The moments that mattered

**Chimes, not a tuned piano.** The first working version triggered a single
sine/triangle oscillator per note — pentatonic, but it read as a keyboard,
not a chime. Instead of tuning its envelope, I replaced it with per-material
voices built from inharmonic bell-partial ratios, a filtered-noise mallet
tick, and per-partial decay so higher overtones fade faster than the
fundamental. I checked it by listening for the shimmering ring-out a real
chime has, not just a longer decay number
([`0cfd2de`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-baizhenh884-dev/commit/0cfd2de3d19608f21a15a4f1f73014d88548847a)).

**Glass wouldn't get crisp.** Two rounds of parametric tuning — sharper
attack, more shimmer — still left Glass sounding like a duller Metal. Rather
than a third nudge, I restructured it: an octave up, three clean partials
instead of six inharmonic ones, a highpass "tick" transient in place of the
bandpass knock, and a highpass on the whole voice. Metal and bamboo picked up
the same new controls with values chosen to reproduce their old behaviour
exactly, which `git diff` confirmed left their objects untouched, alongside a
clean `pnpm check`
([`577a4a7...86c5132`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-baizhenh884-dev/compare/577a4a7...86c5132)).
