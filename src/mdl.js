// @ts-check

/**
 * @typedef {{ id: string }} Item
 * @typedef {"add" | "remove" | "change"} StoreEvent
 * @typedef {(event: StoreEvent, item: any, key?: string) => void} StoreListener
 */

var mdl = (function () {
    "use strict";

    /** @type {Map<string, Store>} */
    const registry = new Map();
    /** @type {Map<string, Function>} compiled expressions, cached by source text */
    const compiled = new Map();

    /**
     * Arrays become child stores; everything else passes through.
     * @param {any} value
     * @param {any} [parent]
     */
    const wrap = (value, parent) => (Array.isArray(value) ? createStore(value, parent) : value);

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
     * @template {Item} T
     * @param {T[]} [originals]
     * @param {any} [parent]
     * @returns {Store<T>}
     */
    function createStore(originals = [], parent = undefined) {
        /** @type {Map<string, T>} */
        const items = new Map();
        /** @type {Set<StoreListener>} */
        const listeners = new Set();
        /** @type {any} */
        let storeParent = parent;

        const emit = (event, item, key) => {
            for (const fn of listeners) fn(event, item, key);
        };

        /**
         * @param {T} original
         * @returns {T}
         */
        const makeReactive = (original) => {
            /** @type {any} */
            const target = { ...original };

            /** @type {T} */
            const proxy = new Proxy(target, {
                get: (t, key, receiver) => {
                    if (key === "$parent") return storeParent;
                    return Reflect.get(t, key, receiver);
                },
                has: (t, key) => {
                    if (key === "$parent") return storeParent !== undefined;
                    return Reflect.has(t, key);
                },
                set: (t, key, value, receiver) => {
                    const ok = Reflect.set(t, key, wrap(value, proxy), receiver);
                    if (typeof key === "string") emit("change", proxy, key);
                    return ok;
                },
            });

            for (const key in target) target[key] = wrap(target[key], proxy);
            return proxy;
        };

        const store = {
            isStore: true,
            /**
             * @param {T} original
             * @returns {T}
             */
            add(original) {
                if (!original.id) throw new Error(`${JSON.stringify(original)} has no "id" property`);
                if (items.has(original.id)) throw new Error(`Duplicate id: ${original.id}`);
                const item = makeReactive(original);
                items.set(original.id, item);
                emit("add", item);
                return item;
            },
            /** @param {string} id */
            get(id) {
                return items.get(id);
            },
            /** @param {string} id */
            remove(id) {
                const item = items.get(id);
                if (!item) return;
                items.delete(id);
                emit("remove", item);
            },
            [Symbol.iterator]() {
                return items.values();
            },
            /**
             * @param {StoreListener} fn
             * @returns {() => void} unsubscribe
             */
            subscribe(fn) {
                listeners.add(fn);
                return () => listeners.delete(fn);
            },
        };
        for (const original of originals) store.add(original);
        return store;
    }

    // Keep Store as constructor-like function for compatibility
    function Store(originals = [], parent = undefined) {
        const s = createStore(originals, parent);
        // Copy properties onto instance
        Object.setPrototypeOf ? 0 : 0;
        // Make it callable-like compatible
        const inst = /** @type {any} */ (s);
        inst.constructor = Store;
        return s;
    }
    Store.prototype = {};

    /**
     * @template {Item} T
     * @param {T[]} items
     * @returns {Store<T>}
     */
    const store = (items = []) => createStore(items);

    /**
     * @param {string} expr
     * @returns {(item: any, store: Store<any>, event: Event) => void}
     */
    const compile = (expr) => {
        let fn = compiled.get(expr);
        if (!fn) {
            fn = new Function("item", "store", "event", expr);
            compiled.set(expr, fn);
        }
        return /** @type {any} */ (fn);
    };

    /**
     * @param {HTMLButtonElement} el
     * @param {any} item
     * @param {Store<any>} store
     * @param {string} prop
     */
    function bindButton(el, item, store, prop) {
        const update = () => {};
        const run = compile(prop);
        el.addEventListener("click", (event) => run(item, store, event));
        return { prop, update };
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

    /**
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
                return bindButton(el, item, store, prop);
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
            mdl.scan(frag, item);
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

    /**
     * Find unprocessed <template mdl="..."> elements and mount them.
     * @param {ParentNode} [root]
     * @param {any} [scope] item whose child stores take priority over the registry
     */
    function scan(root = document, scope = undefined) {
        root.querySelectorAll("template[mdl]").forEach((el) => {
            const template = /** @type {HTMLTemplateElement} */ (el);
            if (template.dataset.mdlInit) return;
            scope ??= (typeof window !== "undefined" ? window : undefined);
            const name = /** @type {string} */ (template.getAttribute("mdl"));
            const s = scope && scope[name] ? scope[name] : registry.get(name);
            if (!s || !(s.isStore)) return;
            template.dataset.mdlInit = "1";
            mount(template, s);
        });
    }

    /**
     * @param {*} stores
     */
    function register(stores) {
        for (const [name, s] of Object.entries(stores)) {
            registry.set(name, s);
        }
        scan();
    }

    /**
     * @param {string} name
     * @param {Store<any>} store
     */
    function registerAs(name, s) {
        registry.set(name, s);
        scan();
    }

    const api = {
        config: {
            errorOnUndefinedPropertyAccess: true,
        },
        register,
        registerAs,
        scan,
        createStore,
    };

    const init = () => scan();
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    // Expose helpers for compatibility
    api.getProp = getProp;
    api.setProp = setProp;
    api.store = store;
    api.Store = Store;

    return api;
})();

var store = mdl.createStore || mdl.store;
var Store = mdl.Store || (function(items, parent){ return mdl.createStore(items, parent); });
var getProp = mdl.getProp;
var setProp = mdl.setProp;
// For compatibility
if (typeof globalThis !== "undefined") {
    globalThis.__exports = { store: store, Store: Store, getProp: getProp, setProp: setProp };
}
