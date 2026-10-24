const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMdl } = require("./harness");

test("nested items expose their owning item as $parent", () => {
    const { store } = loadMdl();
    const projects = store([
        { id: "p1", name: "Home", tasks: [{ id: "t1", text: "Trash" }] },
    ]);
    const project = projects.get("p1");
    const task = project.tasks.get("t1");

    assert.equal(task.$parent, project);
    assert.equal(task.$parent.name, "Home");
});

test("$parent works through multiple levels of nesting", () => {
    const { store } = loadMdl();
    const projects = store([
        {
            id: "a",
            name: "A",
            items: [{ id: "b", name: "B", items: [{ id: "c", name: "C" }] }],
        },
    ]);
    const c = projects.get("a").items.get("b").items.get("c");

    assert.equal(c.$parent.name, "B");
    assert.equal(c.$parent.$parent.name, "A");
});

test("$parent follows arrays that are reassigned or added to", () => {
    const { store } = loadMdl();
    const projects = store([
        { id: "p1", name: "Home", tasks: [{ id: "t1", text: "Trash" }] },
    ]);
    const project = projects.get("p1");

    project.tasks = [{ id: "t2", text: "New" }];
    assert.equal(project.tasks.get("t2").$parent, project);

    const added = project.tasks.add({ id: "t3", text: "Added" });
    assert.equal(added.$parent, project);
});

test("getProp and setProp resolve dotted paths", () => {
    const { store } = loadMdl();
    const projects = store([
        { id: "p1", name: "Home", tasks: [{ id: "t1", text: "Trash" }] },
    ]);
    const project = projects.get("p1");
    const task = project.tasks.get("t1");

    assert.equal(getProp(task, "text"), "Trash");
    assert.equal(getProp(task, "$parent.name"), "Home");

    setProp(task, "$parent.name", "Renamed");
    assert.equal(project.name, "Renamed");
});

test("missing binding properties log an error instead of writing", () => {
    const { store, errors } = loadMdl();
    const projects = store([
        { id: "p1", name: "Home", tasks: [{ id: "t1", text: "Trash" }] },
    ]);
    const task = projects.get("p1").tasks.get("t1");

    assert.equal(getProp(task, "status"), undefined);
    setProp(task, "missing", 1);

    assert.equal(task.missing, undefined);
    assert.deepEqual(
        errors.map(([message]) => message),
        [
            '[mdl] Missing property "status"',
            '[mdl] Missing property "missing"',
        ],
    );
});
