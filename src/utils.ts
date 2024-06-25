import { Editor, TLShape, TLShapePartial } from "tldraw";

/** 
 * @returns true if the shape is of the given type
 * @example
 * ```ts
 * isShapeOfType<TLArrowShape>(shape, 'arrow')
 * ```
 */
export function isShapeOfType<T extends TLShape>(shape: TLShape, type: T['type']): shape is T {
  return shape.type === type;
}

export function updateProps<T extends TLShape>(editor: Editor, shape: T, props: Partial<T['props']>) {
  editor.updateShape({
    ...shape,
    props: {
      ...shape.props,
      ...props
    },
  } as TLShapePartial)
}