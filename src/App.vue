<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watchEffect, watch, computed } from 'vue'
import { Window, Layer } from '@/utils/window'
import { Circle, Line } from '@/utils/Shapes'

type P = { x: number; y: number }

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let rafId = 0

// 两层：线在底层，圆在上层
const lineLayer = new Layer()
const circleLayer = new Layer()

// 真实尺寸（近似常见 9 尺桌，单位 cm）- 改为响应式
const tableWcm = ref(254)
const tableHcm = ref(127)
const cushionMarginCm = 3.5 // 胶边内缩
const pocketRadiusCm = 6.0  // 近似袋口半径
const ballRadiusCm = 2.86   // 球半径（57.15mm 直径）

// 全局比例：每厘米多少像素（用于把长度转为 cm）
const pxPerCm = ref(6.0) // 默认 6 px/cm

// 变量：球直径设置，半径通过计算得出
const ballDiameter = ref(ballRadiusCm * 2) // cm，直径
const r = computed(() => ballDiameter.value / 2) // cm，半径
// 口袋直径设置，半径通过计算得出
const pocketDiameter = ref(pocketRadiusCm * 2) // cm，直径
const pocketRcm = computed(() => pocketDiameter.value / 2) // cm，半径

// 添加初始化完成标志（需要在watchEffect之前定义）
const isInitialized = ref(false)

// 4 个圆：1=母球，2=母球击中目标球时的“虚影”，3=目标球，4=球洞
const rPxInit = r.value * pxPerCm.value
const c1 = new Circle(100, 100, rPxInit, { strokeStyle: '#111827', fillStyle: '#ffffff', lineWidth: 2 }) // 母球：实心白
const c2 = new Circle(220, 120, rPxInit, { strokeStyle: '#334155', lineWidth: 2, dashed: [6, 6] }) // 虚影：仅描边虚线
const c3 = new Circle(180, 220, rPxInit, { strokeStyle: '#111827', fillStyle: '#f59e0b', lineWidth: 2 }) // 目标球：实心黄
const c4 = new Circle(360, 80, pocketRadiusCm * pxPerCm.value, { fillStyle: '#111827', strokeStyle: '#111827', lineWidth: 1 }) // 洞（实心深色）

// 线段：c3->c4（目标球朝洞）、c1->c2（发射线）、c1->c3（母球到目标球）、c2->c3（虚影到目标球）、c4->c3（球洞到目标球射线）
const aimLine = new Line(c3, c4, { strokeStyle: '#94a3b8', lineWidth: 1 })
const cueLine = new Line(c1, c2, { strokeStyle: '#60a5fa', lineWidth: 1, dashed: [4, 4] })
const hitLine = new Line(c1, c3, { strokeStyle: '#22c55e', lineWidth: 1 })
const stLine = new Line(c2, c3, { strokeStyle: '#a78bfa', lineWidth: 1, dashed: [4, 4] }) // shadow-target
const pocketRayLine = new Line(c4, c3, { strokeStyle: '#f97316', lineWidth: 1, dashed: [4, 4] }) // 球洞到目标球射线（虚线）

// 显示开关
const showCueLine = ref(true)
const showHitLine = ref(true)
const showAimLine = ref(true)
const showSTLine = ref(false)
const showPocketRay = ref(true) // 球洞到目标球射线
const showCueRay = ref(true)
const showCrossGuides = ref(false)
const showCorridor = ref(true)
const showAngleCueHit = ref(false)
const showAngleHV = ref(false)
const showLengths = ref(false)
const showPocketHitAngle = ref(true) // 显示球洞射线与视线的夹角
const hvOffsetMul = ref(6) // 与水平/竖直角度标注距交点的倍数（×球半径）
const pocketAngleDistance = ref(3) // 球洞射线角度标注距离交点的倍数（×球半径）
// 视线生成逻辑
type HitLineMode = 'center' | 'ghost'
const hitLineMode = ref<HitLineMode>('ghost')

// 关键偏移桥模式与读数
type BridgeMode = 'tangent' | 'horizontal' | 'vertical' | 'pocket_ray'
const bridgeMode = ref<BridgeMode>('tangent')
const bridgeLenCm = ref<string>('—')

// 初始化 Window
let win = new Window(0, 0, 800, 500)

// 无解标记
const solvable = ref(true)

// 台球桌 8 个洞与选中索引（默认左上角）
const pockets = ref<P[]>([])
const selectedPocket = ref<number>(0)
// 初始化坐标是否已设置过（避免窗口 resize 时重复覆写用户拖拽）
const didInitPositions = ref(false)

// 计算桌面绘制区域参数
function getTableFrame() {
  const W = win.rec.width.value
  const H = win.rec.height.value
  const idealW = tableWcm.value * pxPerCm.value
  const idealH = tableHcm.value * pxPerCm.value
  const scale = Math.min(W / idealW, H / idealH, 1)
  const drawW = idealW * scale
  const drawH = idealH * scale
  const offX = (W - drawW) / 2
  const offY = (H - drawH) / 2
  return { W, H, idealW, idealH, scale, drawW, drawH, offX, offY, cx: offX + drawW / 2, cy: offY + drawH / 2 }
}

// DPR 适配 + 尺寸同步 + 生成 8 洞
function resizeCanvas() {
  const cvs = canvasRef.value
  if (!cvs) return
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const rect = cvs.getBoundingClientRect()
  cvs.width = Math.max(1, Math.floor(rect.width * dpr))
  cvs.height = Math.max(1, Math.floor(rect.height * dpr))
  const _ctx = cvs.getContext('2d')
  if (_ctx) {
    _ctx.setTransform(1, 0, 0, 1, 0, 0)
    _ctx.scale(dpr, dpr)
  }
  // 同步 Window 视口（CSS 像素）
  win.rec.width.value = rect.width
  win.rec.height.value = rect.height
  win.pos.x.value = 0
  win.pos.y.value = 0
  win.horizon.x.value = 0
  win.horizon.y.value = 0
  win.horizon.ratio.value = 1

  // 8 个洞：四角 + 四边中点
  const { drawW, drawH, offX, offY, scale, cx, cy } = getTableFrame()
  const mPx = cushionMarginCm * pxPerCm.value * scale
  const prPx = pocketRcm.value * pxPerCm.value * scale
  const left = offX + mPx
  const right = offX + drawW - mPx
  const top = offY + mPx
  const bottom = offY + drawH - mPx

  pockets.value = [
    { x: left,  y: top },    // 左上
    { x: right, y: top },    // 右上
    { x: left,  y: bottom }, // 左下
    { x: right, y: bottom }, // 右下
    { x: cx,    y: top },    // 上中
    { x: cx,    y: bottom }, // 下中
  ]

  // 同步 c4 半径为口袋半径
  c4.radius = prPx

  // 根据默认或已选洞同步 c4
  const p = pockets.value[selectedPocket.value] ?? pockets.value[0]
  if (p) c4.moveTo(p.x, p.y)
}

// ========== 约束计算 ==========
// 计算视线的终点位置（根据模式）
function getHitLineEndPoint() {
  if (hitLineMode.value === 'center') {
    // 模式1：母球圆心到目标球圆心
    return { x: c3.position.x, y: c3.position.y }
  } else {
    // 模式2：母球圆心到鬼球目标球切点
    // 鬼球的位置就是c2的位置，切点是鬼球与目标球的接触点
    const p2 = { x: c2.position.x, y: c2.position.y } // 鬼球圆心
    const p3 = { x: c3.position.x, y: c3.position.y } // 目标球圆心

    // 鬼球与目标球的连线方向
    const vx = p3.x - p2.x
    const vy = p3.y - p2.y
    const len = Math.hypot(vx, vy)
    if (!(len > 1e-6)) return { x: c3.position.x, y: c3.position.y }
    const ux = vx / len
    const uy = vy / len

    // 切点：鬼球圆心 + 方向向量 × 鬼球半径
    return {
      x: p2.x + ux * c2.radius,
      y: p2.y + uy * c2.radius
    }
  }
}

function recomputeC2() {
  // c2的计算始终基于c3→c4的反向，不受视线模式影响
  const vx = c4.position.x - c3.position.x
  const vy = c4.position.y - c3.position.y
  const len = Math.hypot(vx, vy)
  const dist = c2.radius + c3.radius
  if (!(len > 1e-6 && isFinite(len))) {
    c2.config.visible = false
    solvable.value = false
    return
  }
  const ux = vx / len
  const uy = vy / len
  const x = c3.position.x - ux * dist
  const y = c3.position.y - uy * dist
  c2.moveTo(x, y)
  c2.config.visible = true
  solvable.value = true
}

// r1 = r2 = rPx；并单独“让 r3 = rPx”
watchEffect(() => {
  const rPx = r.value * pxPerCm.value
  c1.radius = rPx
  c2.radius = rPx
  c3.radius = rPx
  recomputeC2()
})

// 比例或位置变化时重算 c2、重布洞位
watchEffect(() => {
  void c1.position.x; void c1.position.y
  void c3.position.x; void c3.position.y
  void c4.position.x; void c4.position.y
  const _ratio = pxPerCm.value
  if (isInitialized.value) {
    // resizeCanvas()
  }
  recomputeC2()
})

// 口袋直径改变时，重算像素半径并刷新
watchEffect(() => {
  void pocketDiameter.value
  if (isInitialized.value) {
    resizeCanvas()
  }
  recomputeC2()
})

// 控制线段显示
watchEffect(() => {
  cueLine.config.visible = showCueLine.value
  hitLine.config.visible = false // 隐藏原来的hitLine，使用动态绘制
  aimLine.config.visible = showAimLine.value
  stLine.config.visible = showSTLine.value
  pocketRayLine.config.visible = false // 隐藏原来的pocketRayLine，使用动态绘制
})



// ========== 鼠标交互：拖动 c1、c3；点击选择洞 ==========
type Dragging = 'c1' | 'c3' | null
let dragging: Dragging = null

// 点击移动模式
const clickMoveMode = ref(false)
type ClickMoveState = 'none' | 'selected_c1' | 'selected_c3'
let clickMoveState: ClickMoveState = 'none'

// 侧栏控制
type SelectedBall = 'cue' | 'target'
const selectedBall = ref<SelectedBall>('cue')
const horizontalPosition = ref(0) // 0-100 百分比，初始化为0，稍后会根据球位置更新
const verticalPosition = ref(0)   // 0-100 百分比，初始化为0，稍后会根据球位置更新

// 只监听滑动条变化，更新球位置
watch([horizontalPosition, verticalPosition], () => {
  if (isInitialized.value) {
    updateBallFromSliders()
  }
})

// 监听selectedBall变化，更新滑动条到新选中球的位置
watch(selectedBall, () => {
  if (isInitialized.value) {
    updateSlidersFromBall()
  }
})

function getPointerWorld(e: MouseEvent) {
  const cvs = canvasRef.value!
  const rect = cvs.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  return { x, y }
}

function tryPickPocket(e: MouseEvent): boolean {
  const p = getPointerWorld(e)
  let picked = -1
  const pr = c4.radius
  const th = Math.max(20, pr + 6)
  for (let i = 0; i < pockets.value.length; i++) {
    const q = pockets.value[i]
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d <= th) { picked = i; break }
  }
  if (picked >= 0) {
    selectedPocket.value = picked
    const q = pockets.value[picked]
    c4.moveTo(q.x, q.y)
    recomputeC2()
    return true
  }
  return false
}

function onMouseDown(e: MouseEvent) {
  e.preventDefault()
  if (tryPickPocket(e)) {
    dragging = null
    clickMoveState = 'none'
    return
  }

  const p = getPointerWorld(e)
  const s1 = win.toScreen(c1.position)
  const s3 = win.toScreen(c3.position)
  const d1 = Math.hypot(p.x - s1.x, p.y - s1.y)
  const d3 = Math.hypot(p.x - s3.x, p.y - s3.y)
  const within1 = d1 <= c1.radius + 6
  const within3 = d3 <= c3.radius + 6

  if (clickMoveMode.value) {
    // 点击移动模式
    if (within1) {
      clickMoveState = 'selected_c1'
      dragging = null
    } else if (within3) {
      clickMoveState = 'selected_c3'
      dragging = null
    } else {
      // 点击空白处，移动已选中的球
      if (clickMoveState === 'selected_c1') {
        c1.moveTo(p.x, p.y)
        if (selectedBall.value === 'cue') updateSlidersFromBall()
        recomputeC2()
      } else if (clickMoveState === 'selected_c3') {
        c3.moveTo(p.x, p.y)
        if (selectedBall.value === 'target') updateSlidersFromBall()
        recomputeC2()
      }
      clickMoveState = 'none'
    }
  } else {
    // 传统拖动模式
    if (within1 && within3) dragging = 'c1'
    else if (within1) dragging = 'c1'
    else if (within3) dragging = 'c3'
    else dragging = null
    clickMoveState = 'none'
  }
}

function onMouseMove(e: MouseEvent) {
  if (!dragging || clickMoveMode.value) return
  const p = getPointerWorld(e)
  if (dragging === 'c1') {
    c1.moveTo(p.x, p.y)
    if (selectedBall.value === 'cue') updateSlidersFromBall()
  } else if (dragging === 'c3') {
    c3.moveTo(p.x, p.y)
    if (selectedBall.value === 'target') updateSlidersFromBall()
  }
  recomputeC2()
}

function onMouseUp()   {
  dragging = null
}
function onMouseLeave(){
  dragging = null
  clickMoveState = 'none'
}

// 根据滑动条位置更新球的位置
function updateBallFromSliders() {
  const { offX, drawW, offY, drawH } = getTableFrame()
  const margin = cushionMarginCm * pxPerCm.value

  // 计算可移动区域（考虑球的半径和胶边）
  const ballRadius = r.value * pxPerCm.value
  const minX = offX + margin + ballRadius
  const maxX = offX + drawW - margin - ballRadius
  const minY = offY + margin + ballRadius
  const maxY = offY + drawH - margin - ballRadius

  // 根据百分比计算实际位置
  const x = minX + (maxX - minX) * (horizontalPosition.value / 100)
  const y = minY + (maxY - minY) * (verticalPosition.value / 100)

  if (selectedBall.value === 'cue') {
    c1.moveTo(x, y)
  } else {
    c3.moveTo(x, y)
  }
  recomputeC2()
}

// 根据球的位置更新滑动条
function updateSlidersFromBall() {
  const { offX, drawW, offY, drawH } = getTableFrame()
  const margin = cushionMarginCm * pxPerCm.value
  const ballRadius = r.value * pxPerCm.value

  const minX = offX + margin + ballRadius
  const maxX = offX + drawW - margin - ballRadius
  const minY = offY + margin + ballRadius
  const maxY = offY + drawH - margin - ballRadius

  const ball = selectedBall.value === 'cue' ? c1 : c3

  // 计算百分比位置
  const hPercent = Math.max(0, Math.min(100, ((ball.position.x - minX) / (maxX - minX)) * 100))
  const vPercent = Math.max(0, Math.min(100, ((ball.position.y - minY) / (maxY - minY)) * 100))

  horizontalPosition.value = hPercent
  verticalPosition.value = vPercent
}

// 重置：母球/目标球到桌心，视角置中、默认左上角袋
function resetAll() {
  const { offX, drawW, offY, drawH } = getTableFrame()
  const cy = offY + drawH / 2
  const xLeft = offX + drawW / 3
  const xRight = offX + drawW * 2 / 3
  c1.moveTo(xRight, cy) // 右侧 1/3
  c3.moveTo(xLeft,  cy) // 左侧 1/3
  selectedPocket.value = 0
  const p = pockets.value[0]
  if (p) c4.moveTo(p.x, p.y)
  // 视角/坐标
  win.pos.x.value = 0
  win.pos.y.value = 0
  win.horizon.x.value = 0
  win.horizon.y.value = 0
  clickMoveState = 'none'
  updateSlidersFromBall()
  recomputeC2()
}

// ========== Overlay 绘制：桌面/口袋/走廊/标注/角度/射线 ==========
function drawTableSurface() {
  if (!ctx) return
  const { drawW, drawH, offX, offY } = getTableFrame()
  ctx.save()
  ctx.fillStyle = '#0b7a53' // 台呢绿
  ctx.strokeStyle = '#14532d'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.rect(offX, offY, drawW, drawH)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawDashedLine(p1: P, p2: P, color = '#94a3b8', dash = [6, 6], width = 1) {
  if (!ctx) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.stroke()
  ctx.restore()
}

function drawTextLabel(text: string, x: number, y: number) {
  if (!ctx) return
  ctx.save()
  ctx.font = '12px system-ui, sans-serif'
  const padX = 4, padY = 2
  const metrics = ctx.measureText(text)
  const w = metrics.width + padX * 2
  const h = 14 + padY * 2
  // 更透明的文字背景
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.strokeStyle = 'rgba(0,0,0,0.05)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.rect(x - w / 2, y - h / 2, w, h)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#111827'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x - w / 2 + padX, y)
  ctx.restore()
}

function mid(a: P, b: P): P { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
function deg(rad: number) { return rad * 180 / Math.PI }
function angleBetween(ax: number, ay: number, bx: number, by: number) {
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
  if (!(la > 1e-6 && lb > 1e-6)) return 0
  const dot = (ax * bx + ay * by) / (la * lb)
  const c = Math.min(1, Math.max(-1, dot))
  return deg(Math.acos(c))
}
function lengthCm(p1: P, p2: P) {
  const lenPx = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const cm = lenPx / Math.max(0.0001, pxPerCm.value)
  return { lenPx, cm }
}
function pointSegmentDistance(pt: P, a: P, b: P) {
  const ab = { x: b.x - a.x, y: b.y - a.y }
  const ap = { x: pt.x - a.x, y: pt.y - a.y }
  const ab2 = ab.x * ab.x + ab.y * ab.y
  if (ab2 <= 1e-8) return Math.hypot(ap.x, ap.y)
  let t = (ap.x * ab.x + ap.y * ab.y) / ab2
  t = Math.max(0, Math.min(1, t))
  const proj = { x: a.x + ab.x * t, y: a.y + ab.y * t }
  return Math.hypot(pt.x - proj.x, pt.y - proj.y)
}

function drawPockets() {
  if (!ctx) return
  ctx.save()
  for (let i = 0; i < pockets.value.length; i++) {
    const p = pockets.value[i]
    ctx.beginPath()
    ctx.fillStyle = '#0f172a'
    ctx.arc(p.x, p.y, c4.radius, 0, Math.PI * 2)
    ctx.fill()
    if (i === selectedPocket.value) {
      ctx.lineWidth = 2
      ctx.strokeStyle = '#22d3ee'
      ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}

function drawCrossGuides() {
  if (!showCrossGuides.value) return
  const s1 = win.toScreen(c1.position)
  // 改为灰色虚线
  drawDashedLine({ x: 0, y: s1.y }, { x: win.rec.width.value, y: s1.y }, '#9ca3af', [6, 6], 1)
  drawDashedLine({ x: s1.x, y: 0 }, { x: s1.x, y: win.rec.height.value }, '#9ca3af', [6, 6], 1)
}

function drawLengthLabels() {
  if (!showLengths.value) return
  const s1 = win.toScreen(c1.position)
  const s2 = win.toScreen(c2.position)
  const s3 = win.toScreen(c3.position)
  const s4 = win.toScreen(c4.position)
  const hitEndPoint = getHitLineEndPoint()
  const sHitEnd = win.toScreen(hitEndPoint)

  const l12 = lengthCm(s1, s2).cm.toFixed(1) + ' cm'
  const lHit = lengthCm(s1, sHitEnd).cm.toFixed(1) + ' cm'
  const l34 = lengthCm(s3, s4).cm.toFixed(1) + ' cm'

  // 蓝线长度：靠近母球的1/3位置
  const pos12 = { x: s1.x + (s2.x - s1.x) * 0.33, y: s1.y + (s2.y - s1.y) * 0.33 }
  // 绿线长度：靠近目标球的1/3位置
  const posHit = { x: s1.x + (sHitEnd.x - s1.x) * 0.67, y: s1.y + (sHitEnd.y - s1.y) * 0.67 }
  const m34 = mid(s3, s4)

  if (showCueLine.value) drawTextLabel(l12, pos12.x, pos12.y - 12)
  if (showHitLine.value) drawTextLabel(lHit, posHit.x, posHit.y - 12)
  if (showAimLine.value) drawTextLabel(l34, m34.x, m34.y - 12)

  // c2-c3（虚影-目标）长度（当显示 ST 线时）
  if (showSTLine.value) {
    const m23 = mid(s2, s3)
    const l23 = lengthCm(s2, s3).cm.toFixed(1) + ' cm'
    drawTextLabel(l23, m23.x, m23.y - 12)
  }
}

// cue 与 hit 的夹角标注：放到两线段夹角的角平分线方向、靠近顶点（c1）的位置
function drawCueHitAngleAtC1() {
  if (!showAngleCueHit.value) return
  const p = { x: c1.position.x, y: c1.position.y }
  const vCue = { x: c2.position.x - p.x, y: c2.position.y - p.y }
  const hitEndPoint = getHitLineEndPoint()
  const vHit = { x: hitEndPoint.x - p.x, y: hitEndPoint.y - p.y }
  const a = angleBetween(vCue.x, vCue.y, vHit.x, vHit.y)
  const nCue = (() => {
    const L = Math.hypot(vCue.x, vCue.y); return L > 1e-6 ? { x: vCue.x / L, y: vCue.y / L } : { x: 1, y: 0 }
  })()
  const nHit = (() => {
    const L = Math.hypot(vHit.x, vHit.y); return L > 1e-6 ? { x: vHit.x / L, y: vHit.y / L } : { x: 1, y: 0 }
  })()
  let bis = { x: nCue.x + nHit.x, y: nCue.y + nHit.y }
  const bL = Math.hypot(bis.x, bis.y)
  if (bL <= 1e-6) bis = { x: -nCue.y, y: nCue.x }
  else { bis = { x: bis.x / bL, y: bis.y / bL } }
  const anchor = { x: p.x + bis.x * (c1.radius + 24), y: p.y + bis.y * (c1.radius + 24) }
  const s = win.toScreen(anchor)
  drawTextLabel(`∠=${a.toFixed(1)}°`, s.x, s.y)
}

// 与水平/竖直夹角：放在与交点的水平/竖直线上，朝向对应线段一侧，距离 = hvOffsetMul × 球半径
function drawAnglesHV() {
  if (!showAngleHV.value) return
  const p1 = { x: c1.position.x, y: c1.position.y }
  const s1 = win.toScreen(p1)
  const vCue = { x: c2.position.x - p1.x, y: c2.position.y - p1.y }

  // 与水平的锐角（0..90）
  const acuteH = (vx: number, vy: number) => {
    const L = Math.hypot(vx, vy)
    if (!(L > 1e-6)) return 0
    const cosH = Math.abs(vx) / L
    return deg(Math.acos(Math.min(1, Math.max(0, cosH))))
  }

  // cue 的水平/竖直锐角
  const cueH = acuteH(vCue.x, vCue.y)
  const cueV = 90 - cueH

  // 偏移
  const d = c1.radius * hvOffsetMul.value
  const signX_cue = (vCue.x >= 0 ? 1 : -1) || 1
  const signY_cue = (vCue.y >= 0 ? 1 : -1) || 1

  // 只显示 < 90° 的角；=90°时不显示该轴
  const EPS = 1e-3
  const showCueH = cueH < 90 - EPS
  const showCueV = cueV < 90 - EPS

  if (showCueH) drawTextLabel(`cue∠H:${cueH.toFixed(1)}°`, s1.x + signX_cue * d, s1.y)
  if (showCueV) drawTextLabel(`cue∠V:${cueV.toFixed(1)}°`, s1.x, s1.y + signY_cue * d)
}

// 球洞射线与视线的夹角：画出橙色实线并标注角度
function drawPocketHitAngle() {
  if (!showPocketHitAngle.value || !showPocketRay.value || !showHitLine.value) return

  const p1 = { x: c1.position.x, y: c1.position.y } // 母球
  const p4 = { x: c4.position.x, y: c4.position.y } // 球洞
  const hitEndPoint = getHitLineEndPoint() // 交点

  // 视线方向（从交点指向母球，即视线靠母球部分）
  const vHit = { x: p1.x - hitEndPoint.x, y: p1.y - hitEndPoint.y }
  // 球洞射线方向（从交点沿球洞射线延长方向，即远离球洞的方向）
  const vPocket = { x: hitEndPoint.x - p4.x, y: hitEndPoint.y - p4.y }

  // 计算夹角（取小于90度的角）
  let angle = angleBetween(vHit.x, vHit.y, vPocket.x, vPocket.y)
  // if (angle > 90) angle = 180 - angle

  // 标准化方向向量
  const LHit = Math.hypot(vHit.x, vHit.y)
  const LPocket = Math.hypot(vPocket.x, vPocket.y)
  if (!(LHit > 1e-6 && LPocket > 1e-6)) return

  const uhx = vHit.x / LHit, uhy = vHit.y / LHit
  const upx = vPocket.x / LPocket, upy = vPocket.y / LPocket

  // 线段长度：从交点到角度文字显示位置的距离
  const lineLength = c3.radius * pocketAngleDistance.value

  // 两条线的终点
  const hitLineEnd = { x: hitEndPoint.x + uhx * lineLength, y: hitEndPoint.y + uhy * lineLength }
  const pocketLineEnd = { x: hitEndPoint.x + upx * lineLength, y: hitEndPoint.y + upy * lineLength }

  // 转换为屏幕坐标
  const sCenter = win.toScreen(hitEndPoint)
  const sHitEnd = win.toScreen(hitLineEnd)
  const sPocketEnd = win.toScreen(pocketLineEnd)

  if (!ctx) return

  // 绘制两条实线
  ctx.save()
  ctx.strokeStyle = '#00cc00'
  ctx.lineWidth = 2.5
  ctx.setLineDash([])

  // 视线部分
  ctx.beginPath()
  ctx.moveTo(sCenter.x, sCenter.y)
  ctx.lineTo(sHitEnd.x, sHitEnd.y)
  ctx.stroke()

  // 球洞射线部分
  ctx.beginPath()
  ctx.moveTo(sCenter.x, sCenter.y)
  ctx.lineTo(sPocketEnd.x, sPocketEnd.y)
  ctx.stroke()

  ctx.restore()

  // 角度标注位置：显示在球洞射线上
  const labelDistance = lineLength * 0.8 // 稍微靠近交点一些
  const labelPos = {
    x: hitEndPoint.x + upx * labelDistance,
    y: hitEndPoint.y + upy * labelDistance
  }

  const sLabel = win.toScreen(labelPos)
  drawTextLabel(`∠=${angle.toFixed(1)}°`, sLabel.x, sLabel.y)
}

// 走廊：母球到虚影两侧相切虚线，如可能擦到目标球则变红
function drawCorridor() {
  if (!ctx || !showCorridor.value) return
  const a = { x: c1.position.x, y: c1.position.y }
  const b = { x: c2.position.x, y: c2.position.y }
  const v = { x: b.x - a.x, y: b.y - a.y }
  const L = Math.hypot(v.x, v.y)
  if (!(L > 1e-6)) return
  const ux = v.x / L, uy = v.y / L
  const nx = -uy, ny = ux
  const d = c1.radius
  const aL = { x: a.x + nx * d, y: a.y + ny * d }
  const bL = { x: b.x + nx * d, y: b.y + ny * d }
  const aR = { x: a.x - nx * d, y: a.y - ny * d }
  const bR = { x: b.x - nx * d, y: b.y - ny * d }

  const p3 = { x: c3.position.x, y: c3.position.y }
  const hitL = pointSegmentDistance(p3, aL, bL) <= c3.radius + 0.5
  const hitR = pointSegmentDistance(p3, aR, bR) <= c3.radius + 0.5

  const sAL = win.toScreen(aL), sBL = win.toScreen(bL)
  const sAR = win.toScreen(aR), sBR = win.toScreen(bR)
  drawDashedLine(sAL, sBL, hitL ? '#ef4444' : '#94a3b8', [8, 6], 1.5)
  drawDashedLine(sAR, sBR, hitR ? '#ef4444' : '#94a3b8', [8, 6], 1.5)
}

// 发射射线：将 c1->c2 延长到画布边界
function drawCueRay() {
  if (!showCueRay.value || !ctx) return
  const a = { x: c1.position.x, y: c1.position.y }
  const b = { x: c2.position.x, y: c2.position.y }
  const v = { x: b.x - a.x, y: b.y - a.y }
  const L = Math.hypot(v.x, v.y)
  if (!(L > 1e-6)) return
  const ux = v.x / L, uy = v.y / L

  // 求与画布边界交点
  const W = win.rec.width.value, H = win.rec.height.value
  const candidates: P[] = []
  // 与 x=0, x=W 边界
  if (Math.abs(ux) > 1e-8) {
    const t1 = (0 - a.x) / ux, y1 = a.y + uy * t1
    if (t1 > 0 && y1 >= 0 && y1 <= H) candidates.push({ x: 0, y: y1 })
    const t2 = (W - a.x) / ux, y2 = a.y + uy * t2
    if (t2 > 0 && y2 >= 0 && y2 <= H) candidates.push({ x: W, y: y2 })
  }
  // 与 y=0, y=H 边界
  if (Math.abs(uy) > 1e-8) {
    const t3 = (0 - a.y) / uy, x3 = a.x + ux * t3
    if (t3 > 0 && x3 >= 0 && x3 <= W) candidates.push({ x: x3, y: 0 })
    const t4 = (H - a.y) / uy, x4 = a.x + ux * t4
    if (t4 > 0 && x4 >= 0 && x4 <= W) candidates.push({ x: x4, y: H })
  }
  // 选择最近的前向交点
  let end: P | null = null
  let bestT = Infinity
  for (const p of candidates) {
    const t = (Math.abs(ux) > Math.abs(uy))
      ? (p.x - a.x) / ux
      : (p.y - a.y) / uy
    if (t > 0 && t < bestT) { bestT = t; end = p }
  }
  if (!end) return
  const sA = win.toScreen(a)
  const sE = win.toScreen(end)
  if (!ctx) return
  ctx.save()
  ctx.strokeStyle = '#60a5fa'
  ctx.lineWidth = 1
  ctx.setLineDash([2, 6])
  ctx.beginPath()
  ctx.moveTo(sA.x, sA.y)
  ctx.lineTo(sE.x, sE.y)
  ctx.stroke()
  ctx.restore()
}

// 球洞射线：将 c4->c3 延长到画布边界
function drawPocketRay() {
  if (!showPocketRay.value || !ctx) return
  const a = { x: c4.position.x, y: c4.position.y } // 球洞
  const b = { x: c3.position.x, y: c3.position.y } // 目标球
  const v = { x: b.x - a.x, y: b.y - a.y }
  const L = Math.hypot(v.x, v.y)
  if (!(L > 1e-6)) return
  const ux = v.x / L, uy = v.y / L

  // 求与画布边界交点
  const W = win.rec.width.value, H = win.rec.height.value
  const candidates: P[] = []
  // 与 x=0, x=W 边界
  if (Math.abs(ux) > 1e-8) {
    const t1 = (0 - a.x) / ux, y1 = a.y + uy * t1
    if (t1 > 0 && y1 >= 0 && y1 <= H) candidates.push({ x: 0, y: y1 })
    const t2 = (W - a.x) / ux, y2 = a.y + uy * t2
    if (t2 > 0 && y2 >= 0 && y2 <= H) candidates.push({ x: W, y: y2 })
  }
  // 与 y=0, y=H 边界
  if (Math.abs(uy) > 1e-8) {
    const t3 = (0 - a.y) / uy, x3 = a.x + ux * t3
    if (t3 > 0 && x3 >= 0 && x3 <= W) candidates.push({ x: x3, y: 0 })
    const t4 = (H - a.y) / uy, x4 = a.x + ux * t4
    if (t4 > 0 && x4 >= 0 && x4 <= W) candidates.push({ x: x4, y: H })
  }
  // 选择最近的前向交点
  let end: P | null = null
  let bestT = Infinity
  for (const p of candidates) {
    const t = (Math.abs(ux) > Math.abs(uy))
      ? (p.x - a.x) / ux
      : (p.y - a.y) / uy
    if (t > 0 && t < bestT) { bestT = t; end = p }
  }
  if (!end) return
  const sA = win.toScreen(a)
  const sE = win.toScreen(end)
  if (!ctx) return
  ctx.save()
  ctx.strokeStyle = '#bbbbbb'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(sA.x, sA.y)
  ctx.lineTo(sE.x, sE.y)
  ctx.stroke()
  ctx.restore()
}


// 目标球切线桥/水平桥/竖直桥：在视线与目标球的接触点处，向蓝色虚线作线段，并标注长度
function drawTangentBridge() {
  if (!ctx) return
  if (!c2.config.visible) { bridgeLenCm.value = '—'; return }

  const p1 = { x: c1.position.x, y: c1.position.y } // 母球
  const p2 = { x: c2.position.x, y: c2.position.y } // 虚影
  const p4 = { x: c4.position.x, y: c4.position.y } // 球洞
  const hitEndPoint = getHitLineEndPoint() // 视线终点

  // 特殊算法：球洞射线模式（仅在ghost模式下可用）
  if (bridgeMode.value === 'pocket_ray' && hitLineMode.value === 'ghost') {
    const ghostContact = hitEndPoint // 鬼球切点

    // 球洞射线方向（c4 -> ghostContact）
    const vPocket = { x: ghostContact.x - p4.x, y: ghostContact.y - p4.y }
    const Lp = Math.hypot(vPocket.x, vPocket.y)
    if (!(Lp > 1e-6)) { bridgeLenCm.value = '—'; return }
    const up = { x: vPocket.x / Lp, y: vPocket.y / Lp }

    // 瞄准线方向（c1 -> c2）
    const vCue = { x: p2.x - p1.x, y: p2.y - p1.y }
    const Lc = Math.hypot(vCue.x, vCue.y)
    if (!(Lc > 1e-6)) { bridgeLenCm.value = '—'; return }
    const uc = { x: vCue.x / Lc, y: vCue.y / Lc }

    // 计算球洞射线与瞄准线的交点
    const cross2 = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx
    const denom = cross2(up.x, up.y, uc.x, uc.y)
    if (Math.abs(denom) <= 1e-8) { bridgeLenCm.value = '—'; return } // 平行

    const diff = { x: p1.x - p4.x, y: p1.y - p4.y }
    const t = cross2(diff.x, diff.y, uc.x, uc.y) / denom
    const intersection = { x: p4.x + up.x * t, y: p4.y + up.y * t }

    // 计算鬼球切点到交点的距离
    const distance = Math.hypot(intersection.x - ghostContact.x, intersection.y - ghostContact.y)
    const distanceCm = distance / Math.max(0.0001, pxPerCm.value)

    // 绘制线段
    const sA = win.toScreen(ghostContact)
    const sB = win.toScreen(intersection)

    ctx.save()
    ctx.strokeStyle = '#06b6d4'
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(sA.x, sA.y)
    ctx.lineTo(sB.x, sB.y)
    ctx.stroke()
    ctx.restore()

    const l = distanceCm.toFixed(1) + ' cm'
    bridgeLenCm.value = l
    const m = mid(sA, sB)
    drawTextLabel(l, m.x, m.y - 12)
    return
  }

  // 通用算法：切线/水平/竖直模式
  // 视线方向（c1 -> hitEndPoint）
  const vHit = { x: hitEndPoint.x - p1.x, y: hitEndPoint.y - p1.y }
  const Lh = Math.hypot(vHit.x, vHit.y)
  if (!(Lh > 1e-6)) { bridgeLenCm.value = '—'; return }
  const uh = { x: vHit.x / Lh, y: vHit.y / Lh }

  // 计算接触点
  let contact: P
  if (hitLineMode.value === 'center') {
    // Center模式：视线与目标球的接触点（靠近 c1）
    const p3 = { x: c3.position.x, y: c3.position.y }
    contact = { x: p3.x - uh.x * c3.radius, y: p3.y - uh.y * c3.radius }
  } else {
    // Ghost模式：接触点就是视线终点（鬼球切点）
    contact = hitEndPoint
  }

  // 蓝色虚线方向（c1 -> c2）
  const vCue = { x: p2.x - p1.x, y: p2.y - p1.y }
  const Lc = Math.hypot(vCue.x, vCue.y)
  if (!(Lc > 1e-6)) { bridgeLenCm.value = '—'; return }
  const uc = { x: vCue.x / Lc, y: vCue.y / Lc }

  // 根据模式选择桥线方向
  let dir = { x: -uh.y, y: uh.x } // 切线：垂直视线
  if (bridgeMode.value === 'horizontal') dir = { x: 1, y: 0 }
  if (bridgeMode.value === 'vertical')   dir = { x: 0, y: 1 }

  const cross2 = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx
  const denom = cross2(dir.x, dir.y, uc.x, uc.y)
  if (Math.abs(denom) <= 1e-8) { bridgeLenCm.value = '—'; return } // 平行

  // 交点：contact + dir*t 与 p1 + uc*s 的交点
  const diff = { x: p1.x - contact.x, y: p1.y - contact.y }
  const t = cross2(diff.x, diff.y, uc.x, uc.y) / denom
  const inter = { x: contact.x + dir.x * t, y: contact.y + dir.y * t }

  // 绘制与标注
  const sA = win.toScreen(contact)
  const sB = win.toScreen(inter)

  ctx.save()
  // ctx.strokeStyle = '#06b6d4'
  ctx.strokeStyle = '#00ff00'
  ctx.lineWidth = 2.5
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(sA.x, sA.y)
  ctx.lineTo(sB.x, sB.y)
  ctx.stroke()
  ctx.restore()

  const l = lengthCm(sA, sB).cm.toFixed(1) + ' cm'
  bridgeLenCm.value = l
  const m = mid(sA, sB)
  drawTextLabel(l, m.x, m.y - 12)
}

// 绘制动态视线（根据模式）
function drawDynamicHitLine() {
  if (!showHitLine.value || !ctx) return

  const p1 = { x: c1.position.x, y: c1.position.y } // 母球圆心
  const endPoint = getHitLineEndPoint()

  const s1 = win.toScreen(p1)
  const s2 = win.toScreen(endPoint)

  ctx.save()
  ctx.strokeStyle = '#22c55e'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(s1.x, s1.y)
  ctx.lineTo(s2.x, s2.y)
  ctx.stroke()
  ctx.restore()
}

// 角度-偏移函数图像
function drawAngleOffsetChart() {
  if (false) return // 暂时隐藏，未来版本再开启
  if (!ctx) return

  // 图表位置和尺寸（移到右上角）
  const canvasW = win.rec.width.value
  const chartW = 200
  const chartH = 150
  const chartX = canvasW - chartW - 20
  const chartY = 20

  // 背景
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.fillRect(chartX, chartY, chartW, chartH)
  ctx.strokeRect(chartX, chartY, chartW, chartH)

  // 坐标轴
  ctx.strokeStyle = '#666'
  ctx.lineWidth = 1
  ctx.setLineDash([])

  // X轴（角度：0-180度）
  ctx.beginPath()
  ctx.moveTo(chartX, chartY + chartH)
  ctx.lineTo(chartX + chartW, chartY + chartH)
  ctx.stroke()

  // Y轴（偏移：固定范围0-20cm）
  ctx.beginPath()
  ctx.moveTo(chartX, chartY)
  ctx.lineTo(chartX, chartY + chartH)
  ctx.stroke()

  // 获取当前角度和偏移
  const currentAngle = getCurrentAngle()
  const currentOffset = getCurrentOffset()

  // 固定的Y轴范围
  const maxOffset = 20 // 固定最大偏移20cm

  if (currentAngle !== null && currentOffset !== null) {
    // 使用稳定角度计算函数关系，避免小角度误差
    const stableAngle = 45 // 使用45度作为参考角度，避免小角度的计算误差
    const stableOffset = getOffsetAtAngle(stableAngle)

    // 绘制函数曲线
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.beginPath()

    for (let angle = 0; angle <= 180; angle += 2) {
      let offset = 0
      if (angle > 0 && angle < 180 && stableOffset !== null) {
        // 基于稳定角度的比例关系计算
        const ratio = stableOffset / Math.sin((stableAngle * Math.PI) / 180)
        offset = Math.sin((angle * Math.PI) / 180) * ratio
      }

      const x = chartX + (angle / 180) * chartW
      const y = chartY + chartH - (offset / maxOffset) * chartH

      if (angle === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // 当前状态点
    const currentX = chartX + (currentAngle / 180) * chartW
    const currentY = chartY + chartH - (currentOffset / maxOffset) * chartH

    // 绘制当前点
    ctx.fillStyle = '#ef4444'
    ctx.beginPath()
    ctx.arc(currentX, currentY, 4, 0, 2 * Math.PI)
    ctx.fill()

    // 虚线到坐标轴
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])

    // 到X轴的虚线
    ctx.beginPath()
    ctx.moveTo(currentX, currentY)
    ctx.lineTo(currentX, chartY + chartH)
    ctx.stroke()

    // 到Y轴的虚线
    ctx.beginPath()
    ctx.moveTo(currentX, currentY)
    ctx.lineTo(chartX, currentY)
    ctx.stroke()

    // 标注数值
    ctx.fillStyle = '#333'
    ctx.font = '10px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(`${currentAngle.toFixed(1)}°`, currentX, chartY + chartH + 12)

    ctx.textAlign = 'right'
    ctx.fillText(`${currentOffset.toFixed(1)}cm`, chartX - 5, currentY + 3)
  }

  // 添加刻度标记
  ctx.strokeStyle = '#999'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.font = '9px Arial'
  ctx.fillStyle = '#666'

  // X轴刻度（每30度一个刻度）
  for (let angle = 0; angle <= 180; angle += 30) {
    const x = chartX + (angle / 180) * chartW
    ctx.beginPath()
    ctx.moveTo(x, chartY + chartH)
    ctx.lineTo(x, chartY + chartH - 5)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.fillText(`${angle}°`, x, chartY + chartH + 15)
  }

  // Y轴刻度（每5cm一个刻度）
  for (let offset = 0; offset <= 20; offset += 5) {
    const y = chartY + chartH - (offset / 20) * chartH
    ctx.beginPath()
    ctx.moveTo(chartX, y)
    ctx.lineTo(chartX + 5, y)
    ctx.stroke()

    ctx.textAlign = 'right'
    ctx.fillText(`${offset}`, chartX - 3, y + 3)
  }

  // 坐标轴标签
  ctx.fillStyle = '#333'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('角度 (°)', chartX + chartW / 2, chartY + chartH + 30)

  ctx.save()
  ctx.translate(chartX - 35, chartY + chartH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText('偏移 (cm)', 0, 0)
  ctx.restore()

  ctx.restore()
}

// 获取当前角度
function getCurrentAngle(): number | null {
  if (!showPocketHitAngle.value || !showPocketRay.value || !showHitLine.value) return null

  const p1 = { x: c1.position.x, y: c1.position.y }
  const p4 = { x: c4.position.x, y: c4.position.y }
  const hitEndPoint = getHitLineEndPoint()

  const vHit = { x: p1.x - hitEndPoint.x, y: p1.y - hitEndPoint.y }
  const vPocket = { x: hitEndPoint.x - p4.x, y: hitEndPoint.y - p4.y }

  let angle = angleBetween(vHit.x, vHit.y, vPocket.x, vPocket.y)
  // if (angle > 90) angle = 180 - angle

  return angle
}

// 获取当前偏移
function getCurrentOffset(): number | null {
  const bridgeStr = bridgeLenCm.value
  if (bridgeStr === '—') return null

  const match = bridgeStr.match(/([0-9.]+)/)
  return match ? parseFloat(match[1]) : null
}

// 计算指定角度下的偏移量（用于函数曲线计算）
function getOffsetAtAngle(targetAngle: number): number | null {
  // 临时保存当前状态
  const originalC1 = { x: c1.position.x, y: c1.position.y }
  const originalC3 = { x: c3.position.x, y: c3.position.y }
  const originalC4 = { x: c4.position.x, y: c4.position.y }

  try {
    // 设置一个标准配置来计算指定角度的偏移
    const p4 = { x: c4.position.x, y: c4.position.y } // 球洞位置保持不变
    const hitEndPoint = getHitLineEndPoint() // 当前交点

    // 计算目标角度对应的母球位置
    // 基于当前的几何关系，调整母球位置使角度为targetAngle
    const vPocket = { x: hitEndPoint.x - p4.x, y: hitEndPoint.y - p4.y }
    const LPocket = Math.hypot(vPocket.x, vPocket.y)
    if (!(LPocket > 1e-6)) return null

    const upx = vPocket.x / LPocket, upy = vPocket.y / LPocket

    // 计算目标角度对应的视线方向
    const targetAngleRad = (targetAngle * Math.PI) / 180
    const cosAngle = Math.cos(targetAngleRad)
    const sinAngle = Math.sin(targetAngleRad)

    // 通过旋转球洞射线方向得到视线方向
    const vHitX = upx * cosAngle - upy * sinAngle
    const vHitY = upx * sinAngle + upy * cosAngle

    // 设置临时母球位置
    const distance = Math.hypot(hitEndPoint.x - originalC1.x, hitEndPoint.y - originalC1.y)
    c1.moveTo(hitEndPoint.x + vHitX * distance, hitEndPoint.y + vHitY * distance)

    // 重新计算c2
    recomputeC2()

    // 计算这个配置下的偏移
    const tempBridgeStr = bridgeLenCm.value
    let result: number | null = null
    if (tempBridgeStr !== '—') {
      const match = tempBridgeStr.match(/([0-9.]+)/)
      result = match ? parseFloat(match[1]) : null
    }

    return result
  } finally {
    // 恢复原始状态
    c1.moveTo(originalC1.x, originalC1.y)
    c3.moveTo(originalC3.x, originalC3.y)
    c4.moveTo(originalC4.x, originalC4.y)
    recomputeC2()
  }
}

function drawOverlays() {
  if (!ctx) return
  // 过母球的水平/竖直虚线
  drawCrossGuides()
  // 走廊
  if (c2.config.visible) drawCorridor()
  // 发射射线
  drawCueRay()
  // 球洞射线
  drawPocketRay()
  // 动态视线（替代原来的hitLine）
  drawDynamicHitLine()
  // 球洞射线与视线夹角（角度实线，在瞄准偏移之前绘制）
  drawPocketHitAngle()
  // 目标球切线桥（瞄准偏移，在角度实线之上）
  drawTangentBridge()
  // 长度与角度标注
  drawLengthLabels()
  drawCueHitAngleAtC1()
  drawAnglesHV()
  // 函数图像
  // drawAngleOffsetChart()
}

// 动画渲染循环
function loop() {
  if (ctx) {
    // 清空画布以避免残影（考虑 DPI 变换）
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.restore()

    recomputeC2()
    // 先绘制桌面与球袋，再渲染球/线，最后覆盖标注
    drawTableSurface()
    drawPockets()
    win.render(ctx)
    drawOverlays()
  }
  rafId = requestAnimationFrame(loop)
}

onMounted(() => {
  const cvs = canvasRef.value
  if (!cvs) return
  ctx = cvs.getContext('2d')
  if (!ctx) return

  // 组装层和实体
  win.addLayer(lineLayer)
  win.addLayer(circleLayer)

  // 线在底层
  lineLayer.addEntity(aimLine)
  lineLayer.addEntity(cueLine)
  lineLayer.addEntity(hitLine)
  lineLayer.addEntity(stLine)
  lineLayer.addEntity(pocketRayLine)

  // 圆在上层（调整 z 使圆覆盖线）
  ;[c1, c2, c3, c4].forEach((c, i) => {
    c.config.z = 10 + i
    circleLayer.addEntity(c)
  })

  resizeCanvas()

  // 初始化默认母球/目标球：右侧 1/3 与左侧 1/3，竖直中线
  if (!didInitPositions.value) {
    const { offX, drawW, offY, drawH } = getTableFrame()
    const cy = offY + drawH / 2
    const xLeft = offX + drawW / 3
    const xRight = offX + drawW * 2 / 3
    c1.moveTo(xRight, cy)
    c3.moveTo(xLeft,  cy)
    didInitPositions.value = true
    recomputeC2()
  }

  // 初始化滑动条值为当前选中球的位置
  updateSlidersFromBall()

  // 标记初始化完成，启用监听器
  isInitialized.value = true

  window.addEventListener('resize', resizeCanvas)

  // 事件绑定
  cvs.addEventListener('mousedown', onMouseDown)
  cvs.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  cvs.addEventListener('mouseleave', onMouseLeave)

  // 默认选中左上角袋并同步
  selectedPocket.value = 0
  const p = pockets.value[0]
  if (p) c4.moveTo(p.x, p.y)

  loop()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas)
  cancelAnimationFrame(rafId)
  const cvs = canvasRef.value
  if (cvs) {
    cvs.removeEventListener('mousedown', onMouseDown)
    cvs.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    cvs.removeEventListener('mouseleave', onMouseLeave)
  }
})
</script>

<template>
  <div class="wrap">
    <div class="panel">
      <h2>台球几何约束演示</h2>
      <p class="hint">
        约束：r1 = r2 = r；并单独让 r3 = r。动态计算 c2，使 c2、c3、c4 三点共线且 c2 与 c3 外切。<br>
        鼠标：拖动母球(c1)/目标球(c3)；点击 6 个洞选择目标洞(c4)。<br>
        点击移动模式：先点击球选中，再点击空白处移动。侧栏可精确控制球位置。<br>
        新功能：球洞射线显示球洞到目标球的射线，并计算与视线的夹角。
      </p>

      <div class="grid">

        <!-- <fieldset>
          <legend>母球 c1</legend>
          <label>
            x
            <input type="number" v-model.number="c1.position.x" />
          </label>
          <label>
            y
            <input type="number" v-model.number="c1.position.y" />
          </label>
        </fieldset> -->

        <!-- <fieldset>
          <legend>目标球 c3</legend>
          <label>
            x
            <input type="number" v-model.number="c3.position.x" />
          </label>
          <label>
            y
            <input type="number" v-model.number="c3.position.y" />
          </label>
        </fieldset> -->

        <fieldset>
          <legend>交互模式</legend>
          <label>
            <input type="checkbox" v-model="clickMoveMode" />
            点击移动模式
          </label>
          <p v-if="clickMoveMode" class="mode-hint">
            点击球选中，再点击空白处移动
            <span v-if="clickMoveState === 'selected_c1'" class="selected">（已选中母球）</span>
            <span v-if="clickMoveState === 'selected_c3'" class="selected">（已选中目标球）</span>
          </p>
        </fieldset>

        <fieldset>
          <legend>精确位置控制</legend>
          <label>
            控制球
            <select v-model="selectedBall">
              <option value="cue">母球</option>
              <option value="target">目标球</option>
            </select>
          </label>
          <label>
            水平位置
            <input type="range" min="0" max="100" step="1" v-model.number="horizontalPosition" />
          </label>
          <label>
            水平 %
            <input type="number" min="0" max="100" step="1" v-model.number="horizontalPosition" />
          </label>
          <label>
            竖直位置
            <input type="range" min="0" max="100" step="1" v-model.number="verticalPosition" />
          </label>
          <label>
            竖直 %
            <input type="number" min="0" max="100" step="1" v-model.number="verticalPosition" />
          </label>
        </fieldset>

        <fieldset>
          <legend>显示开关（线段/标注）</legend>
          <label><input type="checkbox" v-model="showCueLine" /> cue(c1→c2)</label>
          <label><input type="checkbox" v-model="showHitLine" /> hit(c1→c3)</label>
          <label><input type="checkbox" v-model="showAimLine" /> aim(c3→c4)</label>
          <label><input type="checkbox" v-model="showSTLine" /> shadow-target(c2→c3)</label>
          <label><input type="checkbox" v-model="showPocketRay" /> 球洞射线(c4→c3)</label>
          <label><input type="checkbox" v-model="showCueRay" /> cue 射线</label>
          <label><input type="checkbox" v-model="showCorridor" /> 走廊</label>
          <label><input type="checkbox" v-model="showCrossGuides" /> 十字参考线</label>
          <label><input type="checkbox" v-model="showLengths" /> 长度标注</label>
          <label><input type="checkbox" v-model="showAngleCueHit" /> ∠(瞄准线,视线)</label>
          <label><input type="checkbox" v-model="showAngleHV" /> ∠(瞄准线,十字线)</label>
          <label><input type="checkbox" v-model="showPocketHitAngle" /> ∠(球洞线,视线)</label>
        </fieldset>

        <fieldset>
          <legend>角度标注偏移</legend>
          <label>
            水平/竖直角度 ×r
            <input type="range" min="0.5" max="16" step="0.1" v-model.number="hvOffsetMul" />
          </label>
          <label>
            倍数
            <input type="number" min="0.5" max="6" step="0.1" v-model.number="hvOffsetMul" />
          </label>
          <label>
            球洞射线角度 ×r
            <input type="range" min="1" max="10" step="0.1" v-model.number="pocketAngleDistance" />
          </label>
          <label>
            倍数
            <input type="number" min="1" max="10" step="0.1" v-model.number="pocketAngleDistance" />
          </label>
        </fieldset>

        <fieldset>
          <legend>视线生成逻辑</legend>
          <label>
            <input type="radio" value="center" v-model="hitLineMode" />
            母球圆心 → 目标球圆心
          </label>
          <label>
            <input type="radio" value="ghost" v-model="hitLineMode" />
            母球圆心 → 鬼球切点
          </label>
        </fieldset>

        <fieldset>
          <legend>关键信息，瞄准偏移</legend>
          <label>
            偏移长度
            <output>{{ bridgeLenCm }}</output>
          </label>
          <label>
            <input type="radio" value="tangent" v-model="bridgeMode" />
            切线（垂直视线）
          </label>
          <label>
            <input type="radio" value="horizontal" v-model="bridgeMode" />
            水平线（过{{ hitLineMode === 'center' ? '切点' : '鬼球切点' }}）
          </label>
          <label>
            <input type="radio" value="vertical" v-model="bridgeMode" />
            竖直线（过{{ hitLineMode === 'center' ? '切点' : '鬼球切点' }}）
          </label>
          <label v-if="hitLineMode === 'ghost'">
            <input type="radio" value="pocket_ray" v-model="bridgeMode" />
            球洞射线（鬼球切点沿球洞射线到瞄准线）
          </label>
        </fieldset>

        <fieldset>
          <legend>比例/尺寸</legend>
          <label>
            桌面缩放(px/cm)
            <input type="range" min="2" max="20" step="0.5" v-model.number="pxPerCm" />
          </label>
          <label>
            px/cm
            <input type="number" min="0.5" step="0.5" v-model.number="pxPerCm" />
          </label>

          <label>
            台球桌长度(cm)
            <input type="range" min="200" max="400" step="5" v-model.number="tableWcm" />
          </label>
          <label>
            长度(cm)
            <input type="number" min="200" max="400" step="5" v-model.number="tableWcm" />
          </label>

          <label>
            台球桌宽度(cm)
            <input type="range" min="100" max="200" step="5" v-model.number="tableHcm" />
          </label>
          <label>
            宽度(cm)
            <input type="number" min="100" max="200" step="5" v-model.number="tableHcm" />
          </label>

          <label>
            球直径(cm)
            <input type="range" min="4" max="8" step="0.2" v-model.number="ballDiameter" />
          </label>
          <label>
            直径(cm)
            <input type="number" min="4" max="8" step="0.1" v-model.number="ballDiameter" />
          </label>

          <label>
            口袋直径(cm)
            <input type="range" min="6" max="20" step="0.4" v-model.number="pocketDiameter" />
          </label>
          <label>
            直径(cm)
            <input type="number" min="6" max="20" step="0.2" v-model.number="pocketDiameter" />
          </label>

          <button type="button" class="btn" @click="resetAll">重置</button>
        </fieldset>

      </div>

      <p v-if="!solvable" class="warn">
        当前参数无解（c3 与 c4 重合或几何退化）。已隐藏 c2，可调整位置或半径以恢复。
      </p>
    </div>

    <div class="stage">
      <canvas ref="canvasRef" class="cvs"></canvas>
    </div>

    <div class="output-box">
      Offset = 
      <output>{{ bridgeLenCm }}</output>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 16px;
  padding: 16px;
  box-sizing: border-box;
  height: 100vh;
}
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}
.panel h2 {
  margin: 0 0 8px 0;
  font-size: 16px;
}
.hint {
  font-size: 12px;
  color: #6b7280;
  margin: 4px 0 8px 0;
}
.warn {
  color: #b91c1c;
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
fieldset {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px;
}
legend {
  padding: 0 6px;
  color: #374151;
}
label {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
  font-size: 12px;
  color: #374151;
}
input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}
.btn {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  cursor: pointer;
}
.btn:hover {
  background: #eef2ff;
}
.stage {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
  display: grid;
}
.cvs {
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
}
/* 新增样式 */
.mode-hint {
  font-size: 11px;
  color: #059669;
  margin: 4px 0 0 0;
  padding: 4px 6px;
  background: #ecfdf5;
  border-radius: 4px;
  border: 1px solid #d1fae5;
}

.selected {
  font-weight: bold;
  color: #dc2626;
}

select {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  font-size: 12px;
}

.output-box {
  position: fixed;
  bottom: 16px;
  right: 16px;
  font-size: 22px;
  color: #000000;
  font-weight: bold;
}

/* 响应式与滚动控制补充 */
.panel {
  overflow: auto;
}

@media (max-width: 768px) {
  .wrap {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    height: 100vh;
  }
  .panel {
    max-height: 40vh;
  }
  .stage {
    height: 60vh;
  }
  .cvs {
    height: 100%;
  }
}
</style>
<style>
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden; /* 禁用页面滚动 */
}
</style>
