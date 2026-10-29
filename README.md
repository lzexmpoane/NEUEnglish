# NEUEnglish — 技术设计文档 (Technical Design & Architecture Document)

**NEUEnglish** 是一款专为 **NEUer** 打造的现代化、轻量级纯前端学术英语背题工具。设计理念深度致敬 [NEUMathe](https://neumathe.cn/)。
本项目秉持极简主义，无任何第三方依赖（No Dependencies），完全基于原生 HTML5、CSS3 (Custom Properties, Flexbox, CSS Grid, Scroll-snap) 和 Vanilla JavaScript (ES6+) 构建。

> **核心哲学**：“不要把时间浪费在洋人身上，学完背完，就去享受生活，去做比刷题更重要的事。”

---

## 1. 目录结构 (File Structure)

项目采用四文件分离架构，无需构建工具即可直接运行。

```text
/
├── index.html      # SPA 骨架，包含 4 个主视图与 6 个全局覆盖层（Overlays）
├── style.css       # 全局样式与主题系统，包含所有动画与状态类
├── words.js        # 静态词库数据源（IIFE 或全局对象挂载）
└── app.js          # 核心业务逻辑、状态管理与视图渲染
```

---

## 2. 状态管理与本地存储 (State Management & Cookie)

应用的状态依赖 **浏览器 Cookie** 进行持久化。由于原生 `file://` 协议限制，需运行在 HTTP 服务器环境下（如 Live Server）。

### 2.1 版本控制机制 (Version Control)
为防止数据结构升级导致旧数据冲突，所有 Cookie 均以 `neu_v3_` 为前缀，并引入全局版本号 `APP_VERSION = 'v3.5'`。
```javascript
function checkVersion() {
    const storedVer = getCookie('version');
    if (storedVer !== APP_VERSION) {
        setCookie('version', APP_VERSION);
        // 强制重置核心学情数据，避免 JSON 解析崩溃
        setCookie('global_stats', '{}'); 
        setCookie('quiz_history', '[]'); 
    }
}
```

### 2.2 Cookie 数据字典 (Cookie Dictionary)

| Key (附带 `neu_v3_` 前缀) | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `version` | String | `'v3.5'` | 用于数据版本校验 |
| `username` | String | `'刷题人'` | 用户昵称 |
| `book` | String | `Object.keys(wordBank)[0]` | 当前选中的书本 |
| `unit` | String | `'__all__'` | 当前选中的单元 |
| `theme` | String | `'dark'` | `'dark'` 或 `'light'` |
| `global_stats` | JSON String | `'{}'` | 核心学情：`{ "书名_单元名": { correct: Number, total: Number, mastered: Array<String> } }` |
| `quiz_history` | JSON String | `'[]'` | 小测历史记录（最多保留10条）：`[ { date: Timestamp, rate: Number } ]` |

---

## 3. DOM 架构与路由 (DOM & Routing)

本项目为典型的单页应用 (SPA)，无前端路由库，依靠修改 CSS `display` 进行视图切换。

### 3.1 页面骨架
```html
<main id="mainContent">
    <!-- 4 个主视图，通过 .active 类名控制显隐 -->
    <div id="view-practice" class="view active">...</div>
    <div id="view-stats" class="view">...</div>
    <div id="view-vocab" class="view">...</div>
    <div id="view-user" class="view">...</div>
</main>
```

### 3.2 视图切换逻辑 (`switchTab`)
1. **底部导航联动**：更新 `.nav-item` 的 `.active` 状态。
2. **视图显隐**：遍历 `.view`，为目标 ID 添加 `.active`。
3. **动画重载**：使用 `void view.offsetHeight` 强制浏览器重排（Reflow），以重新触发子元素的 CSS 渐入动画 (`slideUpFade`)。
4. **按需渲染 (Lazy Render)**：
   - 切至 `view-stats` 时触发 `renderStatsPage()`。
   - 切至 `view-vocab` 时触发 `renderVocabPage()`。
   - 切至 `view-practice` 时，若存在未开始的会话，则调用 `startSession()` 初始化题目，否则恢复滑块滚动位置。

---

## 4. 核心模块：刷题逻辑 (Practice Module)

### 4.1 数据流与出题池 (`getPool`)
根据 `currentBook` 和 `currentUnit`，从 `wordBank` 中扁平化提取出一个一维数组：
`[ { en: "word", zh: "释义", pos: "n.", unit: "Unit 1..." }, ... ]`

### 4.2 题目结构 (`sessionItems`)
每次开始/重新开始刷题，会调用 `shuffle` 洗牌并生成会话数组：
```javascript
{
    en: "单词", zh: "释义", pos: "词性", unit: "所属单元",
    mode: "en2zh" | "zh2en", // 依据全局模式或 mixed 随机分配
    answered: false, // 是否已作答
    isCorrect: null, // 是否正确
    userInput: "",   // 填空题用户输入的值
    selectedOption: "", // 选择题用户选中的项
    showAnswerClicked: false // 是否点击了查看答案
}
```

### 4.3 原生滑块交互 (Scroll-Snap)
- 容器 `.slider-container` 使用 `scroll-snap-type: x mandatory`。
- 每个子项 `.slide` 占据 `flex: 0 0 100%; width: 100%; scroll-snap-align: start;`。
- 滑动监听：监听容器的 `scroll` 事件，使用 `setTimeout` 防抖 100ms，计算 `Math.round(scrollLeft / clientWidth)` 获取当前索引并更新 `currentIndex`。
- 锁定机制：当代码执行滑动（如点击上一题/下一题）时，给容器添加 `.no-smooth` 类以关闭 `scroll-behavior: smooth`，避免长距离滑动引发布局抖动。

### 4.4 答案校验 (Fuzzy Matching)
针对填空题（中译英），采用极度宽容的匹配策略。忽略大小写、空格、及所有非字母数字字符。
```javascript
function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
// e.g., "for short" === "For@Short" === "forshort"
```

### 4.5 状态响应 (UI Feedback)
- **答对**：为 `.card` 添加 `.is-correct`，卡片泛绿，禁止输入。
- **答错**：为 `.card` 添加 `.is-error`，卡片泛红，**不清空输入框**，显示重试提示（`.retry-hint`）。
- **查看答案**：点击后显示 `.answer-hint`，若用户继续输入则隐藏提示，不清除错误状态。
- **写入学情**：答对时，调用 `resolveCurrent(index, true, false)`，将单词 `en` 压入对应单元的 `mastered` 数组中（去重）。

---

## 5. 核心模块：单词小测 (Quiz Module)
小测是独立于刷题的**沉浸式覆盖层 (Overlay)**，与刷题的“边做边看对错”不同，小测是**盲答机制**。

### 5.1 启动配置 (`openQuizSetup`)
- 弹出 `.modal-overlay`。用户可配置模式、题量、倒计时（默认 15 秒/题）。
- 点击开始，生成独立的 `sessionItems`（数量截取题量配置），并渲染至 `#quizTrack`。

### 5.2 倒计时与自动交卷 (`startQuiz`)
- 使用 `setInterval` 每秒递减 `quizTimeLeft`。
- 当 `quizTimeLeft <= 10` 时，添加 `.warning` 类（CSS 呼吸灯效果）。
- 当 `quizTimeLeft === 0` 时，清空定时器，强制调用 `submitQuiz()`。

### 5.3 交互模式（无即时反馈）
- 用户点击选项或填写答案后，**不判断对错**，仅添加高亮类 `.q-selected` 或保留输入。
- 延迟 250ms 后，自动调用 `scrollToSlide` 滑向下一题。
- 若为最后一题，弹出 Toast 提示“请点击底部交卷”。

### 5.4 交卷结算与折线图生成 (`submitQuiz`)
1. **遍历核算**：遍历所有题目，对比 `selectedOption/userInput` 与正确答案，计算 `stats` 并更新 `global_stats`。
2. **历史记录**：将本次正确率（rate）Push 到 `quizHistory`，限制最大长度为 10，存入 Cookie。
3. **SVG 折线图渲染**：
   - 使用 JS 动态拼接字符串生成 `<svg>`。
   - 坐标系映射：`x = padX + (idx / max) * (w - 2 * padX)`，`y = h - padY - (rate / 100) * (h - 2 * padY)`。
   - 绘制折线 (`<polyline>`) 和 数据点 (`<circle>`)，使用 `<linearGradient>` 实现渐变线条。
4. **结果页展示**：展示正确率、趋势图、错题列表（展示错误答案与正确答案）。
5. 点击“返回学情”，销毁 Overlay，刷新学情视图。

---

## 6. 学情面板 (Stats Module)
学情面板分为三块：
1. **本组回顾**：基于 `sessionItems.filter(i => i.answered)` 计算当前这一轮的实时正确率。
2. **历次小测趋势**：调用 `generateTrendChartSVG(quizHistory)` 重现折线图。
3. **各单元进度**：
   - 读取 `global_stats[key].mastered.length`。
   - 读取 `wordBank[currentBook][unit]` 的总词数。
   - 计算进度百分比，渲染进度条。

---

## 7. UI/UX 设计规范 (UI & Animation)

### 7.1 主题系统 (Theme)
基于 CSS 自定义属性 (CSS Variables) 控制。
- 默认挂载 `:root` 上的变量为暗黑模式。
- 给 `<body>` 添加 `.light-theme` 类，覆盖所有颜色变量（如背景色、面板色、文字主副色），实现一键切换。

### 7.2 动画机制 (Animations)
- **渐入交错**：`.view.active > *` 使用 `animation-delay` 结合 `nth-child`（0.0s, 0.06s, 0.12s...），产生元素逐个上浮的效果。
- **面板展开防跳顶**：设置页面的面板展开不使用 `max-height`，而是使用 `transform: translateY(-8px)` 到 `0` 结合 `opacity`，避免引发容器高度变化导致的页面滚回顶部（Scroll Jump）问题。
- **滑块容器隔离**：`.slider-track` 使用 `align-items: stretch`，保证同一次会话中的卡片高度与操作按钮在视觉上绝对齐平。

### 7.3 响应式与防溢 (Responsive & Overflow)
- 使用 `clamp()` 控制字体大小，保证在不同移动设备上的可读性。
- 小测页面（`#quizSliderContainer .slide`）设置 `overflow-y: auto`，防止长选项内容挤压底部的“上一题/下一题”按钮。
- 按钮布局 `.modal-actions` 强制使用 `flex: 1; width: 50%; min-width: 0;`，确保在极窄屏幕下“取消”与“确定”不会发生挤压或变形。

### 7.4 Favicon 实现
`<head>` 中未引用外部图标文件，而是通过 `<link rel="icon" href="data:image/svg+xml,...">` 直接嵌入经 URL 编码的、与页面大 Logo 完全一致的渐变色 SVG 图形。

---

## 8. 部署与运行 (Deployment)
1. 在任意目录下放置上述 4 个文件。
2. 启动本地静态服务器（如 VS Code Live Server 或 `python -m http.server 8080`）。
3. 通过浏览器访问 `http://localhost:8080`，即可获得完整的 PWA 级单页应用体验。
