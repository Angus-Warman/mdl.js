// @ts-check

/**
 * @typedef {{ id: string }} Item
 * @typedef {"add" | "remove" | "change"} StoreEvent
 * @typedef {(event: StoreEvent, item: any, key?: string) => void} StoreListener
 */

/**
 * A keyed collection of reactive items.
 * Array-valued properties on items become child Stores.
 * @template {Item} T
 */
class Store {
    /** @type {Map<string, T>} */
    #items = new Map();
    /** @type {Set<StoreListener>} */
    #listeners = new Set();
    isStore = true;

    /** @param {T[]} originals */
    constructor(originals = []) {
        for (const original of originals) this.add(original);
    }

    /**
     * @param {T} original
     * @returns {T} the reactive version of the item
     */
    add(original) {
        if (!original.id) throw new Error("Every item needs an id");
        if (this.#items.has(original.id)) throw new Error(`Duplicate id: ${original.id}`);

        const item = this.#reactive(original);
        this.#items.set(original.id, item);
        this.#emit("add", item);
        return item;
    }

    /** @param {string} id */
    get(id) {
        return this.#items.get(id);
    }

    /** @param {string} id */
    remove(id) {
        const item = this.#items.get(id);
        if (!item) return;
        this.#items.delete(id);
        this.#emit("remove", item);
    }

    [Symbol.iterator]() {
        return this.#items.values();
    }

    /**
     * @param {StoreListener} fn
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    /** @type {(event: StoreEvent, item: any, key?: string) => void} */
    #emit = (event, item, key) => {
        for (const fn of this.#listeners) fn(event, item, key);
    };

    /**
     * @param {T} original
     * @returns {T}
     */
    #reactive(original) {
        /** @type {any} */
        const target = { ...original };
        for (const key in target) target[key] = wrap(target[key]);

        /** @type {T} */
        const proxy = new Proxy(target, {
            set: (t, key, value, receiver) => {
                const ok = Reflect.set(t, key, wrap(value), receiver);
                if (typeof key === "string") this.#emit("change", proxy, key);
                return ok;
            },
        });
        return proxy;
    }
}

/** Arrays become child stores; everything else passes through. */
const wrap = (/** @type {any} */ value) => (Array.isArray(value) ? new Store(value) : value);

/** Registry of named top-level stores, looked up by <template mdl="name"> */
/** @type {Map<string, Store<any>>} */
const registry = new Map();

/**
 * @template {Item} T
 * @param {string} name  matches <template mdl="name">
 * @param {T[]} items
 * @returns {Store<T>}
 */
const store = (name, items) => {
    const s = new Store(items);
    registry.set(name, s);
    if (document.readyState !== "loading") mdl.scan(); // late registration
    return s;
};

/**
 * Wire up [mdl] elements in a fragment to an item.
 * @param {ParentNode} root
 * @param {any} item
 * @returns {{ prop: string, update: () => void }[]}
 */
function bindAll(root, item) {
    return [...root.querySelectorAll("[mdl]")].map((el) => {
        const input = /** @type {HTMLInputElement} */ (el);
        const prop = /** @type {string} */ (input.getAttribute("mdl"));
        const isCheckbox = input.type === "checkbox";

        const update = () => {
            if (isCheckbox) input.checked = !!item[prop];
            else if ("value" in input) {
                if (input.value !== String(item[prop] ?? "")) input.value = item[prop] ?? "";
            } else input.textContent = item[prop] ?? "";
        };

        update();
        if ("value" in input) {
            input.addEventListener(isCheckbox ? "change" : "input", () => {
                item[prop] = isCheckbox ? input.checked : input.value;
            });
        }
        return { prop, update };
    });
}

/**
 * Stamp out a template once per item and keep it in sync.
 * @param {HTMLTemplateElement} template
 * @param {Store<any>} s
 */
function mount(template, s) {
    const end = document.createComment("mdl");
    template.after(end);

    /** @type {Map<string, { nodes: ChildNode[], binds: ReturnType<typeof bindAll> }>} */
    const rendered = new Map();

    const add = (/** @type {any} */ item) => {
        const frag = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
        const binds = bindAll(frag, item);
        mdl.scan(frag, item); // nested templates resolve against this item
        const nodes = [...frag.childNodes];
        end.before(frag);
        rendered.set(item.id, { nodes, binds });
    };

    s.subscribe((event, item, key) => {
        if (event === "add") add(item);
        else if (event === "remove") {
            rendered.get(item.id)?.nodes.forEach((n) => n.remove());
            rendered.delete(item.id);
        } else {
            rendered.get(item.id)?.binds.filter((b) => b.prop === key).forEach((b) => b.update());
        }
    });

    for (const item of s) add(item);
}

var mdl = (() => {
    class Mdl {
        constructor() {
            const init = () => this.scan();
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", init);
            } else {
                init();
            }
        }

        /**
         * Find unprocessed <template mdl="..."> elements and mount them.
         * @param {ParentNode} root
         * @param {any} [scope] item whose child stores take priority over the registry
         */
        scan(root = document, scope = undefined) {
            root.querySelectorAll("template[mdl]").forEach((el) => {
                const template = /** @type {HTMLTemplateElement} */ (el);
                if (template.dataset.mdlInit) return; // already handled

                const name = /** @type {string} */ (template.getAttribute("mdl"));
                const s = scope?.[name] ?? registry.get(name);
                if (!(s instanceof Store)) return;

                template.dataset.mdlInit = "1";
                mount(template, s);
            });
        }
    }

    return new Mdl();
})();
