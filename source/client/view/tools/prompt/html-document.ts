const scope = "lemo.html-prompt"

/** Composes the isolated document and injects its complete public SDK first. */
export default function promptHtmlDocument(html: string, channel: string) {

    const document = new DOMParser().parseFromString(html, "text/html")
    const policy = document.createElement("meta")

    policy.httpEquiv = "Content-Security-Policy"
    policy.content = [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "font-src data:"
    ].join("; ")

    const bootstrap = document.createElement("script")

    bootstrap.textContent = sdk(channel)

    document.head.prepend(policy, bootstrap)

    return `<!doctype html>${document.documentElement.outerHTML}`
}

function sdk(channel: string) {

    return `(() => {
    "use strict";

    const scope = ${JSON.stringify(scope)};
    const channel = ${JSON.stringify(channel)};
    const values = Object.create(null);
    let submitted = false;

    const send = (type, payload = {}) => parent.postMessage({ scope, channel, type, ...payload }, "*");
    const fail = error => {
        if (submitted) return;
        submitted = true;
        send("failure", { error: error instanceof Error ? error.message : String(error || "Interactive document failed") });
    };

    const copy = value => {
        const seen = new Set();

        const visit = (current, depth) => {
            if (depth > 12) throw new Error("form.set() values cannot exceed 12 nested levels");
            if (current === null || typeof current === "string" || typeof current === "boolean") return current;
            if (typeof current === "number" && Number.isFinite(current)) return current;
            if (typeof current !== "object") throw new Error("form.set() accepts only JSON-compatible values");
            if (seen.has(current)) throw new Error("form.set() does not accept circular values");

            seen.add(current);

            const result = Array.isArray(current)
                ? current.map(item => visit(item, depth + 1))
                : Object.fromEntries(Object.entries(current).map(([key, item]) => [key, visit(item, depth + 1)]));

            seen.delete(current);

            return result;
        };

        return visit(value, 0);
    };

    const api = Object.freeze({
        set(key, value) {
            if (submitted) throw new Error("This form has already been submitted");
            if (typeof key !== "string" || !key.trim() || key.length > 64) {
                throw new Error("form.set() requires a key between 1 and 64 characters");
            }

            values[key] = copy(value);

            if (JSON.stringify(values).length > 16000) {
                delete values[key];
                throw new Error("The form result cannot exceed 16000 characters");
            }
        },
        submit() {
            if (submitted) throw new Error("This form has already been submitted");

            submitted = true;
            send("submit", { values: copy(values) });
        }
    });

    Object.defineProperty(globalThis, "form", {
        value: api,
        writable: false,
        configurable: false,
        enumerable: true
    });

    addEventListener("error", event => fail(event.error || event.message));
    addEventListener("unhandledrejection", event => fail(event.reason));
})();`
}
