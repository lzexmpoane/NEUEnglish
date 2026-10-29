// ============================================================
// NEUEnglish — 答题逻辑
// 依赖：words.js 里的全局 wordBank
// ============================================================

// ----- 状态 -----
let currentBook = Object.keys(wordBank)[0];
let currentUnit = "__all__";
let currentMode = "mixed"; // 'en2zh' | 'zh2en' | 'mixed'

let currentWord = "";
let correctAnswer = "";
let actualMode = "en2zh";
let answered = false;     // 本题是否已最终完成（答对或已放弃）
let attemptCount = 0;     // 本题已提交次数（用于中→英重试）
let stats = { correct: 0, total: 0 };

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

function setMeaningText(text) {
    const el = document.getElementById("Meaning");
    el.textContent = text;
    el.dataset.long = text.length > 14 ? "true" : "false";
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
    setTimeout(() => {
        card.classList.remove("anim-correct", "anim-error");
    }, 700);
}

function updateStats() {
    document.getElementById("stats").textContent =
        stats.total > 0 ? `答对 ${stats.correct} / ${stats.total}` : "";
}

function resetStats() {
    stats = { correct: 0, total: 0 };
    updateStats();
}

function showRetryHint() { document.getElementById("retryHint").hidden = false; }
function hideRetryHint() { document.getElementById("retryHint").hidden = true; }

function showAnswerBtn() { document.getElementById("showAnswerBtn").hidden = false; }
function hideAnswerBtn() { document.getElementById("showAnswerBtn").hidden = true; }

function showAnswerHint(text) {
    const el = document.getElementById("answerHint");
    el.textContent = "答案：" + text;
    el.hidden = false;
}
function hideAnswerHint() { document.getElementById("answerHint").hidden = true; }

// ----- 范围 -----
function getUnitsOfBook(book) {
    return wordBank[book] ? Object.keys(wordBank[book]) : [];
}

function populateBookSelect() {
    const sel = document.getElementById("bookSelect");
    sel.innerHTML = "";
    Object.keys(wordBank).forEach(b => {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        sel.appendChild(opt);
    });
    sel.value = currentBook;
}

function populateUnitSelect() {
    const sel = document.getElementById("unitSelect");
    sel.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "__all__";
    allOpt.textContent = "全部单元";
    sel.appendChild(allOpt);

    getUnitsOfBook(currentBook).forEach(u => {
        const opt = document.createElement("option");
        opt.value = u;
        opt.textContent = u;
        sel.appendChild(opt);
    });
    sel.value = currentUnit;
}

function getPool() {
    const book = wordBank[currentBook];
    if (!book) return [];
    const units =
        currentUnit === "__all__" ? Object.keys(book) : [currentUnit];
    const pool = [];
    units.forEach(u => {
        Object.entries(book[u] || {}).forEach(([en, zh]) => pool.push({ en, zh }));
    });
    return pool;
}

function getAllMeanings() {
    const set = new Set();
    Object.values(wordBank).forEach(book => {
        Object.values(book).forEach(unit => {
            Object.values(unit).forEach(zh => set.add(zh));
        });
    });
    return Array.from(set);
}

// ----- 出题 -----
function nextQuestion() {
    const pool = getPool();
    if (pool.length === 0) {
        setMeaningText("当前范围没有单词");
        document.getElementById("options").hidden = true;
        document.getElementById("answerArea").hidden = true;
        hideRetryHint();
        hideAnswerBtn();
        hideAnswerHint();
        return;
    }

    answered = false;
    attemptCount = 0;
    setCardState(null);
    hideRetryHint();
    hideAnswerBtn();
    hideAnswerHint();

    actualMode =
        currentMode === "mixed"
            ? Math.random() < 0.5
                ? "en2zh"
                : "zh2en"
            : currentMode;

    const item = pool[Math.floor(Math.random() * pool.length)];
    currentWord = item.en;
    correctAnswer = item.zh;

    const modeTag = document.getElementById("modeTag");
    const optionsEl = document.getElementById("options");
    const answerArea = document.getElementById("answerArea");
    const wordInput = document.getElementById("wordInput");
    const submitBtn = document.getElementById("submitBtn");

    if (actualMode === "en2zh") {
        modeTag.textContent = "英 → 中 · 选择题";
        setMeaningText(currentWord);

        const choices = buildChoices(pool, correctAnswer);
        optionsEl.innerHTML = "";
        choices.forEach(opt => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "option-btn";
            btn.textContent = opt;
            btn.addEventListener("click", () => checkChoice(btn, opt));
            optionsEl.appendChild(btn);
        });
        optionsEl.hidden = false;
        answerArea.hidden = true;
    } else {
        modeTag.textContent = "中 → 英 · 输入题（可重试）";
        setMeaningText(correctAnswer);

        optionsEl.innerHTML = "";
        optionsEl.hidden = true;
        answerArea.hidden = false;

        wordInput.value = "";
        wordInput.disabled = false;
        submitBtn.disabled = false;
        setTimeout(() => wordInput.focus(), 60);
    }
}

function buildChoices(pool, correct) {
    const local = shuffle(
        pool.map(p => p.zh).filter(z => z !== correct)
    ).slice(0, 3);

    let distractors = local;
    if (distractors.length < 3) {
        const extra = shuffle(
            getAllMeanings().filter(
                z => z !== correct && !distractors.includes(z)
            )
        ).slice(0, 3 - distractors.length);
        distractors = [...distractors, ...extra];
    }
    return shuffle([correct, ...distractors]);
}

// ----- 英→中：点击选项 -----
function checkChoice(btn, opt) {
    if (answered) return;
    answered = true;

    const buttons = document.querySelectorAll("#options .option-btn");
    buttons.forEach(b => {
        b.disabled = true;
        if (b.textContent === correctAnswer) b.classList.add("is-correct");
    });

    const isCorrect = opt === correctAnswer;
    if (isCorrect) {
        setCardState("is-correct");
        playAnim("correct");
    } else {
        btn.classList.add("is-error");
        setCardState("is-error");
        playAnim("error");
    }

    stats.total += 1;
    if (isCorrect) stats.correct += 1;
    updateStats();
}

// ----- 中→英：输入提交（支持答错重试） -----
function checkWord() {
    if (answered) return;

    const input = document.getElementById("wordInput");
    const submitBtn = document.getElementById("submitBtn");
    const val = input.value.trim();
    if (!val) {
        input.focus();
        return;
    }

    const isCorrect = normalize(val) === normalize(currentWord);
    attemptCount += 1;

    // 只有第一次提交计入统计，重试不计入
    if (attemptCount === 1) {
        stats.total += 1;
        if (isCorrect) stats.correct += 1;
        updateStats();
    }

    hideAnswerHint(); // 一旦提交，就隐藏答案

    if (isCorrect) {
        answered = true;
        input.disabled = true;
        submitBtn.disabled = true;
        hideRetryHint();
        hideAnswerBtn();
        setCardState("is-correct");
        playAnim("correct");
        setMeaningText("✓ " + currentWord);
    } else {
        setCardState("is-error");
        playAnim("error");
        input.value = "";
        input.focus();
        showRetryHint();
        showAnswerBtn();   // 答错 → 显示「查看答案」
    }
}

// ----- 中→英：查看答案（不锁题，可继续拼写） -----
function showAnswer() {
    if (answered) return;

    // 显示答案，但不锁定输入
    showAnswerHint(currentWord);
    hideRetryHint();
    hideAnswerBtn(); // 答案已显示，按钮先收起；再次输错会重新出现
}

// ----- 初始化 -----
function init() {
    populateBookSelect();
    populateUnitSelect();

    document.getElementById("bookSelect").addEventListener("change", e => {
        currentBook = e.target.value;
        currentUnit = "__all__";
        populateUnitSelect();
        resetStats();
        nextQuestion();
    });

    document.getElementById("unitSelect").addEventListener("change", e => {
        currentUnit = e.target.value;
        resetStats();
        nextQuestion();
    });

    document.querySelectorAll(".mode-bar .chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document
                .querySelectorAll(".mode-bar .chip")
                .forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentMode = chip.dataset.mode;
            resetStats();
            nextQuestion();
        });
    });

    const input = document.getElementById("wordInput");
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") checkWord();
    });
    // 用户重新输入时：清除错误状态、隐藏重试提示和答案
    input.addEventListener("input", () => {
        if (answered) return;
        hideAnswerHint();
        if (document.getElementById("card").classList.contains("is-error")) {
            setCardState(null);
            hideRetryHint();
        }
    });

    nextQuestion();
}

init();