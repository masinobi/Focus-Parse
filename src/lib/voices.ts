/**
 * Finding one voice in a list of a hundred.
 *
 * Edge installs well over a hundred, most of them languages this reader does
 * not want, all of them named with the same platform decoration — "Microsoft
 * Aria Online (Natural) - English (United States)". A bare `<select>` over that
 * is a scroll, and the thing being scrolled for is usually four letters long.
 *
 * Matching is a plain conjunctive substring test over a normalized haystack:
 * every whitespace-separated term in the query has to appear somewhere in the
 * voice's name, its language tag, or the words describing where it runs. No
 * scoring, no ranking, no nearest match — for the same reason the blueprint
 * matcher refuses them. A search box that reorders results by a similarity
 * score makes "why is that first" unanswerable, and a wrong voice chosen from
 * a confident-looking list is a session read in the wrong accent.
 */

export interface VoiceRow {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

/**
 * Everything a query may match against, as one lowercase string.
 *
 * Punctuation is left in, and only the *query* is split on it. That asymmetry
 * is deliberate and it is what makes `en-US`, `en US` and `(United States)`
 * interchangeable: the query becomes terms that contain no punctuation at all,
 * so each one is a substring of the raw name or tag whether the separator is a
 * hyphen, a bracket or a space. Stripping punctuation here as well was in the
 * first draft and no break could reach it — removing characters from the
 * haystack can only lose matches, never gain them, and a term that could span
 * where the punctuation had been is a term the query split in two.
 *
 * `online` and `network` are synonyms here and neither appears in a voice name
 * on every platform, which is the point: the distinction is carried by
 * `localService`, and after the stall-timeout bug it is the first thing worth
 * being able to filter on.
 */
export function voiceHaystack(voice: VoiceRow): string {
  const where = voice.localService
    ? "local offline on device"
    : "online network cloud";
  return `${voice.name} ${voice.lang} ${where}`.toLowerCase().trim();
}

/** The query, reduced the same way and split into terms. */
export function voiceTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Voices matching every term of the query, in the order the platform gave them.
 *
 * Order is deliberately untouched. The platform's order is stable across
 * sessions, so a reader who has learned that their voice is the fourth one
 * keeps that; reordering by match quality would move it on every keystroke.
 *
 * An empty query returns everything, which makes the caller's "show all" case
 * the same code path as a filtered one.
 */
export function filterVoices<T extends VoiceRow>(voices: T[], query: string): T[] {
  const terms = voiceTerms(query);
  if (!terms.length) return voices;

  return voices.filter((voice) => {
    const haystack = voiceHaystack(voice);
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * The part of a voice name worth showing in a cramped row.
 *
 * Every Microsoft voice starts with "Microsoft" and most end with a
 * parenthesised country that the language tag beside it already says. Dropping
 * both leaves the part that distinguishes one voice from another, which is what
 * a list is for. The full name stays available as a title attribute — this
 * shortens the label, it never becomes the identity: selection is by
 * `voiceURI`.
 */
export function shortVoiceName(name: string): string {
  const trimmed = name
    .replace(/^(microsoft|google|apple)\s+/i, "")
    .replace(/\s*-\s*[^-]+$/, "")
    .trim();
  return trimmed || name;
}
