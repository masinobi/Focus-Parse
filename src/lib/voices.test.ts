import { describe, expect, it } from "vitest";

import {
  ESTIMATOR_GRACE_MS,
  MAX_ESTIMATOR_GRACE_MS,
  NETWORK_PROBE_GRACE_MS,
  STALL_TIMEOUT_MS,
  graceFor,
  stallTimeoutFor,
  type VoiceLatency,
} from "./speech-timing";
import { filterVoices, shortVoiceName, type VoiceRow } from "./voices";

/**
 * The two halves of a bug report: a voice that would not speak, and a list too
 * long to find one in.
 */

const voice = (over: Partial<VoiceRow> = {}): VoiceRow => ({
  voiceURI: over.name ?? "uri",
  name: "Microsoft Aria Online (Natural) - English (United States)",
  lang: "en-US",
  localService: false,
  ...over,
});

/** A slice of what Edge actually installs, spellings and all. */
const EDGE: VoiceRow[] = [
  voice({ voiceURI: "aria", name: "Microsoft Aria Online (Natural) - English (United States)" }),
  voice({ voiceURI: "guy", name: "Microsoft Guy Online (Natural) - English (United States)" }),
  voice({
    voiceURI: "ryan",
    name: "Microsoft Ryan Online (Natural) - English (United Kingdom)",
    lang: "en-GB",
  }),
  voice({
    voiceURI: "mark",
    name: "Microsoft Mark - English (United States)",
    localService: true,
  }),
  voice({
    voiceURI: "david",
    name: "Microsoft David - English (United States)",
    localService: true,
  }),
  voice({
    voiceURI: "denise",
    name: "Microsoft Denise Online (Natural) - French (France)",
    lang: "fr-FR",
  }),
];

const uris = (list: VoiceRow[]) => list.map((v) => v.voiceURI);

describe("filterVoices", () => {
  it("returns everything for an empty query", () => {
    expect(filterVoices(EDGE, "")).toHaveLength(EDGE.length);
    expect(filterVoices(EDGE, "   ")).toHaveLength(EDGE.length);
  });

  it("finds a voice by the part of its name anyone would type", () => {
    expect(uris(filterVoices(EDGE, "aria"))).toEqual(["aria"]);
    expect(uris(filterVoices(EDGE, "MARK"))).toEqual(["mark"]);
  });

  it("matches a language tag in either spelling", () => {
    // The tag is `en-GB` and the name says "United Kingdom"; a reader may type
    // either and neither should be the wrong answer.
    expect(uris(filterVoices(EDGE, "en-GB"))).toEqual(["ryan"]);
    expect(uris(filterVoices(EDGE, "en gb"))).toEqual(["ryan"]);
    expect(uris(filterVoices(EDGE, "kingdom"))).toEqual(["ryan"]);
  });

  it("separates the voices that need the network from the ones that do not", () => {
    // Directly useful now: a network voice is the one that was being cut off.
    expect(uris(filterVoices(EDGE, "local"))).toEqual(["mark", "david"]);
    expect(uris(filterVoices(EDGE, "online"))).toEqual([
      "aria",
      "guy",
      "ryan",
      "denise",
    ]);
    expect(uris(filterVoices(EDGE, "network"))).toEqual(uris(filterVoices(EDGE, "online")));
  });

  it("requires every term, so a second word narrows rather than widens", () => {
    expect(uris(filterVoices(EDGE, "online english"))).toEqual(["aria", "guy", "ryan"]);
    expect(uris(filterVoices(EDGE, "local english"))).toEqual(["mark", "david"]);
    expect(filterVoices(EDGE, "aria kingdom")).toHaveLength(0);
  });

  it("keeps the platform's own order", () => {
    // A reader who has learned their voice is the fourth one keeps that.
    // Reordering by match quality would move it on every keystroke.
    expect(uris(filterVoices(EDGE, "english"))).toEqual([
      "aria",
      "guy",
      "ryan",
      "mark",
      "david",
    ]);
  });

  it("returns nothing rather than the nearest thing", () => {
    // No scoring and no fallback. An empty list is an answer the caller can
    // explain; a nearest match is a voice nobody asked for.
    expect(filterVoices(EDGE, "arai")).toHaveLength(0);
    expect(filterVoices(EDGE, "klingon")).toHaveLength(0);
  });
});

describe("shortVoiceName", () => {
  it("drops the vendor and the trailing country", () => {
    expect(shortVoiceName("Microsoft Aria Online (Natural) - English (United States)")).toBe(
      "Aria Online (Natural)"
    );
  });

  it("leaves a name with no decoration alone", () => {
    expect(shortVoiceName("Daniel")).toBe("Daniel");
  });

  it("never returns nothing", () => {
    // The label is what a reader picks from. A name that shortened to empty
    // would render a row of blanks that all look identical.
    for (const name of ["Microsoft", "- English (United States)", "Microsoft - x"]) {
      expect(shortVoiceName(name).length).toBeGreaterThan(0);
    }
  });
});

describe("stallTimeoutFor", () => {
  const latency = (over: Partial<VoiceLatency> = {}): VoiceLatency => ({
    voiceURI: "v",
    ms: null,
    utterances: 0,
    boundaries: 0,
    ...over,
  });

  it("never fires before the grace it backs up has expired", () => {
    // The bug, as an invariant. The watchdog was a flat 1600ms while the grace
    // reached 2800, so a voice the estimator was still waiting for had already
    // had its sentence abandoned.
    for (let ms = 0; ms <= MAX_ESTIMATOR_GRACE_MS + 500; ms += 50) {
      const grace = graceFor(latency({ ms }), false);
      expect(stallTimeoutFor(grace, false)).toBeGreaterThan(grace);
    }
  });

  it("covers the slowest voice this machine has actually measured", () => {
    // `/voice-check` recorded first boundaries from 575ms to 2376ms across 49
    // Edge voices. The slow end of that range is a real voice on a real
    // machine, not a margin.
    const grace = graceFor(latency({ ms: 2376 }), false);
    expect(stallTimeoutFor(grace, false)).toBeGreaterThan(2376);
  });

  it("gives a first-time network voice more room than the flat timeout", () => {
    const grace = graceFor(latency(), false);
    expect(grace).toBe(NETWORK_PROBE_GRACE_MS);
    expect(stallTimeoutFor(grace, false)).toBeGreaterThan(STALL_TIMEOUT_MS);
  });

  it("tightens back once the voice has proved it reports", () => {
    // A voice that has fired a boundary is known reachable, so a later silence
    // is a real drop and there is no reason to sit through seconds of it.
    const grace = graceFor(latency({ ms: 2376 }), false);
    expect(stallTimeoutFor(grace, true)).toBe(STALL_TIMEOUT_MS);
  });

  it("leaves a local voice on the flat timeout", () => {
    // Local voices report in tens of milliseconds. Nothing here should slow
    // down the case that was never broken.
    const grace = graceFor(latency(), true);
    expect(grace).toBe(ESTIMATOR_GRACE_MS);
    expect(stallTimeoutFor(grace, false)).toBe(STALL_TIMEOUT_MS);
  });
});
