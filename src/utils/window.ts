import {ref, type Ref } from 'vue'
import type { Entity } from '@/utils/entity'

export class Layer {
  public entities: Entity[]
  public visible: Ref<boolean>

  constructor() {
    this.entities = []
    this.visible = ref(true);
  }

  public addEntity(entity: Entity) {
    this.entities.push(entity)
    entity.setLayer(this)
  }
  public removeEntity(entity: Entity) {
    this.entities = this.entities.filter(e => e !== entity)
    entity.setLayer(null)
  }
  
  public setVisible(visible: boolean) {
    this.visible.value = visible
  }
  public getVisible() {
    return this.visible.value
  }

  public render(ctx: CanvasRenderingContext2D, win: Window) {
    if (!this.getVisible()) return
    const list = [...this.entities].sort((a, b) => (a.config?.z ?? 0) - (b.config?.z ?? 0))
    for (const e of list) {
      if (e.config?.visible !== false && typeof (e as any).render === 'function') {
        (e as any).render(ctx, win)
      }
    }
  }
}

export class Window {
  public rec: {
    width: Ref<number>
    height: Ref<number>
  }
  public pos: {
    x: Ref<number>
    y: Ref<number>
  }

  /**
   * @description 视野
   * @description x,y为左上角的坐标
   * @description ratio为屏幕上多少个像素表示一单位的距离
   * @example ratio=2, x=1的时候，若width=100，window则渲染50单位的距离，1到50
   */
  public horizon: {
    /**
     * 左上角的x坐标
     */
    x: Ref<number>
    /**
     * 左上角的y坐标
     */
    y: Ref<number>
    /**
     * 屏幕上ratio个像素表示一单位的坐标距离
     */
    ratio: Ref<number>
  }
  public layers: Layer[]

  constructor(x:number, y:number, width: number, height:number) {
    this.rec = {
      width: ref(width),
      height: ref(height)
    }
    this.pos = {
      x: ref(x),
      y: ref(y)
    }
    this.horizon = {
      x: ref(0),
      y: ref(0),
      ratio: ref(1)
    }
    this.layers = []
  }

  public addEntity(entity: Entity, layer: Layer) {
    layer.addEntity(entity)
  }
  public removeEntity(entity: Entity, layer: Layer) {
    layer.removeEntity(entity)
  }
  public transportEntity(entity: Entity, from: Layer, to: Layer) {
    from.removeEntity(entity)
    to.addEntity(entity)
  }
  public addLayer(layer: Layer) {
    this.layers.push(layer)
  }
  public removeLayer(layer: Layer) {
    this.layers = this.layers.filter(l => l !== layer)
  }

  // 世界坐标 -> 屏幕像素
  public toScreenX(x: number): number {
    return (x - this.horizon.x.value) * this.horizon.ratio.value + this.pos.x.value
  }
  public toScreenY(y: number): number {
    return (y - this.horizon.y.value) * this.horizon.ratio.value + this.pos.y.value
  }
  public toScreen(p: { x:number; y:number }) {
    return { x: this.toScreenX(p.x), y: this.toScreenY(p.y) }
  }

  public clear(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  }

  public render(ctx: CanvasRenderingContext2D) {
    for (const layer of this.layers) {
      layer.render(ctx, this)
    }
  }
}