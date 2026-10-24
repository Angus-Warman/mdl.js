const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "mdl.js"), "utf8");

function loadMdl() {
    const errors = [];
    const document = {
        readyState: "loading",
        addEventListener() {},
        querySelectorAll() {
            return [];
        },
    };
    const context = {
        document,
        window: {},
        console: { error: (...args) => errors.push(args) },
    };

    vm.createContext(context);
    vm.runInContext(
        `${source}\nglobalThis.__exports = { store };`,
        context,
    );

    return { ...context.__exports, errors };
}

module.exports = { loadMdl };
