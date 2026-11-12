# BoardForge 参数文件格式（`.board.json`）

BoardForge 的参数文件是 UTF-8 纯文本 JSON。它包含完整可编辑状态，不包含模型三角面数据；3D 模型总是由参数重新生成。

`.board.json` 只描述板子本身。界面主题色和深色/浅色模式属于浏览器本地偏好，分别保存在 `localStorage` 的 `boardforge.theme.v1` 和 `boardforge.mode.v1` 中，不会写入参数文件；板子颜色仍由 `board.color` 控制。

## 坐标约定

- 原点：板子平面的中心；
- **+X**：向右；
- **+Y**：向前（从正上方俯视时向上）；
- **Z**：板厚方向，几何在 Z 方向居中，范围约为 `-thickness/2` 到 `+thickness/2`；
- 所有尺寸单位：毫米（mm）。

安装孔坐标写在 `holes` 数组里，表示孔的**中心点**；`diameter` 是孔直径，不是半径。

## 顶层结构

```json
{
  "version": 1,
  "name": "未命名开发板",
  "units": "mm",
  "board": {
    "length": 85.0,
    "width": 56.0,
    "thickness": 1.6,
    "corner_radius": 3.0,
    "color": "#1a5f2a"
  },
  "holes": [
    { "x": -39.0, "y": -24.5, "diameter": 2.7 }
  ],
  "meta": {
    "created": "2026-11-12T09:00:00+08:00",
    "updated": "2026-11-12T09:00:00+08:00"
  }
}
```

| 字段 | 类型 | 说明 | 缺失时 |
| --- | --- | --- | --- |
| `version` | number | 格式版本，目前为 `1` | 按 `1` 读取 |
| `name` | string | 开发板名称，最长 80 字符 | `未命名开发板` |
| `units` | string | 当前仅支持 `mm` | 按 `mm` 读取 |
| `board` | object | 板子基础尺寸 | 使用默认板子 |
| `holes` | array | 安装孔数组，最多 32 个 | 自动生成四角孔 |
| `meta` | object | 创建/更新时间 | 当前时间 |
| `board.length` | number | X 方向长度，10–500 mm | `85` |
| `board.width` | number | Y 方向宽度，10–500 mm | `56` |
| `board.thickness` | number | Z 方向厚度，0.2–50 mm | `1.6` |
| `board.corner_radius` | number | 四角圆角半径，0–短边的一半 | `3`（自动限制） |
| `board.color` | string | `#rrggbb` 颜色 | `#1a5f2a` |
| `holes[].x` | number | 孔中心的 X 坐标，-500–500 mm | `0` |
| `holes[].y` | number | 孔中心的 Y 坐标，-500–500 mm | `0` |
| `holes[].diameter` | number | 孔径，0.1–100 mm | `2.7` |

## 导入兼容规则

导入时不会因为单个字段异常而直接崩溃：

1. 数字字段缺失或不是有效数字时使用默认值；
2. 超出范围的值会被限制到允许范围内，并给出提示；
3. 圆角半径会自动限制到 `min(length, width) / 2` 以内；
4. 非对象类型的孔项会被忽略；
5. 孔数量超过 32 个时只保留前 32 个；
6. 更高 `version` 的文件仍尝试按 version 1 读取，并提示兼容模式；
7. 未知字段会被忽略，不会报错。

如果文件根节点不是对象，或者既没有 `board` 也没有 `holes`，导入会被拒绝并提示文件类型不正确。

## 几何与可打印性

- 板子轮廓为圆角矩形；`corner_radius = 0` 表示直角；
- 安装孔必须完整落在板子轮廓内（保留 0.05 mm 安全边距），否则该孔会被跳过；
- 互相重叠的孔是合法输入，CSG 模型会把它们合并成一个开孔；
- 导出的 STL 只包含通过水密性检查的当前模型；
- STL 没有内嵌单位，坐标直接以毫米写入，切片软件导入时需保持默认的毫米单位。

## 文件名

导出时自动生成：

- 参数文件：`<名称或 board>-<长度>x<宽度>.board.json`
- STL：`<名称或 board>-<长度>x<宽度>.stl`

例如默认参数：

```text
board-85x56.board.json
board-85x56.stl
```

名称中的文件系统非法字符会替换为 `-`，空白会替换为 `_`。

## 示例

见：

- `samples/raspberry-pi-4b.board.json`
- `samples/sensor-node-60x40.board.json`
