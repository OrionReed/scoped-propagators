import { isShapeOfType } from "@/utils";
import { Editor, TLArrowBinding, TLArrowShape, TLShape, TLShapeId } from "tldraw";

export interface Edge {
  arrowId: TLShapeId
  from: TLShapeId
  to: TLShapeId
  text?: string
}

export interface Graph {
  nodes: TLShapeId[]
  edges: Edge[]
}

export function getEdge(shape: TLShape | undefined, editor: Editor): Edge | undefined {
  if (!shape || !isShapeOfType<TLArrowShape>(shape, 'arrow')) return undefined
  const bindings = editor.getBindingsInvolvingShape<TLArrowBinding>(shape.id)
  if (!bindings || bindings.length !== 2) return undefined
  if (bindings[0].props.terminal === "end") {
    return {
      arrowId: shape.id,
      from: bindings[1].toId,
      to: bindings[0].toId,
      text: shape.props.text
    }
  }
  return {
    arrowId: shape.id,
    from: bindings[0].toId,
    to: bindings[1].toId,
    text: shape.props.text
  }
}

/** 
 * Returns the graph(s) of edges and nodes from a list of shapes
 */
export function getGraph(shapes: TLShape[], editor: Editor): Graph {
  const nodes: Set<TLShapeId> = new Set<TLShapeId>()
  const edges: Edge[] = []

  for (const shape of shapes) {
    const edge = getEdge(shape, editor)
    if (edge) {
      edges.push({
        arrowId: edge.arrowId,
        from: edge.from,
        to: edge.to,
        text: edge.text
      })
      nodes.add(edge.from)
      nodes.add(edge.to)
    }
  }

  return { nodes: Array.from(nodes), edges }
}

/** 
 * Returns the start and end nodes of a topologically sorted graph
 */
export function sortGraph(graph: Graph): { startNodes: TLShapeId[], endNodes: TLShapeId[] } {
  const targetNodes = new Set<TLShapeId>(graph.edges.map(e => e.to));
  const sourceNodes = new Set<TLShapeId>(graph.edges.map(e => e.from));

  const startNodes = [];
  const endNodes = [];

  for (const node of graph.nodes) {
    if (sourceNodes.has(node) && !targetNodes.has(node)) {
      startNodes.push(node);
    } else if (targetNodes.has(node) && !sourceNodes.has(node)) {
      endNodes.push(node);
    }
  }

  return { startNodes, endNodes };
}

/** 
 * Returns the arrows starting from the given shape
 */
export function getArrowsFromShape(editor: Editor, shapeId: TLShapeId): TLShapeId[] {
  const bindings = editor.getBindingsToShape<TLArrowBinding>(shapeId, 'arrow')
  return bindings.filter(edge => edge.props.terminal === 'start').map(edge => edge.fromId)
}

/** 
 * Returns the arrows ending at the given shape
 */
export function getArrowsToShape(editor: Editor, shapeId: TLShapeId): TLShapeId[] {
  const bindings = editor.getBindingsToShape<TLArrowBinding>(shapeId, 'arrow')
  return bindings.filter(edge => edge.props.terminal === 'end').map(edge => edge.fromId)
}

/** 
 * Returns the arrows which share the same start shape as the given arrow
 */
export function getSiblingArrowIds(editor: Editor, arrow: TLShape): TLShapeId[] {
  if (arrow.type !== 'arrow') return [];

  const bindings = editor.getBindingsInvolvingShape<TLArrowBinding>(arrow.id);
  if (!bindings || bindings.length !== 2) return [];

  const startShapeId = bindings.find(binding => binding.props.terminal === 'start')?.toId;
  if (!startShapeId) return [];

  const siblingBindings = editor.getBindingsToShape<TLArrowBinding>(startShapeId, 'arrow');
  const siblingArrows = siblingBindings
    .filter(binding => binding.props.terminal === 'start' && binding.fromId !== arrow.id)
    .map(binding => binding.fromId);

  return siblingArrows;
}