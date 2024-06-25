import { BaseCollection } from "@/tldraw-collections"
import {
	Editor,
	TLDrawShape,
	TLGeoShape,
	TLGroupShape,
	TLParentId,
	TLScribble,
	TLShape,
	TLShapeId,
	Vec,
	VecLike,
} from "tldraw"
import RAPIER from "@dimforge/rapier2d"
import {
	MATERIAL,
	centerToCorner,
	convertVerticesToFloat32Array,
	shouldConvexify,
	cornerToCenter,
	getFrictionFromColor,
	getRestitutionFromColor,
	isRigidbody,
} from "./utils"

type RigidbodyUserData = RAPIER.RigidBody & {
	id: TLShapeId
	type: TLShape["type"]
	w: number
	h: number
	rbType: RAPIER.RigidBodyType
}
export class PhysicsCollection extends BaseCollection {
	override id = "physics"
	private world: RAPIER.World
	private rigidbodyLookup: Map<TLShapeId, RAPIER.RigidBody>
	private colliderLookup: Map<TLShapeId, RAPIER.Collider>
	private carSet: Set<TLShapeId> = new Set()
	private animFrame = -1 // Store the animation frame id
	private shiftDriftFactor = 0.8
	private tireMarks: Map<
		TLShapeId,
		{
			drifting: boolean
			backLeft: string
			backRight: string
			frontLeft: string
			frontRight: string
		}
	> = new Map()

	constructor(editor: Editor) {
		super(editor)
		this.world = new RAPIER.World({ x: 0, y: 0 })
		this.rigidbodyLookup = new Map()
		this.colliderLookup = new Map()

		// oof
		window.addEventListener("keydown", (e) => {
			if (e.shiftKey) {
				this.shiftDriftFactor = 1
			}
		})
		window.addEventListener("keyup", (e) => {
			if (!e.shiftKey && this.shiftDriftFactor === 1) {
				const driftInterval = setInterval(() => {
					this.shiftDriftFactor = Math.max(this.shiftDriftFactor * 0.99, 0.8)
					if (this.shiftDriftFactor <= 0.8) {
						clearInterval(driftInterval)
					}
				}, 40)
			}
		})
		this.simStart()
	}

	override onAdd(shapes: TLShape[]) {
		const parentShapes = new Set<TLParentId>()
		for (const shape of shapes) {
			if (shape.parentId !== "page:page") {
				parentShapes.add(shape.parentId)
				continue
			}
			if (shape.type === "group") {
				parentShapes.add(shape.id)
				continue
			}
			if (
				this.colliderLookup.has(shape.id) ||
				this.rigidbodyLookup.has(shape.id)
			)
				continue
			if ("text" in shape.props && shape.props.text.toLowerCase() !== "") {
				if (shape.props.text.toLowerCase() === this.editor.user.getName().toLowerCase()) {
					this.createCar(shape as TLGeoShape)
					this.carSet.add(shape.id)
				}
				continue
			}
			switch (shape.type) {
				case "draw":
					this.createCompoundLineObject(shape as TLDrawShape)
					break
				case "group":
					this.createGroupObject(shape as TLGroupShape)
					break
				default:
					this.createShape(shape)
					break
			}
		}
		for (const parent of parentShapes) {
			const parentShape = this.editor.getShape(parent)
			if (!parentShape || parentShape.type !== "group") continue
			this.createGroupObject(parentShape as TLGroupShape)
		}
	}

	override onRemove(shapes: TLShape[]) {
		for (const shape of shapes) {
			if (this.rigidbodyLookup.has(shape.id)) {
				const rb = this.rigidbodyLookup.get(shape.id)
				if (!rb) continue
				this.world.removeRigidBody(rb)
				this.rigidbodyLookup.delete(shape.id)
			}
			if (this.colliderLookup.has(shape.id)) {
				const col = this.colliderLookup.get(shape.id)
				if (!col) continue
				this.world.removeCollider(col, true)
				this.colliderLookup.delete(shape.id)
			}
		}
	}

	public simStart() {
		const simLoop = () => {
			this.world.step()
			this.updateKinematic()
			this.updateRigidbodies()
			this.animFrame = requestAnimationFrame(simLoop)
		}
		simLoop()
		return () => cancelAnimationFrame(this.animFrame)
	}

	public simStop() {
		if (this.animFrame !== -1) {
			cancelAnimationFrame(this.animFrame)
			this.animFrame = -1
		}
	}

	addCollider(
		id: TLShapeId,
		desc: RAPIER.ColliderDesc,
		parentRigidBody?: RAPIER.RigidBody,
	): RAPIER.Collider {
		const col = this.world.createCollider(desc, parentRigidBody)
		col && this.colliderLookup.set(id, col)
		return col
	}

	addRigidbody(id: TLShapeId, desc: RAPIER.RigidBodyDesc) {
		const rb = this.world.createRigidBody(desc)
		rb && this.rigidbodyLookup.set(id, rb)
		return rb
	}

	createShape(shape: TLShape) {
		if ("dash" in shape.props && shape.props.dash === "dashed") return // Skip dashed shapes
		if ("color" in shape.props && isRigidbody(shape.props.color)) {
			const gravity = 0 //getGravityFromColor(shape.props.color)
			const rb = this.createRigidbodyObject(shape, gravity)
			this.createColliderObject(shape, rb)
		} else {
			this.createColliderObject(shape)
		}
	}
	createCar(shape: TLShape) {
		const gravity = 0
		const rb = this.createRigidbodyObject(shape, gravity)
		rb.enableCcd(true)
		rb.setLinearDamping(0)
		rb.setAngularDamping(1)
		this.createColliderObject(shape, rb)
	}

	createGroupObject(group: TLGroupShape) {
		// create rigidbody for group
		const rigidbody = this.createRigidbodyObject(group)

		this.editor.getSortedChildIdsForParent(group.id).forEach((childId) => {
			// create collider for each
			const child = this.editor.getShape(childId)
			if (!child) return
			const isRb = "color" in child.props && isRigidbody(child.props.color)
			if (isRb) {
				this.createColliderObject(child, rigidbody, group)
			} else {
				this.createColliderObject(child)
			}
		})
	}

	createCompoundLineObject(drawShape: TLDrawShape) {
		const rigidbody = this.createRigidbodyObject(drawShape)
		const drawnGeo = this.editor.getShapeGeometry(drawShape)
		const verts = drawnGeo.vertices
		const isRb =
			"color" in drawShape.props && isRigidbody(drawShape.props.color)
		verts.forEach((point) => {
			if (isRb)
				this.createColliderRelativeToParentObject(point, drawShape, rigidbody)
			else this.createColliderRelativeToParentObject(point, drawShape)
		})
	}

	private createRigidbodyObject(shape: TLShape, gravity = 1): RAPIER.RigidBody {
		const { w, h } = this.getShapeSize(shape)
		const centerPosition = cornerToCenter({
			x: shape.x,
			y: shape.y,
			width: w,
			height: h,
			rotation: shape.rotation,
		})
		const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(centerPosition.x, centerPosition.y)
			.setRotation(shape.rotation)
			.setGravityScale(gravity)
			.setLinearDamping(3)
			.setAngularDamping(6)
		rigidBodyDesc.userData = {
			id: shape.id,
			type: shape.type,
			w: w,
			h: h,
			rbType: RAPIER.RigidBodyType.Dynamic,
		}
		const rigidbody = this.addRigidbody(shape.id, rigidBodyDesc)
		return rigidbody
	}

	private createColliderRelativeToParentObject(
		point: VecLike,
		relativeToParent: TLDrawShape,
		parentRigidBody: RAPIER.RigidBody | null = null,
	) {
		const radius = 3
		const center = cornerToCenter({
			x: point.x,
			y: point.y,
			width: radius,
			height: radius,
			rotation: 0,
			parentGroupShape: relativeToParent,
		})
		let colliderDesc: RAPIER.ColliderDesc | null = null
		colliderDesc = RAPIER.ColliderDesc.ball(radius)

		if (!colliderDesc) {
			console.error("Failed to create collider description.")
			return
		}

		if (parentRigidBody) {
			colliderDesc.setTranslation(center.x, center.y)
			this.addCollider(relativeToParent.id, colliderDesc, parentRigidBody)
		} else {
			colliderDesc.setTranslation(
				relativeToParent.x + center.x,
				relativeToParent.y + center.y,
			)
			this.addCollider(relativeToParent.id, colliderDesc)
		}
	}
	private createColliderObject(
		shape: TLShape,
		parentRigidBody: RAPIER.RigidBody | null = null,
		parentGroup: TLGroupShape | undefined = undefined,
	) {
		const { w, h } = this.getShapeSize(shape)
		const parentGroupShape = parentGroup
			? (this.editor.getShape(parentGroup.id) as TLGroupShape)
			: undefined
		const centerPosition = cornerToCenter({
			x: shape.x,
			y: shape.y,
			width: w,
			height: h,
			rotation: shape.rotation,
			parentGroupShape: parentGroupShape,
		})

		const restitution =
			"color" in shape.props
				? getRestitutionFromColor(shape.props.color)
				: MATERIAL.defaultRestitution
		const friction =
			"color" in shape.props
				? getFrictionFromColor(shape.props.color)
				: MATERIAL.defaultFriction

		let colliderDesc: RAPIER.ColliderDesc | null = null

		if (shouldConvexify(shape)) {
			// Convert vertices for convex shapes
			const vertices = this.editor.getShapeGeometry(shape).vertices
			const vec2Array = convertVerticesToFloat32Array(vertices, w, h)
			colliderDesc = RAPIER.ColliderDesc.convexHull(vec2Array)
		} else {
			// Cuboid for rectangle shapes
			colliderDesc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2)
		}
		if (!colliderDesc) {
			console.error("Failed to create collider description.")
			return
		}

		colliderDesc
			.setRestitution(restitution)
			.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
			.setFriction(friction)
			.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
		if (parentRigidBody) {
			if (parentGroup) {
				colliderDesc.setTranslation(centerPosition.x, centerPosition.y)
				colliderDesc.setRotation(shape.rotation)
			}
			this.addCollider(shape.id, colliderDesc, parentRigidBody)
		} else {
			colliderDesc
				.setTranslation(centerPosition.x, centerPosition.y)
				.setRotation(shape.rotation)
			this.addCollider(shape.id, colliderDesc)
		}
	}

	updateCar(rb: RAPIER.RigidBody) {
		// Config
		const accelerationFactor = 15 ** 6
		const turnSpeedFactor = 1000
		const turnFactor = 2.5 * (Math.PI / 180)
		const driftFactor = 0.98
		const maxSpeed = 1000
		const tireMarkThreshold = 200
		const tireScribble: Partial<TLScribble> = {
			color: "muted-1",
			size: 4,
			taper: false,
			// state: "paused",
		}

		rb.collider(0).setFriction(0.1)

		// Utils
		const clamp01 = (value: number) => {
			return Math.max(Math.min(value, 1), 0)
		}

		const magnitude = (v: VecLike) => {
			return Math.sqrt(v.x ** 2 + v.y ** 2)
		}

		const dotProduct = (v1: VecLike, v2: VecLike) => {
			return v1.x * v2.x + v1.y * v2.y
		}

		const getInput = () => {
			const forward = this.editor.inputs.keys.has("ArrowUp") ? 1 : 0
			const backward = this.editor.inputs.keys.has("ArrowDown") ? -1 : 0
			const right = this.editor.inputs.keys.has("ArrowRight") ? 1 : 0
			const left = this.editor.inputs.keys.has("ArrowLeft") ? -1 : 0

			return new Vec(right + left, forward + backward)
		}

		// Inputs
		const input = getInput()
		// const shiftDriftFactor = () => (this.editor.inputs.altKey ? 1 : 0)

		const getForwardVector = (r: RAPIER.RigidBody) =>
			new Vec(Math.sin(r.rotation()), -Math.cos(r.rotation()))

		const getRightVector = (r: RAPIER.RigidBody) =>
			new Vec(Math.cos(r.rotation()), Math.sin(r.rotation()))

		const engineForceVector: Vec = getForwardVector(rb)
			.mul(input.y)
			.mul(accelerationFactor)

		const lockCameraToCar = () => {
			const pos = rb.translation()
			const camBounds = this.editor.getViewportPageBounds()
			const camPos = this.editor.getCamera()
			this.editor.setCamera({
				x: -pos.x + camBounds.width / 2,
				y: -pos.y + camBounds.height / 2,
				z: camPos.z,
			})
		}

		const applyEngineForce = () => {
			rb.resetForces(true)
			if (magnitude(rb.linvel()) < maxSpeed) {
				rb.addForce(engineForceVector, true)
			}
			if (input.y === 0) {
				const drag = 0.01 + rb.linearDamping()
				rb.setLinearDamping(drag)
			} else {
				rb.setLinearDamping(0)
			}
		}

		const applyTurn = () => {
			const minSpeedTurnFactor = clamp01(
				magnitude(rb.linvel()) / turnSpeedFactor,
			)
			const direction =
				dotProduct(getForwardVector(rb), rb.linvel()) < 0 ? -1 : 1 // Reverse direction when going backward

			const rotation =
				rb.rotation() + input.x * turnFactor * minSpeedTurnFactor * direction
			rb.setRotation(rotation, true)
		}

		const applyDrift = () => {
			const forwardVector = getForwardVector(rb)
			const rightVector = getRightVector(rb)
			const forwardDot = dotProduct(forwardVector, rb.linvel())
			const rightDot = dotProduct(rightVector, rb.linvel())
			const forwardVelocity = forwardVector.mul(forwardDot)
			const rightVelocity = rightVector.mul(rightDot)
			// const shiftDriftFactor = this.shiftKey ? 1 : 0.4
			console.log(this.shiftDriftFactor)

			rb.setLinvel(
				forwardVelocity.add(
					rightVelocity.mul(driftFactor * this.shiftDriftFactor),
				),
				true,
			)
		}

		const addTireMarks = () => {
			const rightVector = getRightVector(rb)
			const rightDot = dotProduct(rightVector, rb.linvel())
			const rightVelocity = rightVector.mul(rightDot)
			const driftMagnitude = magnitude(rightVelocity)
			const carShape = this.editor.getShape((rb.userData as RigidbodyUserData).id) as TLShape
			const carTransform = this.editor.getShapePageTransform(carShape.id)
			const carGeo = this.editor.getShapeGeometry(carShape.id)

			const tireCornerOffset = 20
			const backLeftTirePos = carTransform.applyToPoint({
				x: carGeo.bounds.minX + tireCornerOffset,
				y: carGeo.bounds.maxY - tireCornerOffset,
			})
			const backRightTirePos = carTransform.applyToPoint({
				x: carGeo.bounds.maxX - tireCornerOffset,
				y: carGeo.bounds.maxY - tireCornerOffset,
			})
			const frontLeftTirePos = carTransform.applyToPoint({
				x: carGeo.bounds.minX + tireCornerOffset,
				y: carGeo.bounds.minY + tireCornerOffset,
			})
			const frontRightTirePos = carTransform.applyToPoint({
				x: carGeo.bounds.maxX - tireCornerOffset,
				y: carGeo.bounds.minY + tireCornerOffset,
			})

			// if drifting
			if (driftMagnitude > tireMarkThreshold) {
				const tireMarks = this.tireMarks.get(carShape.id)
				if (tireMarks?.drifting) {
					// const tireMarks = this.tireMarks.get(carShape.id)
					if (tireMarks) {
						this.tireMarks.set(carShape.id, {
							drifting: true,
							backLeft: tireMarks.backLeft,
							backRight: tireMarks.backRight,
							frontLeft: tireMarks.frontLeft,
							frontRight: tireMarks.frontRight,
						})
					}
					this.editor.scribbles.addPoint(
						tireMarks.backLeft,
						backLeftTirePos.x,
						backLeftTirePos.y,
					)
					this.editor.scribbles.addPoint(
						tireMarks.backRight,
						backRightTirePos.x,
						backRightTirePos.y,
					)
					this.editor.scribbles.addPoint(
						tireMarks.frontLeft,
						frontLeftTirePos.x,
						frontLeftTirePos.y,
					)
					this.editor.scribbles.addPoint(
						tireMarks.frontRight,
						frontRightTirePos.x,
						frontRightTirePos.y,
					)
				}
				if (!tireMarks?.drifting) {
					const scribbleBackLeft =
						this.editor.scribbles.addScribble(tireScribble)
					const scribbleBackRight =
						this.editor.scribbles.addScribble(tireScribble)
					const scribbleFrontLeft =
						this.editor.scribbles.addScribble(tireScribble)
					const scribbleFrontRight =
						this.editor.scribbles.addScribble(tireScribble)
					this.tireMarks.set(carShape.id, {
						backLeft: scribbleBackLeft.id,
						backRight: scribbleBackRight.id,
						frontLeft: scribbleFrontLeft.id,
						frontRight: scribbleFrontRight.id,
						drifting: true,
					})
				}
			} else {
				const tireMarks = this.tireMarks.get(carShape.id)
				if (tireMarks) {
					this.tireMarks.set(carShape.id, {
						drifting: false,
						backLeft: tireMarks.backLeft,
						backRight: tireMarks.backRight,
						frontLeft: tireMarks.frontLeft,
						frontRight: tireMarks.frontRight,
					})
				}
			}
		}

		applyEngineForce()
		applyTurn()
		applyDrift()
		addTireMarks()
		lockCameraToCar() // make this a toggle
	}

	updateRigidbodies() {
		this.world.bodies.forEach((rb) => {
			if (!rb.userData) return
			const userData = rb.userData as RigidbodyUserData
			if (
				this.editor.getSelectedShapeIds().includes(userData.id) &&
				!this.editor.isIn("select.idle")
			) {
				console.log("selected")
				return
			}
			// CAR CONTROL
			if (this.carSet.has(userData.id)) {
				this.updateCar(rb)
			}

			rb.setBodyType(userData.rbType, true)
			const position = rb.translation()
			const rotation = rb.rotation()

			const cornerPos = centerToCorner({
				x: position.x,
				y: position.y,
				width: userData.w,
				height: userData.h,
				rotation: rotation,
			})

			this.editor.updateShape({
				id: userData.id,
				type: userData.type,
				rotation: rotation,
				x: cornerPos.x,
				y: cornerPos.y,
			})
		})
	}

	// kinematicShapes(): TLShape[] {
	// 	const selected = this.editor.getSelectedShapeIds()
	// 	const 
	// }

	updateKinematic() {
		const multiplayerSelection = this.editor.getCollaboratorsOnCurrentPage().flatMap((c) => {
			return c.selectedShapeIds
		})
		const s = new Set([...multiplayerSelection, ...this.editor.getSelectedShapeIds()])
		for (const id of s) {
			// if (this.editor.isIn("select.idle")) continue
			const shape = this.editor.getShape(id)
			if (!shape) continue
			// if ("text" in shape.props && shape.props.text) {
			// 	continue
			// }
			const col = this.colliderLookup.get(id)
			const rb = this.rigidbodyLookup.get(id)
			const { w, h } = this.getShapeSize(shape)

			const centerPos = cornerToCenter({
				x: shape.x,
				y: shape.y,
				width: w,
				height: h,
				rotation: shape.rotation,
			})

			if (col && rb) {
				const userData = rb.userData as RigidbodyUserData
				if (!rb.isKinematic())
					rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
				rb.setNextKinematicTranslation({ x: centerPos.x, y: centerPos.y })
				rb.setNextKinematicRotation(shape.rotation)
				col.setHalfExtents({ x: w / 2, y: h / 2 })
				// userData.w = w
				// userData.h = h
				continue
			}
			if (rb) {
				if (!rb.isKinematic())
					rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
				rb.setNextKinematicTranslation({ x: centerPos.x, y: centerPos.y })
				rb.setNextKinematicRotation(shape.rotation)
				continue
			}
			if (col) {
				col.setTranslation({ x: centerPos.x, y: centerPos.y })
				col.setRotation(shape.rotation)
				col.setHalfExtents({ x: w / 2, y: h / 2 })
				// TODO: update dimensions for all shapes
			}
		}
	}

	private getShapeSize = (shape: TLShape): { w: number; h: number } => {
		const { w, h } = this.editor.getShapeGeometry(shape).bounds
		return { w, h }
	}
}
