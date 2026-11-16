/**
 * UI language support. Chinese source strings act as translation keys, so the
 * default (zh) output is byte-identical to the original literals. English
 * lookups fall back to the Chinese source when a key is missing.
 */

const LANG_STORAGE_KEY = 'boardforge.lang.v1';

const EN = {
  '3D 预览不可用': '3D preview unavailable',
  '3D 预览无法启动': '3D preview cannot start',
  '6 块': '6 panels',
  '6 块面板': '6 panels',
  '6 面板 · {n} 条提醒': '6 panels · {n} warnings',
  '6 面板 · 榫卯互锁': '6 panels · interlocking joints',
  '<b>右键</b> 平移': '<b>Right-drag</b> pan',
  '<b>拖动</b> 旋转': '<b>Drag</b> rotate',
  '<b>滚轮</b> 缩放': '<b>Scroll</b> zoom',
  'BoardForge · 开发板亚克力外壳生成器': 'BoardForge · Acrylic Case Generator for Dev Boards',
  'BoardForge — 根据开发板尺寸和安装孔，生成六面板亚克力榫卯外壳，导出 DXF/SVG 切割文件与 3D 装配预览。':
    'BoardForge — generate a six-panel acrylic case with interlocking joints from your dev board dimensions and mounting holes, with DXF/SVG cut files and a 3D assembly preview.',
  'BoardForge 亚克力外壳五金清单': 'BoardForge acrylic case hardware list',
  'CSG 结果未通过水密校验（{edges} 条边界边），已改用直接建模。':
    'CSG result failed the watertight check ({edges} boundary edges); switched to direct modeling.',
  'DXF 分层：CUT 切割 / ANNOTATION 标注 · kerf 由激光软件补偿':
    'DXF layers: CUT for cutting / ANNOTATION for labels · kerf compensated by laser software',
  'DXF 切割文件已导出': 'DXF cut file exported',
  'DXF 导出失败': 'DXF export failed',
  'SVG 切割图已导出': 'SVG cut drawing exported',
  'SVG 导出失败': 'SVG export failed',
  'WebGL 上下文已丢失，请刷新页面恢复 3D 预览。': 'WebGL context lost. Refresh the page to restore the 3D preview.',
  'WebGL 不可用': 'WebGL unavailable',
  'enclosure 字段格式无效，已使用默认外壳参数。': 'Invalid enclosure field; default case settings were used.',
  'openings 字段格式无效，已忽略。': 'Invalid openings field; cutouts were ignored.',
  '{board} · {holes} 孔 · {openings} 开孔': '{board} · {holes} holes · {openings} cutouts',
  '{count} 组 {spec} 六角固定柱 · {screws} 颗 {spec} 螺丝': '{count} sets of {spec} hex standoffs · {screws} {spec} screws',
  '{count} 组六角固定柱': '{count} sets of hex standoffs',
  '{detail} mm · 外壳参数已重置': '{detail} mm · case settings reset',
  '{label}不能大于 {max} mm。': '{label} cannot exceed {max} mm.',
  '{label}不能小于 {min} mm。': '{label} cannot be below {min} mm.',
  '{label}主题': '{label} theme',
  '{label}必须是有效数字。': '{label} must be a valid number.',
  '{l} × {w} × {t} mm · {holes} 孔 · {openings} 开孔 · {ow} × {od} × {oh} mm':
    '{l} × {w} × {t} mm · {holes} holes · {openings} cutouts · {ow} × {od} × {oh} mm',
  '{l} × {w} × {t} mm · {n} 孔': '{l} × {w} × {t} mm · {n} holes',
  '{name} · {l} × {w} mm 板子': '{name} · {l} × {w} mm board',
  '{name} 外壳': '{name} Case',
  '{n} 个互相重叠的孔在直接建模中未能保留。': '{n} overlapping holes could not be kept in direct modeling.',
  '{n} 个板孔超出板边，未生成固定柱。': '{n} board holes are outside the board outline; no standoffs were generated.',
  '{n} 个（建议）': '{n} pcs (suggested)',
  '{n} 块面板 · CUT 图层 · 单位 mm': '{n} panels · CUT layer · units mm',
  '{n} 块面板 · 单位 mm': '{n} panels · units mm',
  '{n} 条通风槽': '{n} vent slots',
  '{panel}开孔平面图': '{panel} cutout plan',
  '{panel}还没有开孔': 'No cutouts on the {panel} yet',
  '{spec} 上六角固定柱（内外螺纹）': '{spec} upper hex standoff (male-female)',
  '{spec} 上六角固定柱（内外螺纹）：{count} × {len} mm': '{spec} upper hex standoff (male-female): {count} × {len} mm',
  '{spec} 下六角固定柱（双内螺纹）': '{spec} lower hex standoff (female-female)',
  '{spec} 下六角固定柱（双内螺纹）：{count} × {len} mm': '{spec} lower hex standoff (female-female): {count} × {len} mm',
  '{spec} 平垫圈': '{spec} flat washer',
  '{spec} 平垫圈：{n} 个（建议）': '{spec} flat washers: {n} pcs (suggested)',
  '{spec} 标准过孔': '{spec} clearance hole',
  '{spec} 标准过孔 {clearance} mm；{n} 组固定柱穿过开发板孔位，上下锁紧顶板与底板。':
    '{spec} standard clearance hole {clearance} mm; {n} standoff sets pass through the board holes and clamp the top and bottom panels.',
  '{spec} 顶/底面板螺丝': '{spec} top/bottom panel screws',
  '{spec} 顶/底面板螺丝：{count} × {min}–{max} mm': '{spec} top/bottom panel screws: {count} × {min}–{max} mm',
  '{t} mm · {n} 组固定柱': '{t} mm · {n} standoff sets',
  '{t} mm 亚克力板': '{t} mm acrylic sheet',
  '「{name}」已加入项目库。': '"{name}" was added to the project library.',
  '三维预览': '3D preview',
  '下柱从底板拧入，上柱的螺纹穿过开发板孔与下柱对锁；顶/底各一颗 {spec} 面板螺丝。{spec} 采用 {clearance} mm 标准过孔，螺丝长度按固定柱螺纹深度和面板厚度微调。':
    'The lower standoff screws into the bottom panel; the upper standoff thread passes through the board hole and locks into the lower one; one {spec} panel screw each on top and bottom. {spec} uses a {clearance} mm standard clearance hole; screw length is tuned to standoff thread depth and panel thickness.',
  '与 3D 工具栏的投影按钮保持同步。': 'Stays in sync with the projection button in the 3D toolbar.',
  '主题色': 'Accent color',
  '主题色预设': 'Accent color presets',
  '五金清单': 'Hardware list',
  '五金清单已复制': 'Hardware list copied',
  '五金规格': 'Hardware size',
  '五金规格：{spec}，标准过孔 {clearance} mm': 'Hardware: {spec}, standard clearance hole {clearance} mm',
  '亚克力板：6 块 × {t} mm': 'Acrylic sheets: 6 panels × {t} mm',
  '仅本机': 'This device only',
  '从模板新建': 'New from template',
  '以下都是本机界面偏好，不会改动外壳参数，也不写入导出的文件。':
    'These are local UI preferences only. They never change case parameters or exported files.',
  '会替换当前编辑': 'Replaces the current draft',
  '位置相对当前侧板中心<br /><b>U</b> 水平向右 · <b>V</b> 垂直向上':
    'Position relative to the panel centre<br /><b>U</b> horizontal right · <b>V</b> vertical up',
  '低配设备': 'Low-end devices',
  '侧板平面': 'Side panel plan',
  '侧板开孔平面编辑区': 'Side panel cutout editing area',
  '侧板选择': 'Side panel selection',
  '侧视': 'Side',
  '侧视方向': 'Side view direction',
  '保存': 'Save',
  '保存当前项目': 'Save current project',
  '保存当前项目到本机项目库': 'Save the current project to the local library',
  '全部恢复默认': 'Reset all to defaults',
  '六面板榫卯 · 3 mm 亚克力 · M3 五金': 'Six interlocking panels · 3 mm acrylic · M3 hardware',
  '关闭切割排版预览': 'Close cut layout preview',
  '关闭后刷新页面不会恢复当前项目；已保存到项目库的项目不受影响':
    'When off, refreshing the page will not restore the current project; saved library projects are unaffected',
  '关闭后按 1x 像素比渲染，高分屏上明显降负载': 'When off, renders at 1x pixel ratio, greatly reducing load on high-DPI screens',
  '关闭后跳过阴影贴图渲染，低配置设备帧率更稳': 'When off, skips shadow map rendering for steadier frame rates on low-end devices',
  '关闭设置': 'Close settings',
  '关闭项目切换提示': 'Close project switch dialog',
  '关闭项目库': 'Close project library',
  '内腔': 'Inner cavity',
  '内腔 {w} × {d} × {h} mm · 6 块 {t} mm 亚克力': 'Cavity {w} × {d} × {h} mm · 6 panels of {t} mm acrylic',
  '内腔净高': 'Inner clear height',
  '准备就绪': 'Ready',
  '切割排版预览': 'Cut layout preview',
  '切割排版预览失败': 'Cut layout preview failed',
  '切换到正交投影': 'Switch to orthographic projection',
  '切换到透视投影': 'Switch to perspective projection',
  '删除': 'Delete',
  '删除安装孔': 'Delete mounting hole',
  '删除开孔': 'Delete cutout',
  '删除第 {n} 个安装孔': 'Delete mounting hole {n}',
  '删除第 {n} 个开孔': 'Delete cutout {n}',
  '前视': 'Front',
  '前面板': 'Front panel',
  '单位 mm': 'Units mm',
  '参数': 'Parameters',
  '参数导出失败': 'Parameter export failed',
  '参数已导入，已自动修正部分字段': 'Parameters imported; some fields were auto-corrected',
  '参数待修正 · 当前显示上次结果': 'Parameters need fixing · showing last result',
  '参数文件已导出': 'Parameter file exported',
  '参数文件应小于 2 MB。': 'Parameter files must be smaller than 2 MB.',
  '参数文件的根节点必须是一个 JSON 对象。': 'The parameter file root must be a JSON object.',
  '取消': 'Cancel',
  '只改变界面强调色，不改变板子或亚克力颜色。': 'Only changes the UI accent color, not the board or acrylic color.',
  '可以添加常用接口预设或自定义开孔': 'Add a common connector preset or a custom cutout',
  '可导出 DXF / SVG': 'DXF / SVG ready',
  '可导出 · {n} 条提醒': 'Exportable · {n} warnings',
  '可直接粘贴到采购或装配记录。': 'Paste directly into purchasing or assembly notes.',
  '右视': 'Right',
  '右面板': 'Right panel',
  '后视': 'Back',
  '后面板': 'Back panel',
  '固定柱和面板螺丝规格': 'Standoff and panel screw size',
  '固定柱过孔已归一到标准 {spec} 规格（{clearance} mm）。': 'Standoff clearance hole normalized to standard {spec} ({clearance} mm).',
  '圆形': 'Circle',
  '圆角半径': 'Corner radius',
  '圆角半径已限制在 0–{max} mm。': 'Corner radius clamped to 0–{max} mm.',
  '在上下盖板中央生成等距圆角槽': 'Generates evenly spaced rounded slots in the centre of the top and bottom panels',
  '复制五金清单': 'Copy hardware list',
  '复制失败': 'Copy failed',
  '外壳 3D 装配预览': 'Case 3D assembly preview',
  '外壳参数': 'Case settings',
  '外壳参数已导入': 'Case parameters imported',
  '外壳名称': 'Case name',
  '外壳外形': 'Case outer size',
  '外壳尚未更新完成': 'Case model is still updating',
  '外壳尺寸较小，顶部/底部榫舌数量不足，建议增加外壳尺寸。':
    'The case is small; too few top/bottom tabs. Consider increasing the case size.',
  '外壳生成失败': 'Case build failed',
  '外壳生成失败 · 请检查参数': 'Case build failed · check parameters',
  '外壳：{w} × {d} × {h} mm': 'Case: {w} × {d} × {h} mm',
  '外观': 'Appearance',
  '它可能已经被删除。': 'It may have been deleted.',
  '安装孔': 'Mounting holes',
  '安装孔 / 开孔': 'Mounting holes / cutouts',
  '安装孔数量超过 {max} 个，仅保留前 {max} 个。': 'More than {max} mounting holes; only the first {max} were kept.',
  '完成': 'Done',
  '宽': 'W',
  '导入': 'Import',
  '导入参数文件': 'Import parameter file',
  '导出': 'Export',
  '导出 SVG': 'Export SVG',
  '导出六块面板的 SVG 切割预览': 'Export an SVG cut preview of the six panels',
  '导出切割 DXF': 'Export cut DXF',
  '导出可再次编辑的外壳参数文件': 'Export an editable case parameter file',
  '导出并打开': 'Export & open',
  '导出并新建': 'Export & new',
  '导出并载入': 'Export & load',
  '导出激光切割用 DXF，含 CUT 切割层与 ANNOTATION 标注层': 'Export a laser-cut DXF with CUT and ANNOTATION layers',
  '展开六块面板': 'Explode the six panels',
  '左视': 'Left',
  '左面板': 'Left panel',
  '已从本机项目库移除。': 'Removed from the local project library.',
  '已保存到项目库': 'Saved to library',
  '已关联项目库': 'Linked to library',
  '已新建默认外壳': 'New default case created',
  '已载入 {label}': 'Loaded {label}',
  '布尔运算失败，已改用直接建模：{error}': 'Boolean operation failed; switched to direct modeling: {error}',
  '常用开发板预设': 'Common dev board presets',
  '常用接口': 'Common connectors',
  '底板': 'Bottom panel',
  '建议扩孔后使用标准五金。': 'Enlarge the holes before using standard hardware.',
  '建议扩孔，或改用 {spec} 五金。': 'Enlarge the holes, or switch to {spec} hardware.',
  '开发板': 'Dev board',
  '开发板亚克力外壳生成器': 'Acrylic case generator for dev boards',
  '开发板参数已导入': 'Board parameters imported',
  '开发板固定柱过孔：{clearance} mm': 'Board standoff clearance holes: {clearance} mm',
  '开发板最小板孔为 {min} mm，{spec} 标准过孔为 {clearance} mm。':
    'The smallest board hole is {min} mm; the {spec} standard clearance hole is {clearance} mm.',
  '开发板没有安装孔，外壳不包含板子固定柱。': 'The board has no mounting holes; the case will not include board standoffs.',
  '开发板没有安装孔，无法生成一体固定柱和顶/底面板螺丝。':
    'The board has no mounting holes, so integrated standoffs and top/bottom panel screws cannot be generated.',
  '开发板没有有效安装孔，无法生成一体固定柱和顶/底螺丝。':
    'The board has no valid mounting holes, so integrated standoffs and top/bottom screws cannot be generated.',
  '开孔': 'cutout',
  '开孔数量超过 {max} 个，仅保留前 {max} 个。': 'More than {max} cutouts; only the first {max} were kept.',
  '当前{view}，选择其他侧视方向': 'Currently {view}; choose another side view',
  '当前浏览器不支持 WebGL。': 'This browser does not support WebGL.',
  '当前编辑': 'Current draft',
  '当前编辑仍保留为草稿，可继续保存。': 'The current draft is kept and can still be saved.',
  '当前项目': 'Current project',
  '性能': 'Performance',
  '我的项目': 'My projects',
  '打开': 'Open',
  '打开「{name}」？': 'Open "{name}"?',
  '打开或新建项目': 'Open or create a project',
  '打开项目会替换当前项目「{name}」的板子、孔位、开孔和外壳参数。':
    'Opening a project replaces the board, holes, cutouts and case settings of the current project "{name}".',
  '打开项目库': 'Open project library',
  '投影方式': 'Projection',
  '拖动开孔调整位置': 'Drag cutouts to reposition',
  '排版尺寸': 'Sheet size',
  '排版预览': 'Layout preview',
  '文件单位“{units}”不受支持，已按毫米读取。': 'Unsupported file units "{units}"; read as millimetres.',
  '文件版本 {version} 高于当前支持的版本 {supported}，已按兼容模式读取。':
    'File version {version} is newer than supported version {supported}; read in compatibility mode.',
  '文件缺少 board 字段，已使用默认板子尺寸。': 'The file has no board field; default board dimensions were used.',
  '文件缺少 holes 字段，已生成四角安装孔。': 'The file has no holes field; four corner mounting holes were generated.',
  '文件过大': 'File too large',
  '新建会替换当前项目「{name}」的所有参数。': 'Creating a new project replaces all parameters of the current project "{name}".',
  '新建空白项目': 'New blank project',
  '新建项目？': 'New project?',
  '无法创建 WebGL 上下文。': 'Could not create a WebGL context.',
  '无法导入参数文件': 'Could not import the parameter file',
  '暂无可用固定柱': 'No usable standoffs',
  '最多保存 {max} 个项目。': 'At most {max} projects can be saved.',
  '有参数待修正': 'parameters need fixing',
  '有效固定柱少于 3 组，外壳固定可能不稳定。': 'Fewer than 3 valid standoff sets; the case may not be held securely.',
  '未命名开发板': 'Untitled Board',
  '未命名开发板外壳': 'Untitled Board Case',
  '未知板尺寸': 'Unknown board size',
  '本地自动保存只保留当前项目。导出后可随时通过「导入参数」继续编辑。':
    'Local autosave keeps only the current project. Export it and use "Import" anytime to continue editing.',
  '条': 'slots',
  '松手导入参数文件': 'Drop to import the parameter file',
  '板子厚度': 'Board thickness',
  '板子厚度已限制在 {min}–{max} mm。': 'Board thickness clamped to {min}–{max} mm.',
  '板子宽度': 'Board width',
  '板子宽度已限制在 {min}–{max} mm。': 'Board width clamped to {min}–{max} mm.',
  '板子长度': 'Board length',
  '板子长度已限制在 {min}–{max} mm。': 'Board length clamped to {min}–{max} mm.',
  '板子颜色': 'Board color',
  '板孔最小 {min} mm，小于 {spec} 的 {clearance} mm 标准过孔；':
    'The smallest board hole is {min} mm, below the {clearance} mm standard clearance hole for {spec}; ',
  '板孔用于生成底部固定柱和底板过孔。': 'Board holes generate the lower standoffs and bottom-panel clearance holes.',
  '板材 / 五金': 'Panels / hardware',
  '榫卯配合间隙': 'Joint fit gap',
  '槽宽': 'Slot width',
  '槽长': 'Slot length',
  '模型未通过水密校验，导出前请检查孔径与板边。': 'The model failed the watertight check; review hole sizes and board edges before exporting.',
  '正交': 'Ortho',
  '正在初始化 3D 预览': 'Initializing 3D preview',
  '正在更新…': 'Updating…',
  '正在生成六面板外壳': 'Building the six-panel case',
  '正在生成外壳…': 'Building case…',
  '正在计算…': 'Computing…',
  '没有可用的开发板安装孔，无法生成固定柱；请修正板孔位置。':
    'No usable board mounting holes; standoffs cannot be generated. Fix the hole positions.',
  '浅色': 'Light',
  '浏览器未授予剪贴板权限。': 'The browser has not granted clipboard permission.',
  '浏览器本地存储空间不足或被禁用。': 'Local storage is full or disabled in this browser.',
  '深浅色': 'Theme mode',
  '深色': 'Dark',
  '深色 · 默认主题色 · 透视投影 · 自动保存、阴影与高清渲染开启':
    'Dark · default accent · perspective · autosave, shadows and HiDPI on',
  '添加板子安装孔': 'Add a board mounting hole',
  '添加自定义开孔': 'Add a custom cutout',
  '添加预设': 'Add preset',
  '激光切割': 'Laser cutting',
  '爆炸': 'Explode',
  '生成失败': 'Build failed',
  '生成耗时': 'Build time',
  '界面与预览': 'UI & preview',
  '界面与预览设置': 'UI and preview settings',
  '留空时不会生成板子固定柱': 'Leave empty to skip board standoffs',
  '直接打开': 'Open anyway',
  '直接新建': 'Create anyway',
  '直接载入': 'Load anyway',
  '矩形': 'Rectangle',
  '确认删除': 'Confirm delete',
  '立体': '3D',
  '第 {a} 与第 {b} 个孔重叠，打印时会合并为一个开孔。': 'Holes {a} and {b} overlap and will merge into one cutout when printed.',
  '第 {n} 个孔的 X 坐标': 'X coordinate of hole {n}',
  '第 {n} 个孔的 X 坐标，单位毫米': 'X coordinate of hole {n}, in millimetres',
  '第 {n} 个孔的 Y 坐标': 'Y coordinate of hole {n}',
  '第 {n} 个孔的 Y 坐标，单位毫米': 'Y coordinate of hole {n}, in millimetres',
  '第 {n} 个孔的尺寸无效，已跳过。': 'Hole {n} has invalid dimensions and was skipped.',
  '第 {n} 个孔的直径': 'Diameter of hole {n}',
  '第 {n} 个孔的直径，单位毫米': 'Diameter of hole {n}, in millimetres',
  '第 {n} 个孔超出了板边（含 0.05 mm 安全余量），已跳过。': 'Hole {n} extends past the board edge (0.05 mm safety margin) and was skipped.',
  '第 {n} 个安装孔格式无效，已忽略。': 'Mounting hole {n} has an invalid format and was ignored.',
  '第 {n} 个开孔 · U {u} · V {v}': 'Cutout {n} · U {u} · V {v}',
  '第 {n} 个开孔与第 {other} 个开孔重叠，已跳过。': 'Cutout {n} overlaps cutout {other} and was skipped.',
  '第 {n} 个开孔形状': 'Shape of cutout {n}',
  '第 {n} 个开孔所在侧板无效，已跳过。': 'Cutout {n} targets an invalid side panel and was skipped.',
  '第 {n} 个开孔所在面板': 'Panel of cutout {n}',
  '第 {n} 个开孔格式无效，已忽略。': 'Cutout {n} has an invalid format and was ignored.',
  '第 {n} 个开孔的垂直位置': 'Vertical position of cutout {n}',
  '第 {n} 个开孔的宽度': 'Width of cutout {n}',
  '第 {n} 个开孔的水平位置': 'Horizontal position of cutout {n}',
  '第 {n} 个开孔的直径': 'Diameter of cutout {n}',
  '第 {n} 个开孔的高度': 'Height of cutout {n}',
  '第 {n} 个开孔超出{panel}可加工区域，已跳过。': 'Cutout {n} exceeds the usable area of the {panel} and was skipped.',
  '第 {n} 个板孔与第 {other} 个板孔 距离过近，固定柱已跳过。': 'Board hole {n} is too close to board hole {other}; the standoff was skipped.',
  '第 {n} 条通风槽与固定孔冲突，已跳过。': 'Vent slot {n} conflicts with a mounting hole and was skipped.',
  '等待外壳生成': 'Waiting for case build',
  '继续当前项目': 'Continue current project',
  '缺少有效板孔，无法生成一体固定柱。也可以在板子参考中增加安装孔。':
    'No valid board holes, so integrated standoffs cannot be generated. You can add mounting holes in the board reference.',
  '自动保存草稿': 'Autosave draft',
  '自定义颜色': 'Custom color',
  '草稿': 'Draft',
  '草稿未保存': 'Draft not saved',
  '虚线内为可加工区域': 'The dashed outline marks the usable area',
  '视角': 'View',
  '设置': 'Settings',
  '设置已恢复默认': 'Settings restored to defaults',
  '语言': 'Language',
  '请修正高亮参数': 'Fix highlighted parameters',
  '请先修正参数': 'Fix parameters first',
  '请扩孔后再使用标准五金。': 'Enlarge the holes before using standard hardware.',
  '请扩孔，或改用 {spec}（{clearance} mm 过孔）。': 'enlarge the holes, or switch to {spec} ({clearance} mm clearance hole).',
  '请稍等片刻再导出。': 'Wait a moment before exporting.',
  '载入 {label} 尺寸': 'Load {label} dimensions',
  '载入「{label}」？': 'Load "{label}"?',
  '载入预设会替换当前项目「{name}」的板子、孔位、开孔和外壳参数。':
    'Loading a preset replaces the board, holes, cutouts and case settings of the current project "{name}".',
  '过孔': 'clearance',
  '还没有保存的项目。点击「保存」把当前编辑加入项目库。': 'No saved projects yet. Click "Save" to add the current draft to the library.',
  '还没有安装孔': 'No mounting holes yet',
  '这个 JSON 不包含开发板或外壳参数，无法导入。': 'This JSON contains no board or case parameters and cannot be imported.',
  '这个孔超出板边，无法用于固定柱。': 'This hole is outside the board edge and cannot hold a standoff.',
  '选择侧视方向': 'Choose a side view',
  '选择常用接口预设': 'Choose a connector preset',
  '选择板子参考颜色': 'Choose the board reference color',
  '选择自定义主题色': 'Choose a custom accent color',
  '透视': 'Persp',
  '通风关闭': 'vents off',
  '通风槽数量已从 {from} 减少为 {to}，以适配面板尺寸。': 'Vent slot count reduced from {from} to {to} to fit the panel size.',
  '通风槽长度过大，无法放入顶板/底板。': 'Vent slots are too long to fit in the top/bottom panels.',
  '部分外壳参数超出允许范围，已自动限制。': 'Some case parameters were out of range and have been clamped.',
  '阴影效果': 'Shadows',
  '顶板': 'Top panel',
  '顶板 / 底板通风槽': 'Top / bottom vent slots',
  '顶视': 'Top',
  '项目': 'Projects',
  '项目不存在': 'Project not found',
  '项目切换': 'Project switch',
  '项目已保存': 'Project saved',
  '项目已删除': 'Project deleted',
  '项目已打开': 'Project opened',
  '项目已打开，部分字段已修正': 'Project opened; some fields were corrected',
  '项目库保存失败': 'Could not save the project library',
  '项目库有未保存修改': 'Unsaved library changes',
  '项目数量已满': 'Project library is full',
  '项目无法打开': 'Project cannot be opened',
  '预览六块面板的切割排版': 'Preview the cut layout of the six panels',
  '预览静止时不再持续重绘，交互或动画时才出帧。': 'Stops continuous redraws while idle; frames render only during interaction or animation.',
  '高': 'H',
  '高亮字段的数值无效或超出范围。': 'Highlighted fields are invalid or out of range.',
  '高清渲染': 'HiDPI rendering',
  '<span class="step">01</span> 外壳尺寸': '<span class="step">01</span> Case size',
  '板厚 <em>T</em>': 'Panel <em>T</em>',
  '板边间隙 <em>C</em>': 'Clearance <em>C</em>',
  '底部净空 <em>B</em>': 'Bottom gap <em>B</em>',
  '顶部净空 <em>H</em>': 'Top gap <em>H</em>',
  '<span class="step">02</span> 固定散热': '<span class="step">02</span> Mounting & vents',
  '槽数量 <em>N</em>': 'Slots <em>N</em>',
  '<span class="step">03</span> 接口开孔': '<span class="step">03</span> Connector cutouts',
  '<span class="step">04</span> 板型参考': '<span class="step">04</span> Board reference',
  '长度 <em>X</em>': 'Length <em>X</em>',
  '宽度 <em>Y</em>': 'Width <em>Y</em>',
  '厚度 <em>Z</em>': 'Thickness <em>Z</em>',
  '圆角 <em>R</em>': 'Radius <em>R</em>',
  '<span class="live-dot"></span> 装配预览': '<span class="live-dot"></span> Assembly preview',
  '自动保存已关闭': 'Autosave off',
  '草稿自动保存': 'Draft autosave',
  '正在保存草稿…': 'Saving draft…',
  '草稿已保存': 'Draft saved',
  '无法访问本地存储': 'Local storage unavailable',
  '前': 'F',
  '后': 'B',
  '左': 'L',
  '右': 'R',
  'RJ45 网口': 'RJ45 jack',
  'DC 5.5 电源孔': 'DC 5.5 power',
  '3.5 mm 音频孔': '3.5 mm audio',
  '树莓派 4B': 'Raspberry Pi 4B',
  '树莓派 Zero': 'Raspberry Pi Zero',
  'ESP32 DevKit': 'ESP32 DevKit',
  '青柠绿': 'Lime',
  '薄荷青': 'Mint',
  '冰川蓝': 'Sky',
  '电子蓝': 'Indigo',
  '星云紫': 'Violet',
  '琥珀金': 'Amber',
  '珊瑚橙': 'Coral',
};

let currentLang = readStoredLanguage();
const listeners = new Set();

function readStoredLanguage() {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

export function getLanguage() {
  return currentLang;
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(value) {
  const lang = value === 'en' ? 'en' : 'zh';
  if (lang === currentLang) return lang;
  currentLang = lang;
  try {
    if (lang === 'zh') localStorage.removeItem(LANG_STORAGE_KEY);
    else localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // The in-memory language still works without storage.
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  applyStaticTranslations();
  for (const listener of listeners) listener(lang);
  return lang;
}

export function t(source, vars) {
  const template = currentLang === 'en' ? EN[source] || source : source;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : match,
  );
}

export function applyStaticTranslations(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll('[data-i18n-html]')) {
    element.innerHTML = t(element.dataset.i18nHtml);
  }
  for (const element of root.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
  }
  for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }
  for (const element of root.querySelectorAll('[data-i18n-content]')) {
    element.setAttribute('content', t(element.dataset.i18nContent));
  }
}

export function initializeLanguage() {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  applyStaticTranslations();
}