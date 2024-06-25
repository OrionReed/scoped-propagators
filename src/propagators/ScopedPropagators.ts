import { DeltaTime } from "@/DeltaTime"
import { Geo } from "@/Geo"
import { Edge, getArrowsFromShape, getEdge } from "@/tlgraph"
import { isShapeOfType, updateProps } from "@/utils"
import { Editor, TLArrowShape, TLBinding, TLGroupShape, TLShape, TLShapeId } from "tldraw"

type Prefix = 'click' | 'tick' | 'geo' | ''

function isPropagatorOfType(arrow: TLShape, prefix: Prefix) {
  if (!isShapeOfType<TLArrowShape>(arrow, 'arrow')) return false
  const regex = new RegExp(`^\\s*${prefix}\\s*\\{`)
  return regex.test(arrow.props.text)
}
function isExpandedPropagatorOfType(arrow: TLShape, prefix: Prefix) {
  if (!isShapeOfType<TLArrowShape>(arrow, 'arrow')) return false
  const regex = new RegExp(`^\\s*${prefix}\\s*\\(\\)\\s*\\{`)
  return regex.test(arrow.props.text)
}

class ArrowFunctionCache {
  private cache: Map<string, Function | null> = new Map<string, Function | null>()

  /** returns undefined if the function could not be found or created */
  get(editor: Editor, edge: Edge, prefix: Prefix): Function | undefined {
    if (this.cache.has(edge.arrowId)) {
      return this.cache.get(edge.arrowId)
    }
    console.log('creating func because it didnt exist')
    return this.set(editor, edge, prefix)
  }
  /** returns undefined if the function could not be created */
  set(editor: Editor, edge: Edge, prefix: Prefix): Function | undefined {
    try {
      const arrowShape = editor.getShape(edge.arrowId)
      if (!arrowShape) throw new Error('Arrow shape not found')
      const textWithoutPrefix = edge.text.replace(prefix, '')
      const isExpanded = isExpandedPropagatorOfType(arrowShape, prefix)
      const body = isExpanded ? textWithoutPrefix.trim().replace(/^\s*\(\)\s*{|}$/g, '') : `
      const mapping = ${textWithoutPrefix}
      editor.updateShape(_unpack({...to, ...mapping}))
      `
      const func = new Function('editor', 'from', 'to', 'G', 'bounds', 'dt', '_unpack', body);
      this.cache.set(edge.arrowId, func)
      return func
    } catch (error) {
      this.cache.set(edge.arrowId, null)
      return undefined
    }
  }
  delete(edge: Edge): void {
    this.cache.delete(edge.arrowId)
  }
}

const packShape = (shape: TLShape) => {
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    ...shape.props,
    m: shape.meta,
  }
}

const unpackShape = (shape: any) => {
  const { id, type, x, y, rotation, m, ...props } = shape
  const cast = (prop: any, constructor: (value: any) => any) => {
    return prop !== undefined ? constructor(prop) : undefined;
  };
  return {
    id,
    type,
    x: Number(x),
    y: Number(y),
    rotation: Number(rotation),
    props: {
      ...props,
      text: cast(props.text, String),
    },
    meta: m,
  }
}

function setArrowColor(editor: Editor, arrow: TLArrowShape, color: TLArrowShape['props']['color']): void {
  editor.updateShape({
    ...arrow,
    props: {
      ...arrow.props,
      color: color,
    }
  })
}

export function registerPropagators(editor: Editor, propagators: (new (editor: Editor) => Propagator)[]) {
  const _propagators = propagators.map((PropagatorClass) => new PropagatorClass(editor))

  for (const prop of _propagators) {
    for (const shape of editor.getCurrentPageShapes()) {
      if (isShapeOfType<TLArrowShape>(shape, 'arrow')) {
        prop.onArrowChange(editor, shape)
      }
    }
    editor.sideEffects.registerAfterChangeHandler<"shape">("shape", (_, next) => {
      if (isShapeOfType<TLGroupShape>(next, 'group')) {
        const childIds = editor.getSortedChildIdsForParent(next.id)
        for (const childId of childIds) {
          const child = editor.getShape(childId)
          prop.afterChangeHandler?.(editor, child)
        }
        return
      }
      prop.afterChangeHandler?.(editor, next)
      if (isShapeOfType<TLArrowShape>(next, 'arrow')) {
        prop.onArrowChange(editor, next)
      }
    })

    function updateOnBindingChange(editor: Editor, binding: TLBinding) {
      if (binding.type !== 'arrow') return
      const arrow = editor.getShape(binding.fromId)
      if (!arrow) return
      if (!isShapeOfType<TLArrowShape>(arrow, 'arrow')) return
      prop.onArrowChange(editor, arrow)
    }

    // TODO: remove this when binding creation
    editor.sideEffects.registerAfterCreateHandler<"binding">("binding", (binding) => {
      updateOnBindingChange(editor, binding)
    })
    // TODO: remove this when binding creation
    editor.sideEffects.registerAfterDeleteHandler<"binding">("binding", (binding) => {
      updateOnBindingChange(editor, binding)
    })

    editor.on('event', (event) => {
      prop.eventHandler?.(event)
    })
    editor.on('tick', () => {
      prop.tickHandler?.()
    })
  }
}

// TODO: separate generic propagator setup from scope registration
// TODO: handle cycles
export abstract class Propagator {
  abstract prefix: Prefix
  protected listenerArrows: Set<TLShapeId> = new Set<TLShapeId>()
  protected listenerShapes: Set<TLShapeId> = new Set<TLShapeId>()
  protected arrowFunctionCache: ArrowFunctionCache = new ArrowFunctionCache()
  protected editor: Editor
  protected geo: Geo
  protected validateOnArrowChange: boolean = false

  constructor(editor: Editor) {
    this.editor = editor
    this.geo = new Geo(editor)
  }

  /** function to check if any listeners need to be added/removed
   * called on mount and when an arrow changes 
  */
  onArrowChange(editor: Editor, arrow: TLArrowShape): void {
    const edge = getEdge(arrow, editor)
    if (!edge) return

    const isPropagator = isPropagatorOfType(arrow, this.prefix) || isExpandedPropagatorOfType(arrow, this.prefix)

    if (isPropagator) {
      if (this.validateOnArrowChange && !this.propagate(editor, arrow.id)) {
        this.removeListener(arrow.id, edge)
        return
      }
      this.addListener(arrow.id, edge)

      // TODO: find a way to do this properly so we can run arrow funcs on change without chaos...
      // this.arrowFunc(editor, arrow.id)
    } else {
      this.removeListener(arrow.id, edge)
    }
  }

  private addListener(arrowId: TLShapeId, edge: Edge): void {
    this.listenerArrows.add(arrowId)
    this.listenerShapes.add(edge.from)
    this.listenerShapes.add(edge.to)
    this.arrowFunctionCache.set(this.editor, edge, this.prefix)
  }

  private removeListener(arrowId: TLShapeId, edge: Edge): void {
    this.listenerArrows.delete(arrowId)
    this.arrowFunctionCache.delete(edge)
  }

  /** the function to be called when side effect / event is triggered */
  propagate(editor: Editor, arrow: TLShapeId): boolean {
    const edge = getEdge(editor.getShape(arrow), editor)
    if (!edge) return

    const arrowShape = editor.getShape(arrow) as TLArrowShape
    const fromShape = editor.getShape(edge.from)
    const toShape = editor.getShape(edge.to)
    const fromShapePacked = packShape(fromShape)
    const toShapePacked = packShape(toShape)
    const bounds = (shape: TLShape) => editor.getShapePageBounds(shape.id)

    try {
      const func = this.arrowFunctionCache.get(editor, edge, this.prefix)
      const result = func(editor, fromShapePacked, toShapePacked, this.geo, bounds, DeltaTime.dt, unpackShape);
      if (result) {
        editor.updateShape(unpackShape({ ...toShapePacked, ...result }))
      }

      setArrowColor(editor, arrowShape, 'black')
      return true
    } catch (error) {
      console.error(error)
      setArrowColor(editor, arrowShape, 'orange')
      return false
    }
  }

  /** called after every shape change */
  afterChangeHandler?(editor: Editor, next: TLShape): void
  /** called on every editor event */
  eventHandler?(event: any): void
  /** called every tick */
  tickHandler?(): void
}

export class ClickPropagator extends Propagator {
  prefix: Prefix = 'click'

  eventHandler(event: any): void {
    if (event.type !== 'pointer' || event.name !== 'pointer_down') return;
    const shapeAtPoint = this.editor.getShapeAtPoint(this.editor.inputs.currentPagePoint, { filter: (shape) => shape.type === 'geo' });
    if (!shapeAtPoint) return
    if (!this.listenerShapes.has(shapeAtPoint.id)) return
    const edgesFromHovered = getArrowsFromShape(this.editor, shapeAtPoint.id)

    const visited = new Set<TLShapeId>()
    for (const edge of edgesFromHovered) {
      if (this.listenerArrows.has(edge) && !visited.has(edge)) {
        this.propagate(this.editor, edge)
        visited.add(edge)
      }
    }
  }
}

export class ChangePropagator extends Propagator {
  prefix: Prefix = ''

  afterChangeHandler(editor: Editor, next: TLShape): void {
    if (this.listenerShapes.has(next.id)) {
      const arrowsFromShape = getArrowsFromShape(editor, next.id)
      for (const arrow of arrowsFromShape) {
        if (this.listenerArrows.has(arrow)) {
          const bindings = editor.getBindingsInvolvingShape(arrow)
          if (bindings.length !== 2) continue
          // don't run func if its pointing to itself to avoid change-induced recursion error
          if (bindings[0].toId === bindings[1].toId) continue
          this.propagate(editor, arrow)
        }
      }
    }
  }
}

export class TickPropagator extends Propagator {
  prefix: Prefix = 'tick'
  validateOnArrowChange = true

  tickHandler(): void {
    for (const arrow of this.listenerArrows) {
      this.propagate(this.editor, arrow)
    }
  }
}

export class SpatialPropagator extends Propagator {
  prefix: Prefix = 'geo'

  // TODO: make this smarter, and scale sublinearly
  afterChangeHandler(editor: Editor, next: TLShape): void {
    if (next.type === 'arrow') return
    for (const arrowId of this.listenerArrows) {
      this.propagate(editor, arrowId)
    }
  }
}

