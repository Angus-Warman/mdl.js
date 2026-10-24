// @ts-check

/**
 * @typedef {{ id: string }} Item
 * @typedef {"add" | "remove" | "change"} StoreEvent
 */

var mdl = (function () {
    "use strict";

    /** @type {Map<string, any>} */
    var registry = new Map();
    /** @type {Map<string, Function>} */
    var compiled = new Map();

    var wrap = function (/** @type {any} */ value, /** @type {any} */ parent) {
        if (Array.isArray(value)) {
            return createStore(value, parent);
        }
        return value;
    };

    var getProp = function (/** @type {any} */ item, /** @type {any} */ prop) {
        var value = item;
        var parts = prop.split(".");
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (value == null || !(part in Object(value))) {
                console.error("[mdl] Missing property \"" + prop + "\"", item);
                return undefined;
            }
            value = value[part];
        }
        return value;
    };

    var setProp = function (/** @type {any} */ item, /** @type {any} */ prop, /** @type {any} */ value) {
        var parts = prop.split(".");
        var last = parts.pop();
        var target = item;
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
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
    };

    function createStore(/** @type {any} */ originals, /** @type {any} */ parent) {
        if (originals === undefined) {
            originals = [];
        }
        /** @type {Map<string, any>} */
        var items = new Map();
        /** @type {Set<any>} */
        var listeners = new Set();
        var storeParent = parent;

        var emit = function (/** @type {any} */ event, /** @type {any} */ item, /** @type {any} */ key) {
            listeners.forEach(function (fn) {
                fn(event, item, key);
            });
        };

        var makeReactive = function (/** @type {any} */ original) {
            var target = /** @type {any} */ ({});
            for (var k in original) {
                if (Object.prototype.hasOwnProperty.call(original, k)) {
                    target[k] = original[k];
                }
            }
            var proxy = new Proxy(target, {
                get: function (t, key, receiver) {
                    if (key === "$parent") return storeParent;
                    if (key === "$get") {
                        return function (/** @type {any} */ prop) {
                            return getProp(proxy, prop);
                        };
                    }
                    if (key === "$set") {
                        return function (/** @type {any} */ prop, /** @type {any} */ value) {
                            return setProp(proxy, prop, value);
                        };
                    }
                    return Reflect.get(t, key, receiver);
                },
                has: function (t, key) {
                    if (key === "$parent") return storeParent !== undefined;
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
            });
            for (var key in target) {
                if (Object.prototype.hasOwnProperty.call(target, key)) {
                    target[key] = wrap(target[key], proxy);
                }
            }
            return proxy;
        };

        var store = {
            isStore: true,
            add: function (/** @type {any} */ original) {
                if (!original.id) {
                    throw new Error(JSON.stringify(original) + ' has no "id" property');
                }
                if (items.has(original.id)) {
                    throw new Error("Duplicate id: " + original.id);
                }
                var item = makeReactive(original);
                items.set(original.id, item);
                emit("add", item, undefined);
                return item;
            },
            get: function (/** @type {any} */ id) {
                return items.get(id);
            },
            remove: function (/** @type {any} */ id) {
                var item = items.get(id);
                if (!item) return;
                items.delete(id);
                emit("remove", item, undefined);
            },
            [Symbol.iterator]: function () {
                return items.values();
            },
            subscribe: function (/** @type {any} */ fn) {
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

    var store = function (/** @type {any} */ items) {
        if (items === undefined) {
            items = [];
        }
        return createStore(items, undefined);
    };

    var compile = function (/** @type {any} */ expr) {
        var fn = compiled.get(expr);
        if (!fn) {
            fn = new Function("item", "store", "event", expr);
            compiled.set(expr, fn);
        }
        return fn;
    };

    var bindButton = function (/** @type {any} */ el, /** @type {any} */ item, /** @type {any} */ storeRef, /** @type {any} */ prop) {
        var update = function () {};
        var run = compile(prop);
        el.addEventListener("click", function (/** @type {any} */ event) {
            run(item, storeRef, event);
        });
        return { prop: prop, update: update };
    };

    var bindCheckbox = function (/** @type {any} */ input, /** @type {any} */ item, /** @type {any} */ prop) {
        var update = function () {
            input.checked = !!getProp(item, prop);
        };
        update();
        input.addEventListener("change", function () {
            setProp(item, prop, input.checked);
        });
        return { prop: prop, update: update };
    };

    var bindInput = function (/** @type {any} */ input, /** @type {any} */ item, /** @type {any} */ prop) {
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

    var bindValue = function (/** @type {any} */ input, /** @type {any} */ item, /** @type {any} */ prop) {
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

    var bindText = function (/** @type {any} */ el, /** @type {any} */ item, /** @type {any} */ prop) {
        var update = function () {
            var v = getProp(item, prop);
            if (v === undefined || v === null) el.textContent = "";
            else el.textContent = v;
        };
        update();
        return { prop: prop, update: update };
    };

    var bindAll = function (/** @type {any} */ root, /** @type {any} */ item, /** @type {any} */ storeRef) {
        var nodes = root.querySelectorAll("[mdl]");
        var result = [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var prop = el.getAttribute("mdl");
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
            if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
                result.push(bindValue(el, item, prop));
                continue;
            }
            result.push(bindText(el, item, prop));
        }
        return result;
    };

    var mount = function (/** @type {any} */ template, /** @type {any} */ storeRef) {
        var end = document.createComment("mdl");
        template.after(end);
        var rendered = new Map();
        var add = function (/** @type {any} */ item) {
            var frag = template.content.cloneNode(true);
            var binds = bindAll(frag, item, storeRef);
            mdl.scan(frag, item);
            var nodes = [];
            var childNodes = frag.childNodes;
            for (var j = 0; j < childNodes.length; j++) {
                nodes.push(childNodes[j]);
            }
            end.before(frag);
            rendered.set(item.id, { nodes: nodes, binds: binds });
        };
        storeRef.subscribe(function (/** @type {any} */ event, /** @type {any} */ item, /** @type {any} */ key) {
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
        });
        var it = storeRef[Symbol.iterator]();
        var res = it.next();
        while (!res.done) {
            add(res.value);
            res = it.next();
        }
    };

    var scan = function (/** @type {any} */ root, /** @type {any} */ scope) {
        if (root === undefined) root = document;
        var templates = root.querySelectorAll("template[mdl]");
        for (var i = 0; i < templates.length; i++) {
            var template = templates[i];
            if (template.dataset.mdlInit) continue;
            var s = scope;
            if (!s) {
                s = (typeof window !== "undefined") ? window : undefined;
            }
            var name = template.getAttribute("mdl");
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

    var register = function (/** @type {any} */ stores) {
        for (var name in stores) {
            if (Object.prototype.hasOwnProperty.call(stores, name)) {
                registry.set(name, stores[name]);
            }
        }
        scan(document, undefined);
    };

    var registerAs = function (/** @type {string} */ name, /** @type {any} */ s) {
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
