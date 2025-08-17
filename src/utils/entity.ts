import type { Window, Layer } from '@/utils/window'

export class Entity {
  public position: {
    x: number;
    y: number;
  };

  public config: {
    visible: boolean;
    layer: Layer|null;
    z : number;
  };

  constructor(x?: number, y?: number) {
    this.position = { x: x??0, y: y??0 };
    this.config = {
      visible: true,
      layer: null,
      z: 0,
    };
  }

  distance(other: Entity): number {
    return Math.sqrt(
      Math.pow(this.position.x - other.position.x, 2) +
        Math.pow(this.position.y - other.position.y, 2)
    );
  }

  move(x: number, y: number) {
    this.position.x += x;
    this.position.y += y;
  }

  moveTo(x: number, y: number) {
    this.position.x = x;
    this.position.y = y;
  }

  moveToEntity(other: Entity) {
    this.position.x = other.position.x;
    this.position.y = other.position.y;
  }

  setLayer(layer: Layer|null) {
    this.config.layer = layer;
  }
  getLayer(): Layer|null {
    return this.config.layer;
  }

  // 默认空实现，由子类覆盖进行渲染
  public render(ctx: CanvasRenderingContext2D, win: Window): void {}
}