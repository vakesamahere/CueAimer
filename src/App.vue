<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watchEffect } from 'vue'
import { Window, Layer } from '@/utils/window'
import { Circle, Line } from '@/utils/Shapes'

type P = { x: number; y: number }

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let rafId = 0

// 两层：线在底层，圆在上层
const lineLayer = new Layer()
const circleLayer = new Layer()

// 真实尺寸（近似常见 9 尺桌，单位 cm）
const tableWcm = 254
const tableHcm = 127
const cushionMarginCm = 3.5 // 胶边内缩
const pocketRadiusCm = 6.0  // 近似袋口半径
const ballRadiusCm = 2.86   // 球半径（57.15mm 直径）

// 全局比例：每厘米多少像素（用于把长度转为 cm）
const pxPerCm = ref(6.0) // 默认 6 px/cm

// 变量：主半径 r（用于 r1 与 r2），目标球半径 r3 单独赋值设为 r（保留未来解耦空间）
const r = ref(ballRadiusCm) // cm
// 口袋半径（cm）可调
const pocketRcm = ref(pocketRadiusCm)

// 4 个圆：1=母球，2=母球击中目标球时的“虚影”，3=目标球，4=球洞
const rPxInit = r.value * pxPerCm.value
const c1 = new Circle(100, 100, rPxInit, { strokeStyle: '#111827', fillStyle: '#ffffff', lineWidth: 2 }) // 母球：实心白
const c2 = new Circle(220, 120, rPxInit, { strokeStyle: '#334155', lineWidth: 2, dashed: [6, 6] }) // 虚影：仅描边虚线
const c3 = new Circle(180, 220, rPxInit, { strokeStyle: '#111827', fillStyle: '#f59e0b', lineWidth: 2 }) // 目标球：实心黄
const c4 = new Circle(360, 80, pocketRadiusCm * pxPerCm.value, { fillStyle: '#111827', strokeStyle: '#111827', lineWidth: 1 }) // 洞（实心深色）

// 线段：c3->c4（目标球朝洞）、c1->c2（发射线）、c1->c3（母球到目标球）、c2->c3（虚影到目标球）
const aimLine = new Line(c3, c4, { strokeStyle: '#94a3b8', lineWidth: 1 })
const cueLine = new Line(c1, c2, { strokeStyle: '#60a5fa', lineWidth: 1, dashed: [4, 4] })
const hitLine = new Line(c1, c3, { strokeStyle: '#22c55e', lineWidth: 1 })
const stLine = new Line(c2, c3, { strokeStyle: '#a78bfa', lineWidth: 1, dashed: [4, 4] }) // shadow-target

// 显示开关
const showCueLine = ref(true)
const showHitLine = ref(true)
const showAimLine = ref(true)
const showSTLine = ref(true)
const showCueRay = ref(true)
const showCrossGuides = ref(true)
const showCorridor = ref(true)
const showAngleCueHit = ref(true)
const showAngleHV = ref(true)
const showLengths = ref(true)
const hvOffsetMul = ref(6) // 与水平/竖直角度标注距交点的倍数（×球半径）

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
  const idealW = tableWcm * pxPerCm.value
  const idealH = tableHcm * pxPerCm.value
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
    { x: cx,    y: top },    // 上中
    { x: right, y: top },    // 右上
    { x: left,  y: cy },     // 左中
    { x: right, y: cy },     // 右中
    { x: left,  y: bottom }, // 左下
    { x: cx,    y: bottom }, // 下中
    { x: right, y: bottom }, // 右下
  ]

  // 同步 c4 半径为口袋半径
  c4.radius = prPx

  // 根据默认或已选洞同步 c4
  const p = pockets.value[selectedPocket.value] ?? pockets.value[0]
  if (p) c4.moveTo(p.x, p.y)
}

// ========== 约束计算 ==========
function recomputeC2() {
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
  resizeCanvas()
  recomputeC2()
})

// 口袋半径改变时，重算像素半径并刷新
watchEffect(() => {
  void pocketRcm.value
  resizeCanvas()
  recomputeC2()
})

// 控制线段显示
watchEffect(() => {
  cueLine.config.visible = showCueLine.value
  hitLine.config.visible = showHitLine.value
  aimLine.config.visible = showAimLine.value
  stLine.config.visible = showSTLine.value
})

// ========== 鼠标交互：拖动 c1、c3；点击选择洞 ==========
type Dragging = 'c1' | 'c3' | null
let dragging: Dragging = null

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
    return
  }
  const p = getPointerWorld(e)
  const s1 = win.toScreen(c1.position)
  const s3 = win.toScreen(c3.position)
  const d1 = Math.hypot(p.x - s1.x, p.y - s1.y)
  const d3 = Math.hypot(p.x - s3.x, p.y - s3.y)
  const within1 = d1 <= c1.radius + 6
  const within3 = d3 <= c3.radius + 6
  if (within1 && within3) dragging = 'c1'
  else if (within1) dragging = 'c1'
  else if (within3) dragging = 'c3'
  else dragging = null
}

function onMouseMove(e: MouseEvent) {
  if (!dragging) return
  const p = getPointerWorld(e)
  if (dragging === 'c1') c1.moveTo(p.x, p.y)
  else if (dragging === 'c3') c3.moveTo(p.x, p.y)
  recomputeC2()
}

function onMouseUp()   { dragging = null }
function onMouseLeave(){ dragging = null }

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

  const l12 = lengthCm(s1, s2).cm.toFixed(1) + ' cm'
  const l13 = lengthCm(s1, s3).cm.toFixed(1) + ' cm'
  const l34 = lengthCm(s3, s4).cm.toFixed(1) + ' cm'
  const m12 = mid(s1, s2)
  const m13 = mid(s1, s3)
  const m34 = mid(s3, s4)

  if (showCueLine.value) drawTextLabel(l12, m12.x, m12.y - 12)
  if (showHitLine.value) drawTextLabel(l13, m13.x, m13.y - 12)
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
  const vHit = { x: c3.position.x - p.x, y: c3.position.y - p.y }
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

// 目标球切线桥：在绿线与目标球的交点处，沿切线（垂直绿线）向蓝色虚线作垂线段，并标注长度
function drawTangentBridge() {
  if (!ctx) return
  if (!c2.config.visible || !showCueLine.value || !showHitLine.value) return

  const p1 = { x: c1.position.x, y: c1.position.y } // 母球
  const p2 = { x: c2.position.x, y: c2.position.y } // 虚影
  const p3 = { x: c3.position.x, y: c3.position.y } // 目标球

  // 绿线方向（c1 -> c3）
  const vHit = { x: p3.x - p1.x, y: p3.y - p1.y }
  const Lh = Math.hypot(vHit.x, vHit.y)
  if (!(Lh > 1e-6)) return
  const uh = { x: vHit.x / Lh, y: vHit.y / Lh }

  // 绿线与目标球的交点（靠近 c1 的切点）
  const contact = { x: p3.x - uh.x * c3.radius, y: p3.y - uh.y * c3.radius }

  // 蓝色虚线方向（c1 -> c2）
  const vCue = { x: p2.x - p1.x, y: p2.y - p1.y }
  const Lc = Math.hypot(vCue.x, vCue.y)
  if (!(Lc > 1e-6)) return
  const uc = { x: vCue.x / Lc, y: vCue.y / Lc }

  // 切线（垂直绿线）
  const n = { x: -uh.y, y: uh.x }
  const cross2 = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx
  const denom = cross2(n.x, n.y, uc.x, uc.y)
  if (Math.abs(denom) <= 1e-8) return // 平行，跳过

  // 交点：contact + n*t 与 c1 + uc*s 的交点
  const diff = { x: p1.x - contact.x, y: p1.y - contact.y }
  const t = cross2(diff.x, diff.y, uc.x, uc.y) / denom
  const inter = { x: contact.x + n.x * t, y: contact.y + n.y * t }

  // 绘制与标注
  const sA = win.toScreen(contact)
  const sB = win.toScreen(inter)

  ctx.save()
  ctx.strokeStyle = '#06b6d4'
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(sA.x, sA.y)
  ctx.lineTo(sB.x, sB.y)
  ctx.stroke()
  ctx.restore()

  const l = lengthCm(sA, sB).cm.toFixed(1) + ' cm'
  const m = mid(sA, sB)
  drawTextLabel(l, m.x, m.y - 12)
}

function drawOverlays() {
  if (!ctx) return
  // 过母球的水平/竖直虚线
  drawCrossGuides()
  // 走廊
  if (c2.config.visible) drawCorridor()
  // 发射射线
  drawCueRay()
  // 目标球切线桥
  drawTangentBridge()
  // 长度与角度标注
  drawLengthLabels()
  drawCueHitAngleAtC1()
  drawAnglesHV()
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
        鼠标：拖动母球(c1)/目标球(c3)；点击 8 个洞选择目标洞(c4)。
      </p>

      <div class="grid">
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
            球半径 r(cm)
            <input type="range" min="1" max="4" step="0.1" v-model.number="r" />
          </label>
          <label>
            r(cm)
            <input type="number" min="1" step="0.1" v-model.number="r" />
          </label>

          <label>
            口袋半径(cm)
            <input type="range" min="3" max="10" step="0.2" v-model.number="pocketRcm" />
          </label>
          <label>
            口袋半径(cm)
            <input type="number" min="3" max="10" step="0.1" v-model.number="pocketRcm" />
          </label>

          <button type="button" class="btn" @click="resetAll">重置</button>
        </fieldset>

        <fieldset>
          <legend>母球 c1</legend>
          <label>
            x
            <input type="number" v-model.number="c1.position.x" />
          </label>
          <label>
            y
            <input type="number" v-model.number="c1.position.y" />
          </label>
        </fieldset>

        <fieldset>
          <legend>目标球 c3</legend>
          <label>
            x
            <input type="number" v-model.number="c3.position.x" />
          </label>
          <label>
            y
            <input type="number" v-model.number="c3.position.y" />
          </label>
        </fieldset>

        <fieldset>
          <legend>显示开关（线段/标注）</legend>
          <label><input type="checkbox" v-model="showCueLine" /> cue(c1→c2)</label>
          <label><input type="checkbox" v-model="showHitLine" /> hit(c1→c3)</label>
          <label><input type="checkbox" v-model="showAimLine" /> aim(c3→c4)</label>
          <label><input type="checkbox" v-model="showSTLine" /> shadow-target(c2→c3)</label>
          <label><input type="checkbox" v-model="showCueRay" /> cue 射线</label>
          <label><input type="checkbox" v-model="showCorridor" /> 走廊</label>
          <label><input type="checkbox" v-model="showCrossGuides" /> 十字参考线</label>
          <label><input type="checkbox" v-model="showLengths" /> 长度标注</label>
          <label><input type="checkbox" v-model="showAngleCueHit" /> ∠(cue,hit)</label>
          <label><input type="checkbox" v-model="showAngleHV" /> 与水平/竖直角度</label>
        </fieldset>

        <fieldset>
          <legend>角度标注偏移</legend>
          <label>
            ×r
            <input type="range" min="0.5" max="16" step="0.1" v-model.number="hvOffsetMul" />
          </label>
          <label>
            倍数
            <input type="number" min="0.5" max="6" step="0.1" v-model.number="hvOffsetMul" />
          </label>
        </fieldset>
      </div>

      <p v-if="!solvable" class="warn">
        当前参数无解（c3 与 c4 重合或几何退化）。已隐藏 c2，可调整位置或半径以恢复。
      </p>
    </div>

    <div class="stage">
      <canvas ref="canvasRef" class="cvs"></canvas>
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
  grid-template-columns: 1fr 1fr;
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
</style>
