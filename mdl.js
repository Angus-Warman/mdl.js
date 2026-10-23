console.log("Hello World");

var mdl = (() => {
    class Mdl {
        constructor() {
            const init = () => {
                this.scan();
            };
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", init);
            } else {
                init();
            }
        }

        scan() {
            document.querySelectorAll("template").forEach(el => {
                if (el.dataset.mdlInit) return; // Already handled

                const mdlBind = el.dataset["mdl-bind"]

                if (!mdlBind) return;

                const store = window[mdlBind]

                if (!store || !store.isStore) return;

                console.log({ el, store })
            })
        }
    }

    return new Mdl();
})();

class Store {
    #itemsByID;
    isStore = true;

    /**
     * @template {{ id: string }} T
     * @param {T[]} originals
     */
    constructor(originals) {
        /** @typedef {Record<string, T>} */
        this.#itemsByID = {}

        for (var original of originals) {
            if (!original.id) continue; // Error?

            this.#itemsByID[original.id] = storeItem(original)
        }
    }

    /**
     *
     * @param {string} id
     * @returns T
     */
    get(id) {
        return this.#itemsByID[id]
    }
}

const store = (items) => new Store(items);

const storeItem = (item) => {
    return new Proxy(item, {
        get(target, key, receiver) {
            console.log(`read ${String(key)}`);
            return Reflect.get(target, key, receiver);
        },
        set(target, key, value, receiver) {
            console.log(`write ${String(key)} = ${value}`);
            return Reflect.set(target, key, value, receiver);
        },
    });
};
