# Zelda collectible countdowns

Standard Ocarina of Time Switch 2 remake (2026): 100 Gold Skulltulas, 36 Heart Pieces, 8 boss Heart Containers. Counts were tallied from individual rows in the linked Polygon remake guides on November 14, 2026; the data assertions verify their totals. Village and graveyard stay separate. No Master Quest/randomizer data.

Supabase `book_state` stores one counter per key, using `zelda-oot-remake-v1-<type>-<area>`. Updates only write that counter; unrelated counters and Book records are untouched. Initial cloud load is required before editing. Failed saves are cached as a durable pending queue and retried explicitly or on reconnect; status reports failure. Same-counter simultaneous edits are last-writer-wins. Local storage is a fallback, not the primary database.

Hearts = 3 starting + boss containers + floor(pieces/4), with the remainder displayed separately. Counters are bounded by collectible totals.

Browser checks: `node tests/zelda.cjs` from repository root, with the site served at localhost:8766. Database traffic is mocked for these checks.
