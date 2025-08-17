import { Entity } from '@/utils/entity'
import type { Window } from '@/utils/window'

export type DrawStyle = {
  fillStyle?: string
  strokeStyle?: string
  lineWidth?: number
  dashed?: number[]
  alpha?: number
}

function applyStyle(ctx: CanvasRenderingContext2D, style?: DrawStyle) {
  if (!style) return
  if (style.fillStyle !== undefined) ctx.fillStyle = style.fillStyle
  if (style.strokeStyle !== undefined) ctx.strokeStyle = style.strokeStyle
  if (style.lineWidth !== undefined) ctx.lineWidth = style.lineWidth
  if (style.dashed !== undefined) ctx.setLineDash(style.dashed)
  if (style.alpha !== undefined) ctx.globalAlpha = style.alpha
}

function resetStyle(ctx: CanvasRenderingContext2D) {
  ctx.setLineDash([])
  ctx.globalAlpha = 1
}

export class Circle extends Entity {
  public radius: number
  public style?: DrawStyle

  constructor(x = 0, y = 0, r = 10, style?: DrawStyle) {
    super(x, y)
    this.radius = r
    this.style = style
  }

  public render(ctx: CanvasRenderingContext2D, win: Window): void {
    if (this.config.visible === false) return
    const p = win.toScreen(this.position)
    const r = this.radius * win.horizon.ratio.value

    ctx.save()
    applyStyle(ctx, this.style)

    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    if (this.style?.fillStyle) ctx.fill()
    ctx.stroke()

    resetStyle(ctx)
    ctx.restore()
  }
}

export class Rectangle extends Entity {
  public width: number
  public height: number
  public style?: DrawStyle
  /**
   * anchor: 'center' 表示 position 为中心点
   *         'topleft' 表示 position 为左上角
   */
  public anchor: 'center' | 'topleft'

  constructor(x = 0, y = 0, w = 10, h = 10, style?: DrawStyle, anchor: 'center' | 'topleft' = 'center') {
    super(x, y)
    this.width = w
    this.height = h
    this.style = style
    this.anchor = anchor
  }

  public render(ctx: CanvasRenderingContext2D, win: Window): void {
    if (this.config.visible === false) return
    const ratio = win.horizon.ratio.value
    const w = this.width * ratio
    const h = this.height * ratio
    const p = win.toScreen(this.position)

    let x = p.x
    let y = p.y
    if (this.anchor === 'center') {
      x = p.x - w / 2
      y = p.y - h / 2
    }

    ctx.save()
    applyStyle(ctx, this.style)

    ctx.beginPath()
    ctx.rect(x, y, w, h)
    if (this.style?.fillStyle) ctx.fill()
    ctx.stroke()

    resetStyle(ctx)
    ctx.restore()
  }
}

export class Line extends Entity {
  public a: Entity
  public b: Entity
  public style?: DrawStyle

  constructor(a: Entity, b: Entity, style?: DrawStyle) {
    super()
    this.a = a
    this.b = b
    this.style = style
  }

  public render(ctx: CanvasRenderingContext2D, win: Window): void {
    if (this.config.visible === false) return
    const p1 = win.toScreen(this.a.position)
    const p2 = win.toScreen(this.b.position)

    ctx.save()
    applyStyle(ctx, this.style)

    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()

    resetStyle(ctx)
    ctx.restore()
  }
}