import { track, useEditor } from "tldraw"
import { useEffect, useState } from "react"
import "./physics-ui.css"
import { useCollection } from "@/tldraw-collections"

export const PhysicsUi = track(() => {
	const editor = useEditor()
	// const [init, setInit] = useState(false)
	const { collection, size } = useCollection("physics")

	// if (collection && size === 0 && !init) {
	// 	setInit(true)
	// 	// collection.add(editor.getCurrentPageShapes())
	// }

	const handleShortcut = () => {
		if (!collection) return
		if (size === 0) collection.add(editor.getCurrentPageShapes())
		else collection.clear()
	}

	useEffect(() => {
		window.addEventListener("togglePhysicsEvent", handleShortcut)
		return () => {
			window.removeEventListener("togglePhysicsEvent", handleShortcut)
		}
	}, [handleShortcut])

	return (
		<div className="custom-layout">
			<div className="custom-toolbar">
				<div>
					<button
						type="button"
						className="custom-button"
						style={{ backgroundColor: size === 0 ? "white" : "#bdffc8" }}
						onClick={handleShortcut}
					>
						{size === 0 ? "Editing" : "Playing"}
					</button>
				</div>
				<span>{size} shapes</span>
			</div>
		</div>
	)
})
