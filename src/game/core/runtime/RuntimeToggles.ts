export type RuntimeSource = "query" | "storage";

function safeGetSearchParams(): URLSearchParams | null {
    try {
        return new URLSearchParams(window.location.search);
    } catch {
        return null;
    }
}

function safeGetStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function parseBoolean(raw: string): boolean | null {
    if (raw === "1" || raw.toLowerCase() === "true") return true;
    if (raw === "0" || raw.toLowerCase() === "false") return false;
    return null;
}

function parseNumber(raw: string): number | null {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

function normalizeRaw(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    if (raw === "") return null;
    return raw;
}

export function readStringFromQuery(key: string): string | null {
    const params = safeGetSearchParams();
    return normalizeRaw(params?.get(key));
}

export function readStringFromStorage(key: string): string | null {
    const storage = safeGetStorage();
    return normalizeRaw(storage?.getItem(key));
}

export function readString(key: string): string | null {
    return readStringFromQuery(key) ?? readStringFromStorage(key);
}

export function readBooleanFlag(key: string): boolean | null {
    const raw = readString(key);
    if (raw === null) return null;
    return parseBoolean(raw);
}

export function readNumber(key: string): number | null {
    const raw = readString(key);
    if (raw === null) return null;
    return parseNumber(raw);
}

export function readEnum<T extends string>(key: string, allowed: readonly T[]): T | null {
    const raw = readString(key);
    if (raw === null) return null;

    return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function readBooleanFlagFromQuery(key: string): boolean | null {
    const raw = readStringFromQuery(key);
    if (raw === null) return null;
    return parseBoolean(raw);
}

export function readBooleanFlagFromStorage(key: string): boolean | null {
    const raw = readStringFromStorage(key);
    if (raw === null) return null;
    return parseBoolean(raw);
}

export function readNumberFromQuery(key: string): number | null {
    const raw = readStringFromQuery(key);
    if (raw === null) return null;
    return parseNumber(raw);
}

export function readNumberFromStorage(key: string): number | null {
    const raw = readStringFromStorage(key);
    if (raw === null) return null;
    return parseNumber(raw);
}

export function readEnumFromQuery<T extends string>(key: string, allowed: readonly T[]): T | null {
    const raw = readStringFromQuery(key);
    if (raw === null) return null;
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function readEnumFromStorage<T extends string>(key: string, allowed: readonly T[]): T | null {
    const raw = readStringFromStorage(key);
    if (raw === null) return null;
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function readBooleanWithCompat(params: {
    key: string;
    compatKeys?: string[];
}): boolean | null {
    const direct = readBooleanFlag(params.key);
    if (direct !== null) return direct;

    for (const compat of params.compatKeys ?? []) {
        const v = readBooleanFlag(compat);
        if (v !== null) return v;
    }

    return null;
}
