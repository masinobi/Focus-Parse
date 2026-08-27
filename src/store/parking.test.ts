import { beforeEach, describe, expect, it } from "vitest";

import type { FlowNode } from "@/lib/types";
import { parkedNodes, readingNodes, useFocusStore } from "./useFocusStore";

/**
 * The parking lot's one invariant, stated three ways.
 *
 * A parked thought is stored with the real captures because it has to survive a
 * reload and it carries the token it was dropped at. What it must never do is
 * take part in the reading: it is not in the map, not in the chain, and not in
 * the captures shown beside the summary box. Each of those is a separate
 * surface that could forget, which is why the predicate is shared and why the
 * chain rule is asserted against the store rather than against the predicate.
 */

const fresh = useFocusStore.getState();

beforeEach(() => {
  useFocusStore.setState({ nodes: [], chainHead: null, tokenIndex: 0 });
});

const node = (over: Partial<FlowNode> = {}): FlowNode => ({
  id: "n1",
  tag: null,
  text: "a note",
  section: 0,
  tokenIndex: 0,
  createdAt: 0,
  ...over,
});

describe("readingNodes / parkedNodes", () => {
  it("splits the captures from the parked thoughts", () => {
    const nodes = [
      node({ id: "a", tag: "entity" }),
      node({ id: "b", parked: true }),
      node({ id: "c", tag: "output" }),
    ];
    expect(readingNodes(nodes).map((n) => n.id)).toEqual(["a", "c"]);
    expect(parkedNodes(nodes).map((n) => n.id)).toEqual(["b"]);
  });

  it("treats a node written before parking existed as not parked", () => {
    // Sessions carry no schema version, so every node already on disk reads
    // back with no `parked` key at all. If that ever read as parked, a reader's
    // entire existing map would vanish from the graph on upgrade.
    const legacy = node({ id: "old" });
    expect("parked" in legacy).toBe(false);
    expect(readingNodes([legacy])).toHaveLength(1);
    expect(parkedNodes([legacy])).toHaveLength(0);
  });

  it("keeps a parked thought that is explicitly false out of the parked list", () => {
    expect(parkedNodes([node({ parked: false })])).toHaveLength(0);
  });
});

describe("addNode", () => {
  it("attaches an ordinary capture to the open chain and hands the chain on", () => {
    const { addNode } = fresh;
    addNode("the sponsor", "entity");
    const first = useFocusStore.getState().nodes[0];
    useFocusStore.setState({ chainHead: first.id });

    addNode("reconciles the data", "mechanism");
    const after = useFocusStore.getState();
    const second = after.nodes[1];

    expect(after.nodes[0].links).toEqual([second.id]);
    expect(after.chainHead).toBe(second.id);
  });

  it("never links a parked thought into the chain", () => {
    const { addNode } = fresh;
    addNode("the sponsor", "entity");
    const head = useFocusStore.getState().nodes[0];
    useFocusStore.setState({ chainHead: head.id });

    addNode("renew the car insurance", null, true);
    const after = useFocusStore.getState();

    expect(after.nodes).toHaveLength(2);
    expect(after.nodes[1].parked).toBe(true);
    // The chain is untouched in both directions: nothing points at the parked
    // note, and the next real capture still attaches to the same head.
    expect(after.nodes[0].links ?? []).toEqual([]);
    expect(after.chainHead).toBe(head.id);
  });

  it("refuses to tag a parked thought even when handed a tag", () => {
    // The trigger path cannot do this, but a caller could, and a parked node
    // with a tag would draw in the graph's lane for that tag.
    const { addNode } = fresh;
    addNode("unrelated", "mechanism", true);
    const [only] = useFocusStore.getState().nodes;
    expect(only.parked).toBe(true);
    expect(only.tag).toBeNull();
  });

  it("keeps the token a thought was parked at, so the reader can get back", () => {
    const { addNode } = fresh;
    useFocusStore.setState({ tokenIndex: 4291 });
    addNode("ask about the audit trail", null, true);
    expect(useFocusStore.getState().nodes[0].tokenIndex).toBe(4291);
  });

  it("marks nothing as parked by default", () => {
    const { addNode } = fresh;
    addNode("an ordinary note", null);
    expect(useFocusStore.getState().nodes[0].parked).toBeUndefined();
  });
});
