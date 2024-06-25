# scoped proagators
"Scoped propagators" are formed of a `scope` and a `propagator` which often looks like this: 
`click { text: "foo" }`

The `scope` sets the events that cause propagation, such as clicks, ticks, or shape changes (not adding a scope will default to shape changes).

The `propagator` is a JS object (or function which returns one) that is applied to the shape.

Notes:
- shapes are passed both `from` and `to` shapes.
- Shapes are flattened before being passed to the propagator, and unpacked on the other side. So properties live alongside the `x`, `y`, and `rotation` values (e.g. `{ x: 100, y: 100, text: "foo" }`).

Current Issues (probably should be fixed before putting out a demo):
- cycles of `change` propagators cause infinite recursion.
- `geo` scopes are currently fired for any shape change, this should be localised to spatially local changes.