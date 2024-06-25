import { Editor, TLArrowShape, Tldraw } from 'tldraw'
import { CustomMainMenu } from '@/CustomMainMenu'
import { ClickPropagator, ChangePropagator, TickPropagator, SpatialPropagator, registerPropagators } from '@/propagators/ScopedPropagators'

export default function YjsExample() {
	return (
		<div className="tldraw__editor">
			<Tldraw
				components={{
					MainMenu: CustomMainMenu,
				}}
				onMount={onMount}
				persistenceKey='funcArrows'
			/>
		</div>
	)
}

function onMount(editor: Editor) {
	//@ts-expect-error
	window.editor = editor
	// stop double click text creation
	//@ts-expect-error
	editor.getStateDescendant('select.idle').handleDoubleClickOnCanvas = () => void null;

	registerPropagators(editor, [
		ChangePropagator,
		ClickPropagator,
		TickPropagator,
		SpatialPropagator,
	])
}