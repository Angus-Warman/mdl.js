// @ts-check

/**
 * @typedef {{ id: string }} Item
 * @typedef {"add" | "remove" | "change"} StoreEvent
 * @typedef {(event: StoreEvent, item: any, key?: string) => void} StoreListener
 */

var mdl = (function () {
    "use strict";

    /** @type {Map<string, any>} */
    const registry = new Map();
    /** @type {Map<string, Function>} */
    const compiled = new Map();

    const wrap = (value, parent) => (Array.isArray(value) ? createStore(value, parent) : value);

    function getProp(item, prop) {
        let value = item;
        for (const part of prop.split(".")) {
            if (value == null || !(part in Object(value))) {
                console.error("[mdl] Missing property \"" + prop + "\"", item);
                return undefined;
            }
            value = value[part];
        }
        return value;
    }

    function setProp(item, prop, value) {
        const parts = prop.split(".");
        const last = parts.pop();
        let target = item;
        for (const part of parts) {
            if (target == null || !(part in Object(target))) {
                console.error("[mdl] Missing property \"" + prop + "\"", item);
                return;
            }
            target = target[part];
        }
        if (target == null || !(last in Object(target))) {
            console.error("[mdl] Missing property \"" + prop + "\"", item);
            return;
        }
        target[last] = value;
    }

    function createStore(originals, parent) {
        if (originals === undefined) originals = [];
        /** @type {Map<string, any>} */
        const items = new Map();
        /** @type {Set<Function>} */
        const listeners = new Set();
        let storeParent = parent;

        const emit = function (event, item, key) {
            for (const fn of listeners) {
                fn(event, item, key);
            }
        };

        const makeReactive = function (original) {
            const target = Object.assign({}, original);
            const proxy = new Proxy(target, {
                get: function (t, key, receiver) {
                    if (key === "$parent") return storeParent;
                    return Reflect.get(t, key, receiver);
                },
                has: function (t, key) {
                    if (key === "$parent") return storeParent !== undefined;
                    return Reflect.has(t, key);
                },
                set: function (t, key, value, receiver) {
                    const ok = Reflect.set(t, key, wrap(value, proxy), receiver);
                    if (typeof key === "string") emit("change", proxy, key);
                    return ok;
                },
            });
            for (const key in target) {
                target[key] = wrap(target[key], proxy);
            }
            return proxy;
        };

        const store = {
            isStore: true,
            add: function (original) {
                if (!original.id) throw new Error(JSON.stringify(original) + ' has no "id" property');
                if (items.has(original.id)) throw new Error("Duplicate id: " + original.id);
                const item = makeReactive(original);
                items.set(original.id, item);
                emit("add", item);
                return item;
            },
            get: function (id) {
                return items.get(id);
            },
            remove: function (id) {
                const item = items.get(id);
                if (!item) return;
                items.delete(id);
                emit("remove", item);
            },
            [Symbol.iterator]: function () {
                return items.values();
            },
            subscribe: function (fn) {
                listeners.add(fn);
                return function () {
                    listeners.delete(fn);
                };
            },
        };
        for (let i = 0; i < originals.length; i++) {
            store.add(originals[i]);
        }
        return store;
    }

    const store = function (items) {
        if (items === undefined) items = [];
        return createStore(items);
    };

    const compile = function (expr) {
        let fn = compiled.get(expr);
        if (!fn) {
            fn = new Function("item", "store", "event", expr);
            compiled.set(expr, fn);
        }
        return fn;
    };

    function bindButton(el, item, store, prop) {
        const update = function () {};
        const run = compile(prop);
        el.addEventListener("click", function (event) {
            run(item, store, event);
        });
        return { prop: prop, update: update };
    }

    function bindCheckbox(input, item, prop) {
        const update = function () {
            input.checked = !!getProp(item, prop);
        };
        update();
        input.addEventListener("change", function () {
            setProp(item, prop, input.checked);
        });
        return { prop: prop, update: update };
    }

    function bindInput(input, item, prop) {
        const isNumber = input.type === "number";
        const update = function () {
            const value = String(getProp(item, prop) === undefined || getProp(item, prop) === null ? "" : getProp(item, prop));
            if (input.value !== value) input.value = value;
        };
        update();
        input.addEventListener("input", function () {
            setProp(item, prop, isNumber ? Number(input.value) : input.value);
        });
        return { prop: prop, update: update };
    }

    function bindValue(input, item, prop) {
        const update = function () {
            const value = String(getProp(item, prop) === undefined || getProp(item, prop) === null ? "" : getProp(item, prop));
            if (input.value !== value) input.value = value;
        };
        update();
        input.addEventListener("input", function () {
            setProp(item, prop, input.value);
        });
        return { prop: prop, update: update };
    }

    function bindText(el, item, prop) {
        const update = function () {
            el.textContent = getProp(item, prop) === undefined || getProp(item, prop) === null ? "" : getProp(item, prop);
        };
        update();
        return { prop: prop, update: update };
    }

    function bindAll(root, item, store) {
        const nodes = root.querySelectorAll("[mdl]");
        const result = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const prop = el.getAttribute("mdl");
            if (el instanceof HTMLButtonElement) {
                result.push(bindButton(el, item, store, prop));
                continue;
            }
            if (el instanceof HTMLInputElement) {
                if (el.type === "checkbox") {
                    result.push(bindCheckbox(el, item, prop));
                } else {
                    result.push(bindInput(el, item, prop));
                }
                continue;
            }
            if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
                result.push(bindValue(el, item, prop));
                continue;
            }
            result.push(bindText(el, item, prop));
        }
        return result;
    }

    function mount(template, store) {
        const end = document.createComment("mdl");
        template.after(end);
        const rendered = new Map();
        const add = function (item) {
            const frag = template.content.cloneNode(true);
            const binds = bindAll(frag, item, store);
            mdl.scan(frag, item);
            const nodes = [];
            const childNodes = frag.childNodes;
            for (let i = 0; i < childNodes.length; i++) nodes.push(childNodes[i]);
            end.before(frag);
            rendered.set(item.id, { nodes: nodes, binds: binds });
        };
        store.subscribe(function (event, item, key) {
            if (event === "add") {
                add(item);
            } else if (event === "remove") {
                const r = rendered.get(item.id);
                if (r) {
                    for (let i = 0; i < r.nodes.length; i++) r.nodes[i].remove();
                    rendered.delete(item.id);
                }
            } else {
                const r = rendered.get(item.id);
                if (r) {
                    for (let i = 0; i < r.binds.length; i++) {
                        if (r.binds[i].prop === key) r.binds[i].update();
                    }
                }
            }
        });
        const it = store[Symbol.iterator]();
        let res = it.next();
        while (!res.done) {
            add(res.value);
            res = it.next();
        }
    }

    function scan(root, scope) {
        if (root === undefined) root = document;
        const templates = root.querySelectorAll("template[mdl]");
        for (let i = 0; i < templates.length; i++) {
            const template = templates[i];
            if (template.dataset.mdlInit) continue;
            let s = scope;
            if (!s) s = (typeof window !== "undefined") ? window : undefined;
            const name = template.getAttribute("mdl");
            let storeRef = undefined;
            if (s && s[name]) storeRef = s[name];
            else storeRef = registry.get(name);
            if (!storeRef || !storeRef.isStore) continue;
            template.dataset.mdlInit = "1";
            mount(template, storeRef);
        }
    }

    function register(stores) {
        for (const name in stores) {
            if (Object.prototype.hasOwnProperty.call(stores, name)) {
                registry.set(name, stores[name]);
            }
        }
        scan();
    }

    function registerAs(name, s) {
        registry.set(name, s);
        scan();
    }

    const api = {
        config: {
            errorOnUndefinedPropertyAccess: true,
        },
        register: register,
        registerAs: registerAs,
        scan: scan,
        createStore: createStore,
    };

    const init = function () {
        scan();
    };
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    return api;
})();

var store = mdl.createStore;
