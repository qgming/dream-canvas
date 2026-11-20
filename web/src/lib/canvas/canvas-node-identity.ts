import type { CanvasNodeData, CanvasNodeIdentity } from "@/types/canvas";

function validIdentity(node: CanvasNodeData): CanvasNodeIdentity | undefined {
    const identity = node.identity;
    return identity?.type === node.type && Number.isSafeInteger(identity.number) && identity.number > 0 && Number.isSafeInteger(identity.copy) && identity.copy > 0 ? identity : undefined;
}

export function canvasNodeIdentities(nodes: CanvasNodeData[], previous: CanvasNodeData[] = []): Map<string, CanvasNodeIdentity> {
    const existing = previous.length ? canvasNodeIdentities(previous) : new Map<string, CanvasNodeIdentity>();
    const previousTypes = new Map(previous.map((node) => [node.id, node.type]));
    const identities = new Map<string, CanvasNodeIdentity>();
    const numbers = new Map<string, number>();
    const copies = new Map<string, number>();
    const used = new Set<string>();
    const family = (identity: CanvasNodeIdentity) => JSON.stringify([identity.type, identity.number]);
    const key = (identity: CanvasNodeIdentity) => JSON.stringify([identity.type, identity.number, identity.copy]);
    const reserve = (id: string, identity: CanvasNodeIdentity) => {
        identities.set(id, identity);
        numbers.set(identity.type, Math.max(numbers.get(identity.type) || 0, identity.number));
        const familyKey = family(identity);
        copies.set(familyKey, Math.max(copies.get(familyKey) || 0, identity.copy));
        used.add(key(identity));
    };
    for (const identity of existing.values()) {
        numbers.set(identity.type, Math.max(numbers.get(identity.type) || 0, identity.number));
        copies.set(family(identity), Math.max(copies.get(family(identity)) || 0, identity.copy));
    }
    for (const node of nodes) {
        const identity = previousTypes.get(node.id) === node.type ? existing.get(node.id) : undefined;
        if (identity) reserve(node.id, identity);
    }
    const candidates = nodes.filter((node) => !identities.has(node.id));
    for (const node of candidates) {
        const identity = previousTypes.has(node.id) && previousTypes.get(node.id) !== node.type ? undefined : validIdentity(node);
        if (identity && !used.has(key(identity))) reserve(node.id, identity);
    }
    for (const node of candidates) {
        if (identities.has(node.id)) continue;
        const candidate = previousTypes.has(node.id) && previousTypes.get(node.id) !== node.type ? undefined : validIdentity(node);
        const identity = candidate && candidate.copy > 1
            ? { ...candidate, copy: (copies.get(family(candidate)) || candidate.copy) + 1 }
            : { type: node.type, number: (numbers.get(node.type) || 0) + 1, copy: 1 };
        reserve(node.id, identity);
    }
    return identities;
}

export function assignCanvasNodeIdentities(nodes: CanvasNodeData[], previous: CanvasNodeData[]) {
    const identities = canvasNodeIdentities(nodes, previous);
    const previousNodes = new Map(previous.map((node) => [node.id, node]));
    return nodes.map((node) => {
        const identity = identities.get(node.id)!;
        const name = node.name ?? previousNodes.get(node.id)?.name;
        const title = name || node.title;
        return node.identity?.type === identity.type && node.identity.number === identity.number && node.identity.copy === identity.copy && node.name === name && node.title === title ? node : { ...node, identity, ...(name ? { name, title } : {}) };
    });
}

export function copiedCanvasNodeIdentity(source: CanvasNodeData, nodes: CanvasNodeData[]) {
    const identities = canvasNodeIdentities(nodes);
    const current = identities.get(source.id);
    const identity = current?.type === source.type ? current : validIdentity(source);
    if (!identity) return undefined;
    const copy = Math.max(identity.copy, ...[...identities.values()].filter((item) => item.type === source.type && item.number === identity.number).map((item) => item.copy)) + 1;
    return { ...identity, copy };
}

export function formatCanvasNodeName(title: string, identity: CanvasNodeIdentity) {
    return `${title}${identity.number}${identity.copy > 1 ? `(${identity.copy})` : ""}`;
}

export function canvasNodeDisplayName(node: CanvasNodeData, typeTitle: string, identity: CanvasNodeIdentity) {
    return node.name || formatCanvasNodeName(typeTitle, identity);
}

export function copiedCanvasNodeName(source: CanvasNodeData, identity?: CanvasNodeIdentity) {
    if (!source.name || !identity) return undefined;
    const suffix = source.identity && source.identity.copy > 1 ? `(${source.identity.copy})` : "";
    const name = suffix && source.name.endsWith(suffix) ? source.name.slice(0, -suffix.length) : source.name;
    return `${name}(${identity.copy})`;
}
