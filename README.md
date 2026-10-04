# CSS 作者规则层叠与继承来源解释后端

离线 CSS 样式计算服务：输入简化元素树、有序作者规则及可选行内声明，输出每个元素
每个受支持属性的最终值与来源链。仅计算对象形式的规则，**不解析完整 CSS 源码**，
不做布局、动画或渲染。纯 TypeScript + Node.js + SQLite（`node:sqlite`），
Windows 本地运行，无 Docker / WSL / 外部服务依赖。

## 支持范围

- **属性**：`color`、`font-size`、`text-align`（可继承）；`display`、`opacity`（不继承）。
  初始值分别为 `#000000`、`16px`、`left`、`inline`、`1`。
- **选择器**：仅单个复合选择器 —— 可选标签或 `*`、最多一个 `#id`、任意个 `.class`。
  明确拒绝：后代/子代等组合器、属性选择器、伪类、选择器列表（逗号）、层叠层。
- **层叠**：普通作者声明 < 行内普通声明 < 样式表 important < 行内 important。
  同级内按特异性元组 `(id数, class数, 标签数)` 字典序比较（不拼接整数，无进位混淆），
  再按出现顺序。每个被淘汰的候选都会记录失败原因：`importance` / `specificity` / `order`。
- **继承**：与层叠完全分离。父元素的 important 不会压过子元素自己的普通声明；
  只有子元素无候选或显式 `inherit`/`unset` 时才取父元素计算值。
- **全局关键字**：`inherit`（父计算值，根取初始值）、`initial`（初始值）、
  `unset`（可继承属性等同 inherit，否则等同 initial）。
- 其他值按已通过校验的字面值保存，不计算相对长度、`var()` 等。
- 空声明列表、空规则列表均为合法输入，仍返回全部 5 个属性的结果。

## 快速开始

```bat
npm install
npm run build     :: 编译 TypeScript 到 dist/
npm test          :: 构建并运行全部测试（node:test）
npm start         :: 启动 API 服务（默认自动选择空闲端口）
npm run demo      :: 运行内置演示（important/顺序/行内/继承四个场景）
```

要求 Node.js >= 22.5（使用内置 `node:sqlite`，会有 ExperimentalWarning，属正常）。

## CLI

```bat
node dist\cli.js serve [--port 8123]   :: 启动 API（PORT 环境变量亦可；缺省选空闲端口）
node dist\cli.js compute examples\sample.json   :: 计算并保存报告，终端打印最终值与来源
node dist\cli.js list                  :: 历史报告
node dist\cli.js explain 1 2 color     :: 解释报告1中元素2的color来源链
node dist\cli.js compare 1 2           :: 比较两个报告版本
node dist\cli.js export 1              :: JSON 导出
node dist\cli.js demo                  :: 内置演示
```

数据保存在项目内 `data\cssc.db`，冻结了元素树、规则顺序、行内声明与算法版本；
重启后旧报告仍可解释。任何输入变化都会产生新报告，旧报告不可变。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/reports` | 提交 `{elements, rules}`，校验+计算+落库，返回完整结果 |
| GET | `/api/reports` | 历史报告列表 |
| GET | `/api/reports/:id` | 报告结果 |
| GET | `/api/reports/:id/explain?element=2&property=color` | 单属性来源链与候选淘汰记录 |
| GET | `/api/reports/compare?a=1&b=2` | 两版本按元素/属性的差异 |
| GET | `/api/reports/:id/export` | 完整 JSON 导出（含冻结输入） |

### 输入格式

```json
{
  "elements": [
    { "id": 1, "tag": "div", "parent": null, "classes": ["root"] },
    { "id": 2, "tag": "p", "parent": 1, "idAttr": "x",
      "inline": [{ "property": "color", "value": "purple", "important": false }] }
  ],
  "rules": [
    { "selector": ".root",
      "declarations": [{ "property": "color", "value": "green", "important": true }] }
  ]
}
```

## 错误码

`VALIDATION`（结构非法）、`DUPLICATE_NODE`（重复元素 id）、`BAD_PARENT`（父引用不存在）、
`CYCLE`（父链成环）、`BAD_SELECTOR`（不支持的选择器）、`UNKNOWN_PROPERTY`（未知属性）、
`EMPTY_VALUE`（空值）、`BAD_IMPORTANT`（important 非布尔）、`LIMIT_EXCEEDED`（规模超限：
元素 1000 / 规则 500 / 单规则声明 100）、`NOT_FOUND`、`BAD_REQUEST`。

校验与计算全部成功后才写入 SQLite；一次失败不会留下部分元素集合。

## 限制

- 不解析 CSS 源码、不支持 `@media` / 层叠层 / 伪类 / 组合器 / 选择器列表。
- 不计算相对单位、`var()`、动画与继承链以外的任何布局行为。
- `node:sqlite` 目前为 Node 实验特性，API 在未来 Node 版本中可能调整。
