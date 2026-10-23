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
    /** @type {any} */
    #parent;
    isStore = true;

    /**
     * @param {T[]} originals
     * @param {any} [parent] item that owns this store, exposed as $parent on its items
     */
    constructor(originals = [], parent = undefined) {
        this.#parent = parent;
        for (const original of originals) this.add(original);
    }

    /**
     * @param {T} original
     * @returns {T} the reactive version of the item
     */
    add(original) {
        if (!original.id) throw new Error(`${JSON.stringify(original)} has no "id" property`);
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

        /** @type {T} */
        const proxy = new Proxy(target, {
            get: (t, key, receiver) => {
                if (key === "$parent") return this.#parent;
                return Reflect.get(t, key, receiver);
            },
            has: (t, key) => {
                if (key === "$parent") return this.#parent !== undefined;
                return Reflect.has(t, key);
            },
            set: (t, key, value, receiver) => {
                const ok = Reflect.set(t, key, wrap(value, proxy), receiver);
                if (typeof key === "string") this.#emit("change", proxy, key);
                return ok;
            },
        });

        for (const key in target) target[key] = wrap(target[key], proxy);
        return proxy;
    }
}

/**
 * Arrays become child stores; everything else passes through.
 * @param {any} value
 * @param {any} [parent]
 */
const wrap = (value, parent) => (Array.isArray(value) ? new Store(value, parent) : value);

/**
 * @template {Item} T
 * @param {T[]} items
 * @returns {Store<T>}
 */
const store = (items) => {
    const s = new Store(items);
    return s;
};

/**
 * Read a property path from an item, logging when part of it is missing.
 * @param {any} item
 * @param {string} prop
 */
function getProp(item, prop) {
    let value = item;
    for (const part of prop.split(".")) {
        if (value == null || !(part in Object(value))) {
            console.error(`[mdl] Missing property "${prop}"`, item);
            return undefined;
        }
        value = value[part];
    }
    return value;
}

/**
 * Write a property path on an item, logging when part of it is missing.
 * @param {any} item
 * @param {string} prop
 * @param {any} value
 */
function setProp(item, prop, value) {
    const parts = prop.split(".");
    const last = /** @type {string} */ (parts.pop());
    let target = item;
    for (const part of parts) {
        if (target == null || !(part in Object(target))) {
            console.error(`[mdl] Missing property "${prop}"`, item);
            return;
        }
        target = target[part];
    }
    if (target == null || !(last in Object(target))) {
        console.error(`[mdl] Missing property "${prop}"`, item);
        return;
    }
    target[last] = value;
}

/**
 * Wire up [mdl] elements in a fragment to an item.
 * @template {Item} T
 * @param {ParentNode} root
 * @param {T} item
 * @param {Store<T>} store
 * @returns {{ prop: string, update: () => void }[]}
 */
function bindAll(root, item, store) {
    return [...root.querySelectorAll("[mdl]")].map((el) => {
        const prop = /** @type {string} */ (el.getAttribute("mdl"));

        if (el instanceof HTMLButtonElement) {
            return bindButton(el, item, store, prop)
        }

        if (el instanceof HTMLInputElement) {
            return el.type === "checkbox"
                ? bindCheckbox(el, item, prop)
                : bindInput(el, item, prop);
        }
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            return bindValue(el, item, prop);
        }
        return bindText(/** @type {HTMLElement} */ (el), item, prop);
    });
}

/**
 * @param {HTMLInputElement} input
 * @param {any} item
 * @param {string} prop
 */
function bindCheckbox(input, item, prop) {
    const update = () => {
        input.checked = !!getProp(item, prop);
    };

    update();
    input.addEventListener("change", () => {
        setProp(item, prop, input.checked);
    });
    return { prop, update };
}

/**
 * @param {HTMLInputElement} input
 * @param {any} item
 * @param {string} prop
 */
function bindInput(input, item, prop) {
    const isNumber = input.type === "number";

    const update = () => {
        const value = String(getProp(item, prop) ?? "");
        if (input.value !== value) input.value = value;
    };

    update();
    input.addEventListener("input", () => {
        setProp(item, prop, isNumber ? Number(input.value) : input.value);
    });
    return { prop, update };
}

/**
 * @param {HTMLTextAreaElement | HTMLSelectElement} input
 * @param {any} item
 * @param {string} prop
 */
function bindValue(input, item, prop) {
    const update = () => {
        const value = String(getProp(item, prop) ?? "");
        if (input.value !== value) input.value = value;
    };

    update();
    input.addEventListener("input", () => {
        setProp(item, prop, input.value);
    });
    return { prop, update };
}

/**
 * @param {HTMLElement} el
 * @param {any} item
 * @param {string} prop
 */
function bindText(el, item, prop) {
    const update = () => {
        el.textContent = getProp(item, prop) ?? "";
    };

    update();
    return { prop, update };
}

/** @type {Map<string, Function>} compiled expressions, cached by source text */
const compiled = new Map();

/**
 * @template {Item} T
 * @param {string} expr
 * @returns {(item: T, store: Store<T>, event: Event) => void}
 */
const compile = (expr) => {
    let fn = compiled.get(expr);
    if (!fn) {
        fn = new Function("item", "store", "event", expr); // the eval-style step
        compiled.set(expr, fn);
    }
    return /** @type {any} */ (fn);
};

/**
 * @template {Item} T
 * @param {HTMLButtonElement} el
 * @param {T} item
 * @param {Store<T>} store
 * @param {string} prop
 */
function bindButton(el, item, store, prop) {
    const update = () => {};

    const run = compile(prop)
    el.addEventListener("click", (event) => run(item, store, event))

    return { prop, update };
}

/**
 * @template {Item} T
 * Stamp out a template once per item and keep it in sync.
 * @param {HTMLTemplateElement} template
 * @param {Store<T>} store
 */
function mount(template, store) {
    const end = document.createComment("mdl");
    template.after(end);

    /** @type {Map<string, { nodes: ChildNode[], binds: ReturnType<typeof bindAll> }>} */
    const rendered = new Map();

    const add = (/** @type {any} */ item) => {
        const frag = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
        const binds = bindAll(frag, item, store);
        mdl.scan(frag, item); // nested templates resolve against this item
        const nodes = [...frag.childNodes];
        end.before(frag);
        rendered.set(item.id, { nodes, binds });
    };

    store.subscribe((event, item, key) => {
        if (event === "add") add(item);
        else if (event === "remove") {
            rendered.get(item.id)?.nodes.forEach((n) => n.remove());
            rendered.delete(item.id);
        } else {
            rendered.get(item.id)?.binds.filter((b) => b.prop === key).forEach((b) => b.update());
        }
    });

    for (const item of store) {
        add(item);
    }
}

var mdl = (() => {
    class Mdl {
        /** @type {Map<string, Store<any>>} */
        #registry = new Map();

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

                scope ??= window;

                const name = /** @type {string} */ (template.getAttribute("mdl"));
                const store = scope[name] ?? this.#registry.get(name);

                if (!store || !(store instanceof Store)) return;

                template.dataset.mdlInit = "1";
                mount(template, store);
            });
        }

        /**
         *
         * @param {*} stores
         */
        register(stores) {
            for (const [name, s] of Object.entries(stores)) {
              this.#registry.set(name, s)
            }
            this.scan()
        }

        /**
         *
         * @param {string} name
         * @param {Store<any>} store
         */
        registerAs(name, store) {
            this.#registry.set(name, store)
            this.scan()
        }
    }

    return new Mdl();
})();
