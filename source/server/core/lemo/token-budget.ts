/**
 * Temporary provider-neutral token estimate.
 *
 * Exact tokenization belongs to the selected LLM Model. Until Models expose
 * that capability, Lemo uses one deterministic UTF-8 estimate everywhere so
 * every perceptual-field budget and lazy block page has the same unit.
 */
export function estimatedTokens(value: string) {

    return value ? Math.max(1, Math.ceil(new TextEncoder().encode(value).length / bytesPerToken)) : 0
}

export function tokenSlice(value: string, maximum: number, offset = 0): TokenSlice {

    if (!Number.isInteger(maximum) || maximum < 1) throw new Error("A token slice requires a positive limit")
    if (!Number.isInteger(offset) || offset < 0 || offset > value.length) {
        throw new Error("A token slice requires a valid offset")
    }

    const remaining = value.slice(offset)
    const total = estimatedTokens(value)

    if (estimatedTokens(remaining) <= maximum) {
        return Object.freeze({ content: remaining, next: null, tokens: estimatedTokens(remaining), total })
    }

    let lower = 1
    let upper = remaining.length

    while (lower < upper) {
        const middle = Math.ceil((lower + upper) / 2)

        if (estimatedTokens(remaining.slice(0, middle)) <= maximum) lower = middle
        else upper = middle - 1
    }

    const end = codePointBoundary(value, offset + lower)
    const content = value.slice(offset, end)

    return Object.freeze({
        content,
        next: end < value.length ? end : null,
        tokens: estimatedTokens(content),
        total
    })
}

function codePointBoundary(value: string, offset: number) {

    if (offset <= 0 || offset >= value.length) return offset

    const previous = value.charCodeAt(offset - 1)
    const next = value.charCodeAt(offset)

    return previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF
        ? offset - 1
        : offset
}

export type TokenSlice = Readonly<{
    content: string
    next: number | null
    tokens: number
    total: number
}>

const bytesPerToken = 4
