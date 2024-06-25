export class DeltaTime {
  private static lastTime = Date.now()
  private static initialized = false
  private static _dt = 0

  static get dt(): number {
    if (!DeltaTime.initialized) {
      DeltaTime.lastTime = Date.now()
      DeltaTime.initialized = true
      window.requestAnimationFrame(DeltaTime.tick)
      return 0
    }
    const clamp = (min: number, max: number, value: number) => Math.min(max, Math.max(min, value))
    return clamp(0, 100, DeltaTime._dt)
  }

  static tick(nowish) {
    DeltaTime._dt = nowish - DeltaTime.lastTime
    DeltaTime.lastTime = nowish

    window.requestAnimationFrame(DeltaTime.tick)
  }
}