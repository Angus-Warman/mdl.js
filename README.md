## mdl.js

If your data structure looks something like this:

```
const data = [
    {
        id: "foo",
        propA: "a",
        propB: 2,
        propC: [
            {
                id: "bar",
                ...
            }
        ]
    }
]
```

Then `mdl.js` will work for you.

Create a *store* like so:

```
var items = store(data);
```

And then, bind the store in HTML like so:

```
<template mdl="items">
    <span mdl="propA"></span>
    <input type="number" mdl="propB">

    <ul>
        <template mdl="propC">
        ...
        </template>
    </ul>
</template>
```
