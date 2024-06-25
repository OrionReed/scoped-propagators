import { Editor, TLArrowShape, Tldraw, track, useEditor } from 'tldraw'
import 'tldraw/tldraw.css'
import { useYjsStore } from './useYjsStore'
import { useEffect, useState } from 'react'
import { User } from './users'
// import { CustomToolbar, GMachineOverlay, overrides } from './ui'
import { CollectionProvider } from '@/tldraw-collections/CollectionProvider'
import { PhysicsCollection } from '@/physics/PhysicsCollection'
import { PhysicsUi } from '@/physics/ui/PhysicsUi'

const collections = [
	PhysicsCollection
]

const HOST_URL =
	//@ts-ignore
	import.meta.env.MODE === 'development'
		? "ws://localhost:1234"
		//@ts-ignore
		: location.origin.replace("https://", "ws://"); // remove protocol just in case

export default function YjsExample() {
	const store = useYjsStore({
		roomId: 'example17',
		hostUrl: HOST_URL,
	})

	const [editor, setEditor] = useState<Editor | null>(null)


	return (
		<div className="tldraw__editor">
			<Tldraw
				store={store}
				components={{
					SharePanel: NameEditor,
					// Toolbar: CustomToolbar,
					// OnTheCanvas: GMachineOverlay,
				}}
				// overrides={overrides}
				onMount={(e) => {
					// mount(e)
					setEditor(e)
				}}
			>
				<CollectionProvider
					editor={editor}
					collections={collections}
					addOnMount
				>
					<PhysicsUi />
				</CollectionProvider>
			</Tldraw>
		</div>
	)
}

// function mount(editor: Editor) {
// 	//@ts-expect-error ehh
// 	editor.getStateDescendant('select.idle').handleDoubleClickOnCanvas = () => void null
// 	// editor.sideEffects.registerAfterChangeHandler<'instan('instance_page_state', (prev, next, source) => {})
// 	editor.sideEffects.registerAfterChangeHandler("pointer", (prev, next, source) => {
// 		// console.log('TOOL', editor.getPath())
// 		if (!editor.isIn('select.pointing_shape')) return

// 		const _a = editor.getHoveredShape()
// 		const _m = editor.getShapeAtPoint(editor.inputs.currentPagePoint, { filter: (shape) => shape.type === 'gmachine' })

// 		if (_m && _m.type === 'gmachine' && _a && _a.type === 'arrow') {
// 			const machine = _m as IGMachineShape
// 			const arrow = _a as TLArrowShape
// 			const machineUtil = editor.getShapeUtil(machine) as GMachineShapeUtil
// 			machineUtil.machine.transition(machine, arrow.id)
// 		}
// 	})
// }

function useSessionStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
	const [value, setValue] = useState<T>(() => {
		const storedValue = sessionStorage.getItem(key);
		return storedValue ? JSON.parse(storedValue) : initialValue;
	});

	useEffect(() => {
		sessionStorage.setItem(key, JSON.stringify(value));
	}, [key, value]);

	const setStoredValue = (newValue: T) => {
		setValue(newValue);
	};

	return [value, setStoredValue];
}


const NameEditor = track(() => {
	const editor = useEditor()
	const [userPrefs, setUserPrefs] = useSessionStorage<User>('userPrefs', editor.user.getUserPreferences())
	const editorPrefs = editor.user.getUserPreferences()

	useEffect(() => {
		if (userPrefs.id !== editorPrefs.id) {
			editor.user.updateUserPreferences(userPrefs);
		}
	}, [userPrefs, editorPrefs, editor.user]);

	const { color, name } = userPrefs

	return (
		<div style={{ pointerEvents: 'all', display: 'flex' }}>
			<input
				type="color"
				value={color}
				onChange={(e) => {
					editor.user.updateUserPreferences({
						color: e.currentTarget.value,
					})
					setUserPrefs({
						...userPrefs,
						color: e.currentTarget.value,
					})
				}}
			/>
			<input
				value={name}
				onChange={(e) => {
					editor.user.updateUserPreferences({
						name: e.currentTarget.value,
					})
					setUserPrefs({
						...userPrefs,
						name: e.currentTarget.value,
					})
				}}
			/>
		</div>
	)
})
