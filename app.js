// ============================================================
// NEUEnglish — v3.5 核心逻辑 (加入多次小测趋势图与 Cookie 加固)
// ============================================================

const APP_VERSION = 'v3.5';
const COOKIE_PREFIX = 'neu_v3_';

// ----- 安全 Cookie 工具 -----
function setCookie(name, value, days = 30) {
    try {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${COOKIE_PREFIX}${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
    } catch(e) { console.warn("Cookie 写入失败", e); }
}

function getCookie(name) {
    try {
        const nameEQ = COOKIE_PREFIX + name + "=";
        const ca = document.cookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
    } catch(e) { console.warn("Cookie 读取失败", e); }
    return null;
}

function getJSONCookie(name, fallback) {
    try {
        const val = getCookie(name);
        return val ? JSON.parse(val) : fallback;
    } catch(e) { return fallback; }
}

function setJSONCookie(name, obj) {
    setCookie(name, JSON.stringify(obj));
}

function checkVersion() {
    const storedVer = getCookie('version');
    if (storedVer !== APP_VERSION) {
        setCookie('version', APP_VERSION);
        // 版本更迭时，可以在这里重置或迁移特定数据
        setCookie('global_stats', '{}');
        setCookie('quiz_history', '[]'); 
    }
}

// ----- 自定义弹窗系统 -----
let confirmCallback = null;
function showToast(msg) {
    document.getElementById("customAlertText").textContent = msg;
    document.getElementById("customAlertModal").hidden = false;
}
function closeCustomAlert() {
    document.getElementById("customAlertModal").hidden = true;
}
function showConfirm(msg, cb) {
    document.getElementById("customConfirmText").textContent = msg;
    document.getElementById("customConfirmModal").hidden = false;
    confirmCallback = cb;
}
function closeCustomConfirm(result) {
    document.getElementById("customConfirmModal").hidden = true;
    if (confirmCallback) {
        confirmCallback(result);
        confirmCallback = null;
    }
}

// ----- 状态初始化 (从 Cookie 读取) -----
let username = getCookie('username') || '刷题人';
let currentBook = getCookie('book') || Object.keys(wordBank)[0];
let currentUnit = getCookie('unit') || "__all__";
let isLightTheme = getCookie('theme') === 'light';
let globalStats = getJSONCookie('global_stats', {});
let quizHistory = getJSONCookie('quiz_history', []); // [{date, rate}]

let currentMode = "en2zh";
let sessionItems = [];
let currentIndex = 0;
let sessionTotal = 0;
let stats = { correct: 0, total: 0 };

let isQuizMode = false;
let quizTimerInterval = null;
let quizTimeLeft = 0;

// ----- 工具 -----
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
function normalize(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function formatTime(s) { 
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// ----- 范围获取 -----
function getUnitsOfBook(book) { return wordBank[book] ? Object.keys(wordBank[book]) : []; }

function populateBookSelect() {
    const sel = document.getElementById("bookSelect");
    sel.innerHTML = "";
    Object.keys(wordBank).forEach(b => {
        const opt = document.createElement("option");
        opt.value = b; opt.textContent = b; sel.appendChild(opt);
    });
    sel.value = currentBook;
}

function populateUnitSelect() {
    const sel = document.getElementById("unitSelect");
    sel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "__all__"; allOpt.textContent = "全部单元"; sel.appendChild(allOpt);
    getUnitsOfBook(currentBook).forEach(u => {
        const opt = document.createElement("option");
        opt.value = u; opt.textContent = u; sel.appendChild(opt);
    });
    sel.value = currentUnit;
}

function getPool() {
    const book = wordBank[currentBook];
    if (!book) return [];
    const units = currentUnit === "__all__" ? Object.keys(book) : [currentUnit];
    const pool = [];
    units.forEach(u => Object.entries(book[u] || {}).forEach(([en, data]) => {
        pool.push({ en, zh: data.zh, pos: data.pos, unit: u });
    }));
    return pool;
}

function getAllMeanings() {
    const set = new Set();
    Object.values(wordBank).forEach(book => Object.values(book).forEach(unit => Object.values(unit).forEach(data => set.add(data.zh))));
    return Array.from(set);
}

function updateStats() {
    const el = document.getElementById("stats");
    if (!el) return;
    if (sessionTotal === 0) { el.textContent = ""; return; }
    const done = sessionItems.filter(i => i.answered).length;
    el.textContent = `进度 ${done} / ${sessionTotal} · 答对 ${stats.correct}`;
}

function updateLabels() {
    const label = `当前题库：${currentBook} · ${currentUnit === "__all__" ? "全部单元" : currentUnit}`;
    const el1 = document.getElementById("currentBookLabel");
    const el2 = document.getElementById("statsBookLabel");
    if (el1) el1.textContent = label;
    if (el2) el2.textContent = `当前学情：${currentBook}`;
}

// ============================================================
// 绘图工具：生成折线图
// ============================================================
function generateTrendChartSVG(history) {
    if (history.length === 0) {
        return `<p style="color:var(--text-muted); font-size:0.9rem; text-align:center; padding:20px 0;">暂无小测记录，快去测一下吧！</p>`;
    }

    const w = 320, h = 120, padX = 30, padY = 20;
    const maxSteps = history.length;
    
    const polylinePoints = history.map((p, idx) => {
        const x = padX + (idx / Math.max(1, maxSteps - 1)) * (w - 2 * padX);
        const y = h - padY - (p.rate / 100) * (h - 2 * padY);
        return `${x},${y}`;
    }).join(' ');

    const circles = history.map((p, idx) => {
        const x = padX + (idx / Math.max(1, maxSteps - 1)) * (w - 2 * padX);
        const y = h - padY - (p.rate / 100) * (h - 2 * padY);
        return `<circle cx="${x}" cy="${y}" r="3" fill="#a583ff" />
                <text x="${x}" y="${y-8}" fill="var(--text-primary)" font-size="10" text-anchor="middle">${p.rate}%</text>`;
    }).join('');

    return `
        <div id="trendChartContainer">
            <svg viewBox="0 0 ${w} ${h}">
                <line x1="${padX}" y1="${h-padY}" x2="${w-padX}" y2="${h-padY}" stroke="var(--border-hairline)" stroke-width="1"/>
                <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${h-padY}" stroke="var(--border-hairline)" stroke-width="1"/>
                
                <text x="${padX-5}" y="${padY+4}" fill="var(--text-muted)" font-size="10" text-anchor="end">100%</text>
                <text x="${padX-5}" y="${h-padY}" fill="var(--text-muted)" font-size="10" text-anchor="end">0%</text>
                
                <polyline points="${polylinePoints}" fill="none" stroke="url(#chart-grad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                ${circles}
                <defs>
                    <linearGradient id="chart-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stop-color="#6fa4ff"/>
                        <stop offset="100%" stop-color="#d79aff"/>
                    </linearGradient>
                </defs>
            </svg>
        </div>
    `;
}

// ============================================================
// 导航与页面切换
// ============================================================
function switchTab(targetId) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.target === targetId));
    document.querySelectorAll('.view').forEach(view => {
        const isTarget = view.id === targetId;
        view.classList.toggle('active', isTarget);
        
        if (isTarget) {
            void view.offsetHeight;
            if (targetId === 'view-stats') renderStatsPage();
            else if (targetId === 'view-vocab') renderVocabPage();
            else if (targetId === 'view-practice') {
                updateLabels();
                if (sessionItems.length === 0) startSession();
                else {
                    setTimeout(() => {
                        const slider = document.getElementById("sliderContainer");
                        const width = slider.clientWidth;
                        if (width > 0) {
                            slider.classList.add("no-smooth");
                            slider.scrollLeft = currentIndex * width;
                            setTimeout(() => slider.classList.remove("no-smooth"), 50);
                        }
                    }, 10);
                }
            }
        }
    });
}

// ============================================================
// 页面渲染
// ============================================================
function renderVocabPage() {
    const pool = getPool();
    const viewArea = document.getElementById("viewArea");
    viewArea.innerHTML = "";
    if (pool.length === 0) { viewArea.innerHTML = "<p style='text-align:center; padding:20px;'>没有单词</p>"; return; }

    pool.sort((a, b) => a.en.localeCompare(b.en));
    const list = document.createElement("div");
    list.className = "vocab-list";
    pool.forEach(item => {
        const div = document.createElement("div");
        div.className = "vocab-item";
        div.innerHTML = `<span class="vocab-word">${item.en}</span><span class="vocab-pos">${item.pos}</span><span class="vocab-zh">${item.zh}</span>`;
        list.appendChild(div);
    });
    viewArea.appendChild(list);
}

function renderStatsPage() {
    // 1. 渲染本组回顾
    const card = document.getElementById("summaryCard");
    const answeredItems = sessionItems.filter(i => i.answered);
    
    if (answeredItems.length === 0) {
        card.innerHTML = `<div class="summary-empty">暂无本组记录</div>`;
    } else {
        const total = answeredItems.length;
        const correct = answeredItems.filter(i => i.isCorrect).length;
        const rate = Math.round((correct / total) * 100);
        card.innerHTML = `
            <h3 class="summary-title">本组回顾</h3>
            <div class="summary-rate-wrap"><span class="summary-rate">${rate}%</span><span class="summary-sub">正确率</span></div>
            <p class="summary-count">答对 <strong>${correct}</strong> / ${total}</p>
        `;
    }

    // 2. 渲染历次趋势图
    const trendContainer = document.getElementById("trendChartContainer");
    trendContainer.innerHTML = generateTrendChartSVG(quizHistory);

    // 3. 渲染各单元累计学情
    const globalList = document.getElementById("globalStatsList");
    globalList.innerHTML = "";
    getUnitsOfBook(currentBook).forEach(u => {
        const key = `${currentBook}_${u}`;
        const data = globalStats[key] || { correct: 0, total: 0, mastered: [] };
        const unitWords = wordBank[currentBook][u] || {};
        const totalWords = Object.keys(unitWords).length;
        const masteredCount = data.mastered ? data.mastered.length : 0;
        const progress = totalWords === 0 ? 0 : Math.round((masteredCount / totalWords) * 100);
        
        const item = document.createElement("div");
        item.className = "unit-stat-item";
        item.innerHTML = `
            <div class="unit-stat-header">
                <span>${u}</span>
                <span class="unit-stat-count">已掌握 ${masteredCount} / ${totalWords} 词 · 正确率 ${data.total === 0 ? 0 : Math.round((data.correct / data.total) * 100)}%</span>
            </div>
            <div class="stat-bar-bg"><div class="stat-bar-fill" style="width: ${progress}%"></div></div>
        `;
        globalList.appendChild(item);
    });
}

// ============================================================
// DOM 生成
// ============================================================
function createSlideHtml(item, i, isQuiz = false) {
    const prefix = isQuiz ? 'q-' : '';
    const cardClass = item.answered && !isQuiz ? (item.isCorrect ? "is-correct" : "is-error") : "";
    const text = item.mode === "en2zh" ? item.en : item.zh;
    const isLong = text.length > 14 ? "true" : "false";
    
    let html = `
        <div class="card ${cardClass}" id="${prefix}card-${i}">
            <p class="Meaning" id="${prefix}Meaning-${i}" data-long="${isLong}">${text}</p>
            <span class="pos-tag" id="${prefix}posTag-${i}">${item.pos}</span>
        </div>
    `;

    if (item.mode === "en2zh") {
        html += `<div class="options-grid" id="${prefix}options-${i}">`;
        const choices = buildChoices(item.zh);
        choices.forEach(opt => {
            let btnClass = "option-btn";
            let disabled = "";
            if (isQuiz) {
                if (item.selectedOption === opt) btnClass += " q-selected";
            } else if (item.answered) {
                disabled = "disabled";
                if (opt === item.zh) btnClass += " is-correct";
                if (opt === item.selectedOption && !item.isCorrect) btnClass += " is-error";
            }
            html += `<button type="button" class="${btnClass}" ${disabled} onclick="checkChoice(${i}, this, '${opt.replace(/'/g, "\\'")}', ${isQuiz})">${opt}</button>`;
        });
        html += `</div>`;
    } else {
        const disabled = item.answered && !isQuiz ? "disabled" : "";
        const val = item.userInput ? `value="${item.userInput.replace(/"/g, '&quot;')}"` : "";
        html += `
            <div class="answer-area">
                <input type="text" id="${prefix}input-${i}" placeholder="请输入英文" autocomplete="off" autocapitalize="off" spellcheck="false" ${val} ${disabled} oninput="handleInput(${i}, this, ${isQuiz})">
                <button class="btn-primary" id="${prefix}submitBtn-${i}" onclick="checkWord(${i}, ${isQuiz})" ${disabled}>确定</button>
            </div>
        `;
    }

    if (!isQuiz) {
        const retryHidden = (!item.answered && item.userInput && !item.isCorrect) ? "" : "hidden";
        let hintHidden = "hidden", hintText = "";
        if (item.answered && !item.isCorrect) { hintHidden = ""; hintText = "答案：" + item.en; }
        else if (item.showAnswerClicked) { hintHidden = ""; hintText = "答案：" + item.en; }
        html += `<p class="retry-hint" id="${prefix}retry-${i}" ${retryHidden}>✗ 拼写有误，再试一次</p><p class="answer-hint" id="${prefix}hint-${i}" ${hintHidden}>${hintText}</p>`;
    }

    const prevDisabled = i === 0 ? "disabled" : "";
    const isLast = i === sessionItems.length - 1;
    
    if (isQuiz) {
        const btnStyle = isLast ? 'style="background:var(--gradient); border:none; color:#fff;"' : '';
        const btnText = isLast ? '交卷' : '跳过';
        html += `
            <div class="action-row">
                <button class="btn-secondary" onclick="prevQuestion(true)" ${prevDisabled}>上一题</button>
                <button class="btn-secondary next-btn" onclick="${isLast ? 'submitQuiz()' : 'nextQuestion(true)'}" ${btnStyle}>${btnText}</button>
            </div>
        `;
    } else {
        const showAnsHidden = (!item.answered && item.userInput && !item.isCorrect) ? "" : "hidden";
        html += `
            <div class="action-row">
                <button class="btn-secondary" onclick="prevQuestion(false)" ${prevDisabled}>上一题</button>
                <button class="btn-ghost" id="${prefix}showAnswerBtn-${i}" ${showAnsHidden} onclick="showAnswer(${i})">查看答案</button>
                <button class="btn-secondary next-btn" onclick="nextQuestion(false)">${isLast ? '完成' : '下一题'}</button>
            </div>
        `;
    }
    return html;
}

function buildChoices(correct) {
    const pool = getPool();
    const local = shuffle(pool.map(p => p.zh).filter(z => z !== correct)).slice(0, 3);
    let distractors = local;
    if (distractors.length < 3) {
        const extra = shuffle(getAllMeanings().filter(z => z !== correct && !distractors.includes(z))).slice(0, 3 - distractors.length);
        distractors = [...distractors, ...extra];
    }
    return shuffle([correct, ...distractors]);
}

function renderSlides() {
    const track = document.getElementById("sliderTrack");
    track.innerHTML = "";
    sessionItems.forEach((item, i) => {
        const slide = document.createElement("div");
        slide.className = "slide"; slide.dataset.index = i;
        slide.innerHTML = createSlideHtml(item, i, false);
        track.appendChild(slide);
    });
}

function renderQuizSlides() {
    const track = document.getElementById("quizTrack");
    track.innerHTML = "";
    sessionItems.forEach((item, i) => {
        const slide = document.createElement("div");
        slide.className = "slide"; slide.dataset.index = i;
        slide.innerHTML = createSlideHtml(item, i, true);
        track.appendChild(slide);
    });
}

// ============================================================
// 交互逻辑
// ============================================================
function resolveCurrent(index, isCorrect, isQuiz) {
    const item = sessionItems[index];
    if (item.answered) return;
    item.answered = true;
    item.isCorrect = isCorrect;
    
    stats.total += 1;
    if (isCorrect) stats.correct += 1;
    if (!isQuiz) updateStats();

    const key = `${currentBook}_${item.unit}`;
    if (!globalStats[key]) globalStats[key] = { correct: 0, total: 0, mastered: [] };
    globalStats[key].total += 1;
    if (isCorrect) {
        globalStats[key].correct += 1;
        if (!globalStats[key].mastered.includes(item.en)) {
            globalStats[key].mastered.push(item.en);
        }
    }
    setJSONCookie('global_stats', globalStats);

    if (isQuiz) {
        const done = sessionItems.filter(i => i.answered).length;
        document.getElementById('quizProgress').textContent = `${done} / ${sessionItems.length}`;
    }
}

function checkChoice(index, btn, opt, isQuiz) {
    const item = sessionItems[index];
    if (item.answered && !isQuiz) return;
    
    item.selectedOption = opt;
    const prefix = isQuiz ? 'q-' : '';
    
    if (isQuiz) {
        const slide = document.querySelector(`#quizTrack .slide[data-index="${index}"]`);
        slide.querySelectorAll(".option-btn").forEach(b => b.classList.remove("q-selected"));
        btn.classList.add("q-selected");
        item.userInput = opt; 
        
        setTimeout(() => {
            if (currentIndex < sessionItems.length - 1) {
                scrollToSlide(currentIndex + 1, true);
            } else {
                showToast("已是最后一题，请点击底部交卷按钮");
            }
        }, 250);
    } else {
        const isCorrect = opt === item.zh;
        const slide = document.querySelector(`#sliderTrack .slide[data-index="${index}"]`);
        slide.querySelectorAll(".option-btn").forEach(b => { 
            b.disabled = true; 
            if (b.textContent === item.zh) b.classList.add("is-correct"); 
        });
        const card = document.getElementById(`card-${index}`);
        if (isCorrect) { card.classList.add("is-correct"); } else { btn.classList.add("is-error"); card.classList.add("is-error"); }
        resolveCurrent(index, isCorrect, false);
    }
}

function checkWord(index, isQuiz) {
    const item = sessionItems[index];
    if (item.answered && !isQuiz) return;
    
    const prefix = isQuiz ? 'q-' : '';
    const input = document.getElementById(`${prefix}input-${index}`);
    const val = input.value.trim();
    
    if (isQuiz) {
        item.userInput = val;
        setTimeout(() => {
            if (currentIndex < sessionItems.length - 1) {
                scrollToSlide(currentIndex + 1, true);
            } else {
                showToast("已是最后一题，请点击底部交卷按钮");
            }
        }, 250);
        return;
    }

    const submitBtn = document.getElementById(`${prefix}submitBtn-${index}`);
    const retryHint = document.getElementById(`${prefix}retry-${index}`);
    const showAnswerBtn = document.getElementById(`${prefix}showAnswerBtn-${index}`);
    const hint = document.getElementById(`${prefix}hint-${index}`);
    const card = document.getElementById(`${prefix}card-${index}`);
    const meaning = document.getElementById(`${prefix}Meaning-${index}`);
    
    if (!val) { card.classList.add("is-error"); retryHint.hidden = false; showAnswerBtn.hidden = false; return; }
    item.userInput = val;
    const isCorrect = normalize(val) === normalize(item.en);
    hint.hidden = true;

    if (isCorrect) {
        resolveCurrent(index, true, false);
        input.disabled = true; submitBtn.disabled = true; retryHint.hidden = true; showAnswerBtn.hidden = true;
        card.classList.add("is-correct"); meaning.textContent = "✓ " + item.en;
    } else {
        card.classList.add("is-error"); retryHint.hidden = false; showAnswerBtn.hidden = false;
    }
}

function handleInput(index, inputEl, isQuiz) {
    const item = sessionItems[index];
    if (item.answered && !isQuiz) return;
    item.userInput = inputEl.value;
    if (!isQuiz) {
        const prefix = '';
        document.getElementById(`${prefix}hint-${index}`).hidden = true;
        const card = document.getElementById(`${prefix}card-${index}`);
        if (card.classList.contains("is-error")) { card.classList.remove("is-error"); document.getElementById(`${prefix}retry-${index}`).hidden = true; }
    }
}

function showAnswer(index) {
    const item = sessionItems[index];
    if (item.answered) return;
    item.showAnswerClicked = true;
    const hint = document.getElementById(`hint-${index}`);
    hint.textContent = "答案：" + item.en; hint.hidden = false;
    document.getElementById(`retry-${index}`).hidden = true;
    document.getElementById(`showAnswerBtn-${index}`).hidden = true;
}

// ============================================================
// 滑块控制
// ============================================================
let scrollTimer;
function setupSlider(containerId) {
    const slider = document.getElementById(containerId);
    slider.addEventListener("scroll", () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            const index = Math.round(slider.scrollLeft / slider.clientWidth);
            if (index !== currentIndex && index >= 0 && index < sessionItems.length) {
                currentIndex = index;
            }
        }, 100);
    });
}
function resetSlider(containerId) {
    const slider = document.getElementById(containerId);
    slider.classList.add("no-smooth"); slider.scrollLeft = 0;
    void slider.offsetWidth; setTimeout(() => { slider.classList.remove("no-smooth"); }, 50);
    currentIndex = 0;
}
function scrollToSlide(index, isQuiz) {
    const containerId = isQuiz ? "quizSliderContainer" : "sliderContainer";
    document.getElementById(containerId).scrollTo({ left: index * document.getElementById(containerId).clientWidth });
    currentIndex = index;
}
function prevQuestion(isQuiz) { if (currentIndex > 0) scrollToSlide(currentIndex - 1, isQuiz); }
function nextQuestion(isQuiz) {
    if (currentIndex < sessionItems.length - 1) {
        scrollToSlide(currentIndex + 1, isQuiz);
    } else {
        if (isQuiz) submitQuiz();
        else switchTab('view-stats');
    }
}

// ============================================================
// 单词小测逻辑
// ============================================================
function updateChips(input) {
    const group = input.closest('.mode-bar');
    group.querySelectorAll('.chip').forEach(l => l.classList.remove('active'));
    input.closest('.chip').classList.add('active');
}

function openQuizSetup() {
    document.getElementById("quizSetupModal").hidden = false;
    updateSuggestedTime();
}
function closeQuizSetup() {
    document.getElementById("quizSetupModal").hidden = true;
}
function toggleCustomCount() {
    const isCustom = document.querySelector('input[name="q-count"][value="custom"]').checked;
    document.getElementById("customCountInput").disabled = !isCustom;
    updateSuggestedTime();
}
function updateSuggestedTime() {
    let count = 10;
    const checked = document.querySelector('input[name="q-count"]:checked');
    if (checked) {
        if (checked.value === 'custom') count = parseInt(document.getElementById("customCountInput").value) || 30;
        else count = parseInt(checked.value);
    }
    document.getElementById("quizTimeInput").value = count * 15;
}

function startQuiz() {
    const mode = document.querySelector('input[name="q-mode"]:checked').value;
    let count = document.querySelector('input[name="q-count"]:checked').value;
    if (count === 'custom') count = parseInt(document.getElementById("customCountInput").value) || 10;
    else count = parseInt(count);
    const time = parseInt(document.getElementById("quizTimeInput").value) || 150;
    
    const pool = getPool();
    if (pool.length === 0) { showToast("当前范围没有单词"); return; }

    closeQuizSetup();
    isQuizMode = true;
    
    const selectedWords = shuffle([...pool]).slice(0, Math.min(count, pool.length));
    sessionItems = selectedWords.map(item => ({
        en: item.en, zh: item.zh, pos: item.pos, unit: item.unit,
        mode: mode === "mixed" ? (Math.random() < 0.5 ? "en2zh" : "zh2en") : mode,
        answered: false, isCorrect: null, userInput: "", selectedOption: "", showAnswerClicked: false
    }));
    
    stats = { correct: 0, total: 0 };
    currentIndex = 0;
    
    renderQuizSlides();
    document.getElementById("quizProgress").textContent = `0 / ${sessionItems.length}`;
    document.getElementById("quizOverlay").hidden = false;
    
    setTimeout(() => resetSlider("quizSliderContainer"), 50);

    quizTimeLeft = time;
    document.getElementById("quizTimer").textContent = formatTime(quizTimeLeft);
    document.getElementById("quizTimer").classList.remove("warning");
    
    clearInterval(quizTimerInterval);
    quizTimerInterval = setInterval(() => {
        quizTimeLeft--;
        document.getElementById("quizTimer").textContent = formatTime(quizTimeLeft);
        if (quizTimeLeft <= 10) document.getElementById("quizTimer").classList.add("warning");
        if (quizTimeLeft <= 0) {
            clearInterval(quizTimerInterval);
            submitQuiz();
        }
    }, 1000);
}

function exitQuiz() {
    showConfirm("退出后本次小测成绩将不算数，确定退出吗？", (res) => {
        if (res) {
            isQuizMode = false;
            clearInterval(quizTimerInterval);
            document.getElementById("quizOverlay").hidden = true;
            switchTab('view-stats');
        }
    });
}

function submitQuiz() {
    clearInterval(quizTimerInterval);
    document.getElementById("quizOverlay").hidden = true;

    sessionItems.forEach(item => {
        const userAnswer = item.mode === "en2zh" ? item.selectedOption : item.userInput;
        let isCorrect = false;
        if (userAnswer) {
            if (item.mode === "en2zh") isCorrect = (userAnswer === item.zh);
            else isCorrect = (normalize(userAnswer) === normalize(item.en));
        }
        
        if (!item.answered) {
            item.answered = true;
            item.isCorrect = isCorrect;
            stats.total += 1;
            if (isCorrect) stats.correct += 1;

            const key = `${currentBook}_${item.unit}`;
            if (!globalStats[key]) globalStats[key] = { correct: 0, total: 0, mastered: [] };
            globalStats[key].total += 1;
            if (isCorrect) {
                globalStats[key].correct += 1;
                if (!globalStats[key].mastered.includes(item.en)) {
                    globalStats[key].mastered.push(item.en);
                }
            }
        }
    });
    setJSONCookie('global_stats', globalStats);

    const total = stats.total;
    const correct = stats.correct;
    const rate = total === 0 ? 0 : Math.round((correct / total) * 100);
    
    // 记录本次成绩到历史
    quizHistory.push({ date: new Date().getTime(), rate: rate });
    if (quizHistory.length > 10) quizHistory.shift();
    setJSONCookie('quiz_history', quizHistory);

    const card = document.getElementById("quizSummaryCard");
    const wrong = sessionItems.filter(i => !i.isCorrect);

    // 生成本次成绩趋势图
    let chartSvg = generateTrendChartSVG(quizHistory);

    let html = `
        <h3 class="summary-title">小测完成</h3>
        <div class="summary-rate-wrap">
            <span class="summary-rate">${rate}%</span>
            <span class="summary-sub">正确率</span>
        </div>
        <p class="summary-count">答对 <strong>${correct}</strong> / ${total}</p>
        
        <div style="width:100%; border-top:1px dashed var(--border-hairline); padding-top:10px;">
            <h4 style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:8px; text-align:center;">历次成绩走势</h4>
            ${chartSvg}
        </div>

        <div class="summary-wrong">
    `;

    if (wrong.length === 0) {
        html += `<p style="color:#52c41a; font-weight:700; text-align:center; padding:10px;">完美！全部答对！</p>`;
    } else {
        wrong.forEach(h => {
            const ua = h.mode === "en2zh" ? h.selectedOption : h.userInput;
            html += `
                <div class="wrong-item">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <span class="wrong-en">${h.en}</span> 
                        <span class="wrong-zh">${h.pos} ${h.zh}</span>
                    </div>
                    <span style="color:#ff5c66; font-size:0.8rem; text-align:right;">你的答案:<br>${ua || "未作答"}</span>
                </div>
            `;
        });
    }
    
    html += `</div>
        <button class="btn-primary" style="margin-top:16px;" onclick="closeQuizResult()">返回学情</button>
    `;
    card.innerHTML = html;
    document.getElementById("quizResultOverlay").hidden = false;
}

function closeQuizResult() {
    document.getElementById("quizResultOverlay").hidden = true;
    isQuizMode = false;
    switchTab('view-stats');
}

// ============================================================
// 用户设置与初始化
// ============================================================
function saveUsername() {
    const input = document.getElementById("usernameInput");
    const val = input.value.trim();
    if (val) {
        username = val; setCookie('username', username);
        document.getElementById("displayUsername").textContent = username;
        input.value = ""; showToast("昵称已保存！");
    }
}

function togglePanel(panelId, btn) {
    const panel = document.getElementById(panelId);
    const isHidden = panel.hidden;
    document.querySelectorAll('.about-panel').forEach(p => p.hidden = true);
    document.querySelectorAll('.settings-item').forEach(b => b.classList.remove('open'));
    if (isHidden) {
        panel.hidden = false;
        btn.classList.add("open");
    }
}

function toggleTheme(checkbox) {
    if (checkbox.checked) { document.body.classList.add("light-theme"); setCookie('theme', 'light'); }
    else { document.body.classList.remove("light-theme"); setCookie('theme', 'dark'); }
}

function initTheme() {
    const checkbox = document.getElementById("themeToggle");
    if (isLightTheme) { document.body.classList.add("light-theme"); checkbox.checked = true; }
    else { document.body.classList.remove("light-theme"); checkbox.checked = false; }
}

function startSession() {
    const pool = getPool();
    sessionItems = shuffle([...pool]).map(item => ({
        en: item.en, zh: item.zh, pos: item.pos, unit: item.unit,
        mode: currentMode === "mixed" ? (Math.random() < 0.5 ? "en2zh" : "zh2en") : currentMode,
        answered: false, isCorrect: null, userInput: "", selectedOption: "", showAnswerClicked: false
    }));
    sessionTotal = sessionItems.length;
    stats = { correct: 0, total: 0 };
    
    renderSlides();
    resetSlider("sliderContainer");
    updateStats();
}

function init() {
    checkVersion();
    initTheme();
    document.getElementById("displayUsername").textContent = username;
    populateBookSelect();
    populateUnitSelect();
    updateLabels();

    setupSlider("sliderContainer");
    setupSlider("quizSliderContainer");

    document.getElementById("bookSelect").addEventListener("change", e => {
        currentBook = e.target.value; currentUnit = "__all__";
        setCookie('book', currentBook); setCookie('unit', currentUnit);
        populateUnitSelect(); renderVocabPage(); 
        startSession();
    });

    document.getElementById("unitSelect").addEventListener("change", e => {
        currentUnit = e.target.value; setCookie('unit', currentUnit);
        renderVocabPage(); 
        startSession();
    });

    document.querySelectorAll(".mode-bar[role='group'] .chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".mode-bar[role='group'] .chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentMode = chip.dataset.mode;
            startSession();
        });
    });

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.target));
    });

    document.querySelector('.mode-bar[role="group"] .chip[data-mode="en2zh"]').classList.add("active");
    startSession();
}

init();