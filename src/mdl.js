// @ts-check

/** @typedef {{ id: string }} Item */

/** @typedef {"add" | "remove" | "change"} StoreEvent */

/**
 * Helpers available on every reactive item.
 * @typedef {{
 *   $parent: Reactive<any> | undefined,
 *   $get: (prop: string) => any,
 *   $set: (prop: string, value: any) => void,
 * }} ReactiveHelpers
 */

/**
 * An item as seen through its Proxy: the original shape plus helpers.
 * @template {Item} T
 * @typedef {T & ReactiveHelpers} Reactive
 */

/**
 * @template {Item} T
 * @typedef {(event: StoreEvent, item: Reactive<T>, key: string | undefined) => void} StoreListener
 */

/**
 * @template {Item} T
 * @typedef {{
 *   isStore: true,
 *   add: (original: T) => Reactive<T>,
 *   get: (id: string) => Reactive<T> | undefined,
 *   remove: (id: string) => void,
 *   subscribe: (fn: StoreListener<T>) => () => void,
 *   [Symbol.iterator]: () => IterableIterator<Reactive<T>>,
 * }} Store
 */

/** @typedef {{ prop: string, update: () => void }} Binding */

/** @typedef {{ nodes: ChildNode[], binds: Binding[] }} Rendered */

/** @typedef {Record<string, any>} Scope */

/** @typedef {(item: Reactive<any>, store: Store<any>, event: Event) => void} CompiledHandler */

var mdl = (function () {
    "use strict";

    /** @type {Map<string, Store<any>>} */
    var registry = new Map();
    /** @type {Map<string, CompiledHandler>} */
    var compiled = new Map();

    /**
     * Arrays become child stores; everything else passes through.
     * @param {unknown} value
     * @param {Reactive<any> | undefined} parent
     * @returns {any}
     */
    var wrap = function (value, parent) {
        if (Array.isArray(value)) {
            return createStore(value, parent);
        }
        return value;
    };

    /**
     * Read a property path from an item, logging when part of it is missing.
     * @param {any} item
     * @param {string} prop
     * @returns {any}
     */
    var getProp = function (item, prop) {
        var value = item;
        var parts = String(prop).split(".");
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (value == null || !(part in Object(value))) {
                console.error('[mdl] Missing property "' + prop + '"', item);
                return undefined;
            }
            value = value[part];
        }
        return value;
    };

    /**
     * Write a property path on an item, logging when part of it is missing.
     * @param {any} item
     * @param {string} prop
     * @param {any} value
     */
    var setProp = function (item, prop, value) {
        var parts = String(prop).split(".");
        var last = parts.pop();
        if (last === undefined) {
            console.error('[mdl] Missing property "' + prop + '"', item);
            return;
        }
        var target = item;
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (target == null || !(part in Object(target))) {
                console.error('[mdl] Missing property "' + prop + '"', item);
                return;
            }
            target = target[part];
        }
        if (target == null || !(last in Object(target))) {
            console.error('[mdl] Missing property "' + prop + '"', item);
            return;
        }
        target[last] = value;
    };

    /**
     * @template {Item} T
     * @param {T[]} [originals]
     * @param {Reactive<any>} [parent]
     * @returns {Store<T>}
     */
    function createStore(originals, parent) {
        if (originals === undefined) {
            originals = [];
        }
        /** @type {Map<string, Reactive<T>>} */
        var items = new Map();
        /** @type {Set<StoreListener<T>>} */
        var listeners = new Set();
        var storeParent = parent;

        /**
         * @param {StoreEvent} event
         * @param {Reactive<T>} item
         * @param {string | undefined} key
         */
        var emit = function (event, item, key) {
            listeners.forEach(function (fn) {
                fn(event, item, key);
            });
        };

        /**
         * @param {T} original
         * @returns {Reactive<T>}
         */
        var makeReactive = function (original) {
            var target = /** @type {Record<string | symbol, any>} */ ({});
            for (var k in original) {
                if (Object.prototype.hasOwnProperty.call(original, k)) {
                    target[k] = original[k];
                }
            }
            var proxy = /** @type {Reactive<T>} */ (
                /** @type {unknown} */ (
                    new Proxy(target, {
                        get: function (t, key, receiver) {
                            if (key === "$parent") return storeParent;
                            if (key === "$get") {
                                /**
                                 * @param {string} prop
                                 */
                                return function (prop) {
                                    return getProp(proxy, prop);
                                };
                            }
                            if (key === "$set") {
                                /**
                                 * @param {string} prop
                                 * @param {any} value
                                 */
                                return function (prop, value) {
                                    return setProp(proxy, prop, value);
                                };
                            }
                            return Reflect.get(t, key, receiver);
                        },
                        has: function (t, key) {
                            if (key === "$parent")
                                return storeParent !== undefined;
                            if (key === "$get" || key === "$set") return true;
                            return Reflect.has(t, key);
                        },
                        set: function (t, key, value, receiver) {
                            var wrapped = wrap(value, proxy);
                            var ok = Reflect.set(t, key, wrapped, receiver);
                            if (typeof key === "string") {
                                emit("change", proxy, key);
                            }
                            return ok;
                        },
                    })
                )
            );
            for (var key in target) {
                if (Object.prototype.hasOwnProperty.call(target, key)) {
                    target[key] = wrap(target[key], proxy);
                }
            }
            return proxy;
        };

        /** @type {Store<T>} */
        var store = {
            isStore: true,
            /**
             * @param {T} original
             */
            add: function (original) {
                if (!original.id) {
                    throw new Error(
                        JSON.stringify(original) + ' has no "id" property',
                    );
                }
                if (items.has(original.id)) {
                    throw new Error("Duplicate id: " + original.id);
                }
                var item = makeReactive(original);
                items.set(original.id, item);
                emit("add", item, undefined);
                return item;
            },
            /**
             * @param {string} id
             */
            get: function (id) {
                return items.get(id);
            },
            /**
             * @param {string} id
             */
            remove: function (id) {
                var item = items.get(id);
                if (!item) return;
                items.delete(id);
                emit("remove", item, undefined);
            },
            [Symbol.iterator]: function () {
                return items.values();
            },
            /**
             * @param {StoreListener<T>} fn
             */
            subscribe: function (fn) {
                listeners.add(fn);
                return function () {
                    listeners.delete(fn);
                };
            },
        };

        for (var i = 0; i < originals.length; i++) {
            store.add(originals[i]);
        }
        return store;
    }

    /**
     * @template {Item} T
     * @param {T[]} [items]
     * @returns {Store<T>}
     */
    var store = function (items) {
        if (items === undefined) {
            items = [];
        }
        return createStore(items, undefined);
    };

    /**
     * @param {string} expr
     * @returns {CompiledHandler}
     */
    var compile = function (expr) {
        var fn = compiled.get(expr);
        if (!fn) {
            fn = /** @type {CompiledHandler} */ (
                new Function("item", "store", "event", expr)
            );
            compiled.set(expr, fn);
        }
        return fn;
    };

    /**
     * @param {HTMLButtonElement} el
     * @param {Reactive<any>} item
     * @param {Store<any>} storeRef
     * @param {string} prop
     * @returns {Binding}
     */
    var bindButton = function (el, item, storeRef, prop) {
        var update = function () {};
        var run = compile(prop);
        el.addEventListener("click", function (/** @type {Event} */ event) {
            run(item, storeRef, event);
        });
        return { prop: prop, update: update };
    };

    /**
     * @param {HTMLInputElement} input
     * @param {Reactive<any>} item
     * @param {string} prop
     * @returns {Binding}
     */
    var bindCheckbox = function (input, item, prop) {
        var update = function () {
            input.checked = !!getProp(item, prop);
        };
        update();
        input.addEventListener("change", function () {
            setProp(item, prop, input.checked);
        });
        return { prop: prop, update: update };
    };

    /**
     * @param {HTMLInputElement} input
     * @param {Reactive<any>} item
     * @param {string} prop
     * @returns {Binding}
     */
    var bindInput = function (input, item, prop) {
        var isNumber = input.type === "number";
        var update = function () {
            var v = getProp(item, prop);
            if (v === undefined || v === null) v = "";
            var value = String(v);
            if (input.value !== value) input.value = value;
        };
        update();
        input.addEventListener("input", function () {
            setProp(item, prop, isNumber ? Number(input.value) : input.value);
        });
        return { prop: prop, update: update };
    };

    /**
     * @param {HTMLTextAreaElement | HTMLSelectElement} input
     * @param {Reactive<any>} item
     * @param {string} prop
     * @returns {Binding}
     */
    var bindValue = function (input, item, prop) {
        var update = function () {
            var v = getProp(item, prop);
            if (v === undefined || v === null) v = "";
            var value = String(v);
            if (input.value !== value) input.value = value;
        };
        update();
        input.addEventListener("input", function () {
            setProp(item, prop, input.value);
        });
        return { prop: prop, update: update };
    };

    /**
     * @param {HTMLElement} el
     * @param {Reactive<any>} item
     * @param {string} prop
     * @returns {Binding}
     */
    var bindText = function (el, item, prop) {
        var update = function () {
            var v = getProp(item, prop);
            if (v === undefined || v === null) el.textContent = "";
            else el.textContent = String(v);
        };
        update();
        return { prop: prop, update: update };
    };

    /**
     * @param {ParentNode} root
     * @param {Reactive<any>} item
     * @param {Store<any>} storeRef
     * @returns {Binding[]}
     */
    var bindAll = function (root, item, storeRef) {
        var nodes = /** @type {NodeListOf<HTMLElement>} */ (
            root.querySelectorAll("[mdl]")
        );
        /** @type {Binding[]} */
        var result = [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var prop = /** @type {string} */ (el.getAttribute("mdl"));
            if (el instanceof HTMLButtonElement) {
                result.push(bindButton(el, item, storeRef, prop));
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
            if (
                el instanceof HTMLTextAreaElement ||
                el instanceof HTMLSelectElement
            ) {
                result.push(bindValue(el, item, prop));
                continue;
            }
            result.push(bindText(el, item, prop));
        }
        return result;
    };

    /**
     * @param {HTMLTemplateElement} template
     * @param {Store<any>} storeRef
     */
    var mount = function (template, storeRef) {
        var end = document.createComment("mdl");
        template.after(end);
        /** @type {Map<string, Rendered>} */
        var rendered = new Map();
        /**
         * @param {Reactive<any>} item
         */
        var add = function (item) {
            var frag = /** @type {DocumentFragment} */ (
                template.content.cloneNode(true)
            );
            var binds = bindAll(frag, item, storeRef);
            mdl.scan(frag, item);
            /** @type {ChildNode[]} */
            var nodes = [];
            var childNodes = frag.childNodes;
            for (var j = 0; j < childNodes.length; j++) {
                nodes.push(childNodes[j]);
            }
            end.before(frag);
            rendered.set(item.id, { nodes: nodes, binds: binds });
        };
        storeRef.subscribe(
            function (
                /** @type {StoreEvent} */ event,
                /** @type {Reactive<any>} */ item,
                /** @type {string | undefined} */ key,
            ) {
                if (event === "add") {
                    add(item);
                } else if (event === "remove") {
                    var r = rendered.get(item.id);
                    if (r) {
                        for (var k = 0; k < r.nodes.length; k++) {
                            r.nodes[k].remove();
                        }
                        rendered.delete(item.id);
                    }
                } else {
                    var r2 = rendered.get(item.id);
                    if (r2) {
                        for (var m = 0; m < r2.binds.length; m++) {
                            if (r2.binds[m].prop === key) {
                                r2.binds[m].update();
                            }
                        }
                    }
                }
            },
        );
        var it = storeRef[Symbol.iterator]();
        var res = it.next();
        while (!res.done) {
            add(res.value);
            res = it.next();
        }
    };

    /**
     * @param {ParentNode} [root]
     * @param {Scope} [scope]
     */
    var scan = function (root, scope) {
        if (root === undefined) root = document;
        var templates = /** @type {NodeListOf<HTMLTemplateElement>} */ (
            root.querySelectorAll("template[mdl]")
        );
        for (var i = 0; i < templates.length; i++) {
            var template = templates[i];
            if (template.dataset.mdlInit) continue;
            /** @type {Scope | undefined} */
            var s = scope;
            if (!s) {
                s = typeof window !== "undefined" ? window : undefined;
            }
            var name = /** @type {string} */ (template.getAttribute("mdl"));
            /** @type {Store<any> | undefined} */
            var storeRef = undefined;
            if (s && s[name]) {
                storeRef = s[name];
            } else {
                storeRef = registry.get(name);
            }
            if (!storeRef || !storeRef.isStore) continue;
            template.dataset.mdlInit = "1";
            mount(template, storeRef);
        }
    };

    /**
     * @param {Record<string, Store<any>>} stores
     */
    var register = function (stores) {
        for (var name in stores) {
            if (Object.prototype.hasOwnProperty.call(stores, name)) {
                registry.set(name, stores[name]);
            }
        }
        scan(document, undefined);
    };

    /**
     * @param {string} name
     * @param {Store<any>} s
     */
    var registerAs = function (name, s) {
        registry.set(name, s);
        scan(document, undefined);
    };

    var api = {
        config: {
            errorOnUndefinedPropertyAccess: true,
        },
        register: register,
        registerAs: registerAs,
        scan: scan,
        createStore: createStore,
    };

    var init = function () {
        scan(document, undefined);
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
