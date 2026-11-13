# BoardForge 外壳参数文件格式（`.case.json`）

BoardForge 使用 UTF-8 纯文本 JSON 保存外壳参数。文件不包含三角面数据，3D 模型和 DXF/SVG 切割路径都由参数实时重新生成。

## 坐标约定

- 开发板平面原点在板子中心；
- X 轴向右，Y 轴向前；
- Z 轴为高度方向；
- 外壳以外壳中心为对称中心，开发板位于内腔中心；
- 所有尺寸单位为毫米。

侧板开孔使用**面板局部坐标**：

- 每个侧板有自己的中心原点；
- `u` 为水平方向，`v` 为垂直方向；
- 对前/后面板，`u` 对应外壳的 X 方向；
- 对左/右面板，`u` 对应外壳的 Y 方向；
- 左/右面板和后面板会在装配时镜像，但导出的参数仍使用面板自身视角的 `u/v`。

## 顶层结构

```json
{
  "version": 2,
  "format": "boardforge-case",
  "name": "Raspberry Pi 4B 外壳",
  "units": "mm",
  "board": {
    "length": 85,
    "width": 56,
    "thickness": 1.6,
    "corner_radius": 3,
    "color": "#1a5f2a"
  },
  "holes": [
    { "x": -39, "y": -24.5, "diameter": 2.7 }
  ],
  "enclosure": {
    "panel_thickness": 3,
    "clearance": 2,
    "bottom_gap": 6,
    "top_gap": 16,
    "screw_clearance": 2.9,
    "fit": 0.15,
    "vent": {
      "enabled": true,
      "count": 5,
      "slot_width": 2.4,
      "slot_length": 28
    }
  },
  "openings": [
    {
      "side": "front",
      "shape": "rect",
      "u": -15,
      "v": 0,
      "width": 16,
      "height": 9
    },
    {
      "side": "left",
      "shape": "circle",
      "u": 0,
      "v": 0,
      "diameter": 12
    }
  ],
  "meta": {
    "created": "2026-11-12T09:00:00+08:00",
    "updated": "2026-11-12T09:00:00+08:00"
  }
}
```

## 字段说明

### 顶层

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 当前外壳格式版本为 `2` |
| `format` | string | 固定为 `boardforge-case` |
| `name` | string | 外壳名称，最长 80 字符 |
| `units` | string | 仅支持 `mm` |
| `board` | object | 开发板参考尺寸 |
| `holes` | array | 开发板安装孔，最多 32 个 |
| `enclosure` | object | 亚克力板和固定结构参数 |
| `openings` | array | 侧板开孔，最多 32 个 |
| `meta` | object | 创建/更新时间 |

### 开发板参考

| 字段 | 默认值 | 范围 |
| --- | ---: | --- |
| `board.length` | 85 mm | 10–500 |
| `board.width` | 56 mm | 10–500 |
| `board.thickness` | 1.6 mm | 0.2–50 |
| `board.corner_radius` | 3 mm | 0–短边的一半 |
| `board.color` | `#1a5f2a` | `#rrggbb` |
| `holes[].x` | 0 | -500–500 |
| `holes[].y` | 0 | -500–500 |
| `holes[].diameter` | 2.7 mm | 0.1–100 |

板子颜色只影响 3D 参考模型，不会进入切割文件。

### 外壳

| 字段 | 默认值 | 范围 | 说明 |
| --- | ---: | --- | --- |
| `panel_thickness` | 3 mm | 1–10 | 亚克力板厚度 |
| `clearance` | 2 mm | 1–60 | 板边到内壁的间隙；默认紧凑贴合 |
| `bottom_gap` | 6 mm | 0–100 | 底板到板底面的下固定柱长度 |
| `top_gap` | 16 mm | 2–180 | 板顶面到顶板内侧的上固定柱长度 |
| `screw_clearance` | 3.4 mm | 2.4 / 2.9 / 3.4 / 4.5 | 标准公制五金过孔：M2 / M2.5 / M3 / M4 |
| `fit` | 0.15 mm | 0–0.8 | 榫舌/榫槽配合间隙 |
| `vent.enabled` | true | boolean | 是否生成通风槽 |
| `vent.count` | 5 | 1–14 | 槽数量 |
| `vent.slot_width` | 2.4 mm | 0.6–12 | 槽宽 |
| `vent.slot_length` | 28 mm | 4–260 | 槽长 |

尺寸推导：

```text
innerWidth  = board.length + 2 × clearance
innerDepth  = board.width  + 2 × clearance
innerHeight = bottom_gap + board.thickness + top_gap
wallWidth   = innerWidth  + 2 × panel_thickness
wallDepth   = innerDepth  + 2 × panel_thickness
outerWidth  = wallWidth   + 2 × 3 mm 顶/底外沿
outerDepth  = wallDepth   + 2 × 3 mm 顶/底外沿
outerHeight = innerHeight + 2 × panel_thickness
```

顶板和底板每边比侧板外轮廓大 3 mm，用来形成封闭槽四周的压边；侧板外轮廓仍由 `wallWidth` / `wallDepth` 决定。

### 一体固定柱

每个有效板孔都会生成一组上下固定柱：

- 下柱从底板上表面延伸到开发板底面，长度等于 `bottom_gap`；
- 上柱从开发板顶面延伸到顶板内表面，长度等于 `top_gap`；
- 顶板和底板在相同 X/Y 位置开 `screw_clearance` 过孔；
- 上下各一颗螺丝把顶板、板子、底板锁成同一组结构。

因此，`holes[].diameter` 必须能容纳实际螺丝/螺柱。若板孔明显小于 `screw_clearance`，界面会提示扩孔或改用更小的标准规格。没有有效板孔时不会生成固定柱，并会给出警告。

导入的 `screw_clearance` 如果不是上述标准值，会被归一到最接近的 M2 / M2.5 / M3 / M4 过孔，并产生一条警告。导出时始终写入标准化后的数值。

### 侧板开孔

| 字段 | 说明 |
| --- | --- |
| `side` | `front` / `back` / `left` / `right` |
| `shape` | `rect` / `circle` |
| `u` | 水平中心，相对侧板中心 |
| `v` | 垂直中心，相对侧板中心 |
| `width` / `height` | 矩形宽高，仅 `rect` |
| `diameter` | 圆孔直径，仅 `circle` |

开孔需位于侧板可加工区域。越界开孔会被跳过并产生警告，不会阻断整个外壳生成。

## 旧版 `.board.json` 兼容

导入只有 `board` / `holes` 的旧版 `.board.json` 时：

- 保留板子尺寸和孔位；
- 自动补充默认外壳参数（3 mm 板材、2 mm 板边间隙、6 mm 底部净空、16 mm 顶部净空）；
- 自动补充空的 `openings` 数组；
- 导出时升级为 `.case.json` version 2。

## 文件名

默认：

- 参数：`board-case-<外壳宽>x<外壳深>x<外壳高>.case.json`
- DXF：`...-cut.dxf`
- SVG：`...-cut.svg`

如果设置了外壳名称，则使用名称代替 `board-case`。

## 说明

- UI 主题色、深色/浅色模式、透视/正交投影方式以及草稿自动保存开关属于浏览器偏好，保存在 `localStorage`，不属于外壳参数文件。
- 多项目库也属于浏览器本地数据：项目列表在 `boardforge.projects.v1`，当前活动项目在 `boardforge.active-project.v1`；`.case.json` 才是可移植、可备份的项目文件。
- DXF/SVG 使用毫米单位，未包含激光 kerf 补偿。
- DXF 为 ASCII R12：`CUT` 图层是闭合切割路径，`ANNOTATION` 图层是标题、幅面和零件尺寸标注；导出后可在激光软件中关闭标注层。
