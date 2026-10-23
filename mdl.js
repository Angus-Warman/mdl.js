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
        input.checked = !!item[prop];
    };

    update();
    input.addEventListener("change", () => {
        item[prop] = input.checked;
    });
    return { prop, update };
}

/**
 * @param {HTMLInputElement} input
 * @param {any} item
 * @param {string} prop
 */
function bindInput(input, item, prop) {
    const update = () => {
        const value = String(item[prop] ?? "");
        if (input.value !== value) input.value = value;
    };

    update();
    input.addEventListener("input", () => {
        item[prop] = input.value;
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
        const value = String(item[prop] ?? "");
        if (input.value !== value) input.value = value;
    };

    update();
    input.addEventListener("input", () => {
        item[prop] = input.value;
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
        el.textContent = item[prop] ?? "";
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
