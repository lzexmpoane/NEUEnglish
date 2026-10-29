// ============================================================
// NEUEnglish — 答题逻辑
// ============================================================

let currentBook = Object.keys(wordBank)[0];
let currentUnit = "__all__";
let currentMode = "en2zh"; // 'en2zh' | 'zh2en' | 'mixed' | 'view'

let queue = [];
let history = [];
let sessionTotal = 0;
let stats = { correct: 0, total: 0 };

let currentWord = "";
let currentPos = "";
let correctAnswer = "";
let actualMode = "en2zh";
let currentResolved = true; // 是否已结算（防重复计分）
let isQuickTest = false;

// ----- 工具 -----
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function normalize(s) {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function setMeaningText(text, pos = "") {
    const el = document.getElementById("Meaning");
    const posEl = document.getElementById("posTag");
    el.textContent = text;
    el.dataset.long = text.length > 14 ? "true" : "false";
    posEl.textContent = pos;
}

function setCardState(state) {
    const card = document.getElementById("card");
    card.classList.remove("is-correct", "is-error");
    if (state) card.classList.add(state);
}

function playAnim(type) {
    const card = document.getElementById("card");
    card.classList.remove("anim-correct", "anim-error");
    void card.offsetWidth;
    card.classList.add(type === "correct" ? "anim-correct" : "anim-error");
    setTimeout(() => card.classList.remove("anim-correct", "anim-error"), 650);
}

function updateStats() {
    const el = document.getElementById("stats");
    if (sessionTotal === 0) { el.textContent = ""; return; }
    el.textContent = `进度 ${history.length} / ${sessionTotal} · 答对 ${stats.correct}`;
}

// ----- 范围 -----
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
        pool.push({ en, zh: data.zh, pos: data.pos });
    }));
    return pool;
}

function getAllMeanings() {
    const set = new Set();
    Object.values(wordBank).forEach(book => Object.values(book).forEach(unit => Object.values(unit).forEach(data => set.add(data.zh))));
    return Array.from(set);
}

// ----- 词汇表模式 -----
function renderVocab() {
    const pool = getPool();
    const viewArea = document.getElementById("viewArea");
    viewArea.innerHTML = "";
    
    if (pool.length === 0) {
        viewArea.innerHTML = "<p style='text-align:center; padding:20px;'>当前范围没有单词</p>";
        return;
    }

    // 按字母排序
    pool.sort((a, b) => a.en.localeCompare(b.en));

    const list = document.createElement("div");
    list.className = "vocab-list";
    pool.forEach(item => {
        const div = document.createElement("div");
        div.className = "vocab-item";
        div.innerHTML = `
            <span class="vocab-word">${item.en}</span>
            <span class="vocab-pos">${item.pos}</span>
            <span class="vocab-zh">${item.zh}</span>
        `;
        list.appendChild(div);
    });
    viewArea.appendChild(list);
}

// ----- 出题 -----
function buildQueue() {
    const pool = getPool();
    queue = shuffle([...pool]).map(item => ({
        en: item.en, zh: item.zh, pos: item.pos,
        mode: currentMode === "mixed" ? (Math.random() < 0.5 ? "en2zh" : "zh2en") : currentMode
    }));
    sessionTotal = queue.length;
    stats = { correct: 0, total: 0 };
    history = [];
    updateStats();
}

function resolveCurrent(correct) {
    if (currentResolved) return;
    currentResolved = true;
    stats.total += 1;
    if (correct) stats.correct += 1;
    history.push({ en: currentWord, zh: correctAnswer, pos: currentPos, correct });
    updateStats();
}

function nextQuestion() {
    if (!currentResolved) resolveCurrent(false);

    if (queue.length === 0) { showSummary(); return; }

    document.getElementById("summary").hidden = true;
    document.getElementById("quizArea").hidden = false;

    const item = queue.shift();
    currentWord = item.en;
    correctAnswer = item.zh;
    currentPos = item.pos;
    actualMode = item.mode;
    currentResolved = false;

    setCardState(null);
    document.getElementById("retryHint").hidden = true;
    document.getElementById("showAnswerBtn").hidden = true;
    document.getElementById("answerHint").hidden = true;

    const optionsEl = document.getElementById("options");
    const answerArea = document.getElementById("answerArea");
    const wordInput = document.getElementById("wordInput");
    const submitBtn = document.getElementById("submitBtn");

    if (actualMode === "en2zh") {
        setMeaningText(currentWord, currentPos);
        const choices = buildChoices(correctAnswer);
        optionsEl.innerHTML = "";
        choices.forEach(opt => {
            const btn = document.createElement("button");
            btn.type = "button"; btn.className = "option-btn"; btn.textContent = opt;
            btn.addEventListener("click", () => checkChoice(btn, opt));
            optionsEl.appendChild(btn);
        });
        optionsEl.hidden = false;
        answerArea.hidden = true;
    } else {
        setMeaningText(correctAnswer, currentPos);
        optionsEl.innerHTML = ""; optionsEl.hidden = true;
        answerArea.hidden = false;
        wordInput.value = ""; wordInput.disabled = false; submitBtn.disabled = false;
        setTimeout(() => wordInput.focus(), 60);
    }
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

// ----- 英→中 -----
function checkChoice(btn, opt) {
    if (currentResolved) return;
    const buttons = document.querySelectorAll("#options .option-btn");
    buttons.forEach(b => { b.disabled = true; if (b.textContent === correctAnswer) b.classList.add("is-correct"); });
    const isCorrect = opt === correctAnswer;
    if (isCorrect) { setCardState("is-correct"); playAnim("correct"); }
    else { btn.classList.add("is-error"); setCardState("is-error"); playAnim("error"); }
    resolveCurrent(isCorrect);
}

// ----- 中→英 -----
function checkWord() {
    if (currentResolved) return;
    const input = document.getElementById("wordInput");
    const submitBtn = document.getElementById("submitBtn");
    const val = input.value.trim();
    if (!val) { input.focus(); return; }

    const isCorrect = normalize(val) === normalize(currentWord);
    document.getElementById("answerHint").hidden = true;

    if (isCorrect) {
        resolveCurrent(true);
        input.disabled = true; submitBtn.disabled = true;
        document.getElementById("retryHint").hidden = true;
        document.getElementById("showAnswerBtn").hidden = true;
        setCardState("is-correct"); playAnim("correct");
        setMeaningText("✓ " + currentWord, currentPos);
    } else {
        setCardState("is-error"); playAnim("error");
        input.value = ""; input.focus();
        document.getElementById("retryHint").hidden = false;
        document.getElementById("showAnswerBtn").hidden = false;
        // 注意：这里不调用 resolveCurrent，允许继续重试
    }
}

// ----- 查看答案 -----
function showAnswer() {
    if (currentResolved) return;
    const hint = document.getElementById("answerHint");
    hint.textContent = "答案：" + currentWord;
    hint.hidden = false;
    document.getElementById("retryHint").hidden = true;
    document.getElementById("showAnswerBtn").hidden = true; // 收起按钮，但用户仍可输入
}

// ----- 小结 -----
function showSummary() {
    if (stats.total === 0) { setMeaningText("当前范围没有单词"); return; }
    document.getElementById("quizArea").hidden = true;
    document.getElementById("summary").hidden = false;

    const rate = Math.round((stats.correct / stats.total) * 100);
    document.getElementById("sumRate").textContent = rate + "%";
    document.getElementById("sumCorrect").textContent = stats.correct;
    document.getElementById("sumTotal").textContent = stats.total;

    const wrongEl = document.getElementById("sumWrong");
    wrongEl.innerHTML = "";
    const wrong = history.filter(h => !h.correct);
    if (wrong.length === 0) {
        const p = document.createElement("p"); p.className = "summary-perfect"; p.textContent = "全部答对，太棒了！"; wrongEl.appendChild(p);
    } else {
        wrong.forEach(h => {
            const div = document.createElement("div"); div.className = "wrong-item";
            div.innerHTML = `<span class="wrong-en">${h.en}</span> <span class="wrong-zh">${h.pos} ${h.zh}</span>`;
            wrongEl.appendChild(div);
        });
    }
}

// ----- 新一轮 -----
function startSession() {
    isQuickTest = false;
    if (currentMode === "view") {
        document.getElementById("quizArea").hidden = true;
        document.getElementById("summary").hidden = true;
        document.getElementById("viewArea").hidden = false;
        renderVocab();
        return;
    }
    document.getElementById("viewArea").hidden = true;
    buildQueue();
    currentResolved = true;
    document.getElementById("summary").hidden = true;
    document.getElementById("quizArea").hidden = false;
    nextQuestion();
}

function restartSession() { startSession(); }

// ----- 快速测试 -----
function startQuickTest() {
    const pool = getPool();
    if (pool.length === 0) { alert("当前范围没有单词"); return; }
    isQuickTest = true;
    const testPool = shuffle([...pool]).slice(0, Math.min(10, pool.length));
    queue = testPool.map(item => ({
        en: item.en, zh: item.zh, pos: item.pos,
        mode: currentMode === "mixed" ? (Math.random() < 0.5 ? "en2zh" : "zh2en") : (currentMode === "view" ? "en2zh" : currentMode)
    }));
    sessionTotal = queue.length;
    stats = { correct: 0, total: 0 }; history = [];
    currentResolved = true;
    document.getElementById("viewArea").hidden = true;
    document.getElementById("summary").hidden = true;
    document.getElementById("quizArea").hidden = false;
    nextQuestion();
}

// ----- 初始化 -----
function init() {
    populateBookSelect();
    populateUnitSelect();

    document.getElementById("bookSelect").addEventListener("change", e => {
        currentBook = e.target.value; currentUnit = "__all__";
        populateUnitSelect(); startSession();
    });

    document.getElementById("unitSelect").addEventListener("change", e => {
        currentUnit = e.target.value; startSession();
    });

    document.querySelectorAll(".mode-bar .chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".mode-bar .chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentMode = chip.dataset.mode;
            startSession();
        });
    });

    document.getElementById("quickTestBtn").addEventListener("click", startQuickTest);

    const input = document.getElementById("wordInput");
    input.addEventListener("keydown", e => { if (e.key === "Enter") checkWord(); });
    input.addEventListener("input", () => {
        if (currentResolved) return;
        document.getElementById("answerHint").hidden = true; // 重新输入时隐藏答案
        if (document.getElementById("card").classList.contains("is-error")) {
            setCardState(null); 
            document.getElementById("retryHint").hidden = true;
        }
    });

    // 默认选中第一个模式
    document.querySelector('.mode-bar .chip[data-mode="en2zh"]').classList.add("active");
    startSession();
}

init();