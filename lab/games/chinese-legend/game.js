/**
 * Chinese Legend V2.0 - Core Engine
 * Designed by GitHub Copilot
 */

// --- 1. Sound Engine (Enhanced) ---
class SoundManager {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.enabled = true;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.3; // Prevent ear damage
    this.masterGain.connect(this.ctx.destination);
  }

  playTone(freq, type, duration, startTime = 0, vol = 1) {
    if (!this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);
    
    gain.gain.setValueAtTime(0, this.ctx.currentTime + startTime);
    gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + startTime + duration);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(this.ctx.currentTime + startTime);
    osc.stop(this.ctx.currentTime + startTime + duration);
  }

  playCorrect() {
    // Major Chord Arpeggio
    this.playTone(523.25, 'sine', 0.3, 0); // C5
    this.playTone(659.25, 'sine', 0.3, 0.1); // E5
    this.playTone(783.99, 'sine', 0.4, 0.2); // G5
  }

  playWrong() {
    // Dissonant tritone
    this.playTone(150, 'sawtooth', 0.4, 0);
    this.playTone(215, 'sawtooth', 0.4, 0); 
  }

  playAttack() {
    // Noise burst simulation
    this.playTone(100, 'square', 0.1, 0, 0.5);
    this.playTone(50, 'sawtooth', 0.2, 0.05, 0.8);
  }

  playSkill() {
    // Magical sweep
    this.playTone(440, 'sine', 0.5, 0);
    this.playTone(880, 'sine', 0.5, 0.1);
    this.playTone(1760, 'triangle', 0.6, 0.2);
  }

  playBossWarning() {
    this.playTone(55, 'sawtooth', 1.0, 0, 0.8);
    this.playTone(55, 'sawtooth', 1.0, 0.5, 0.8);
  }
}

const audio = new SoundManager();

// --- 2. Content Database (Massive Expansion) ---
// Helper to generate pinyin ruby
const ruby = (char, pinyin) => `<ruby>${char}<rt>${pinyin}</rt></ruby>`;

const questionBank = {
  // Grade 1-2: Pinyin, Strokes, Basic Characters
  low: [
    { type: "pinyin", q: `选出“${ruby('森','sēn')}”字的正确读音：`, opts: ["sēn", "shēn", "sēng", "shēng"], a: 0, tag: "char" },
    { type: "pinyin", q: `“${ruby('绿','lǜ')}”字的韵母是？`, opts: ["u", "ü", "i", "uai"], a: 1, tag: "char" },
    { type: "stroke", q: `“${ruby('火','huǒ')}”字共有几画？`, opts: ["3画", "4画", "5画", "6画"], a: 1, tag: "char" },
    { type: "antonym", q: `“${ruby('早','zǎo')}”的反义词是？`, opts: ["晚", "快", "慢", "晨"], a: 0, tag: "vocab" },
    { type: "poem", q: `“举头望明月”的下一句？`, opts: ["低头思故乡", "疑是地上霜", "红掌拨清波", "润物细无声"], a: 0, tag: "poem" },
    { type: "poem", q: `《咏鹅》中“白毛浮绿水”的下一句？`, opts: ["红掌拨清波", "曲项向天歌", "疑是地上霜", "处处闻啼鸟"], a: 0, tag: "poem" },
    { type: "vocab", q: `选出量词搭配正确的一项：一__牛`, opts: ["头", "只", "个", "条"], a: 0, tag: "vocab" },
    { type: "vocab", q: `选出书写正确的词语：`, opts: ["朋有", "朋友", "明友", "朋又"], a: 1, tag: "vocab" },
    { type: "logic", q: `下列哪个不是水果？`, opts: ["苹果", "香蕉", "黄瓜", "西瓜"], a: 2, tag: "logic" },
    { type: "char", q: `“${ruby('明','míng')}”字是由哪两个字组成的？`, opts: ["日+月", "目+月", "日+目", "田+月"], a: 0, tag: "char" },
    { type: "poem", q: `“春去花还在”的下一句？`, opts: ["人来鸟不惊", "近听水无声", "远看山有色", "汗滴禾下土"], a: 0, tag: "poem" },
    { type: "vocab", q: `“雪白”是形容什么颜色的？`, opts: ["白色", "红色", "蓝色", "黑色"], a: 0, tag: "vocab" }
  ],
  // Grade 3-4: Idioms, Polyphones, Tang Poetry
  mid: [
    { type: "idiom", q: `成语“亡羊补__”？`, opts: ["牢", "劳", "老", "捞"], a: 0, tag: "idiom", exp: "亡羊补牢：羊逃跑了再去修补羊圈，还不算晚。" },
    { type: "idiom", q: `“守株待兔”中的“株”指的是？`, opts: ["树桩", "猪", "蜘蛛", "珠宝"], a: 0, tag: "idiom" },
    { type: "poem", q: `“独在异乡为异客”的下一句？`, opts: ["每逢佳节倍思亲", "遥知兄弟登高处", "遍插茱萸少一人", "西出阳关无故人"], a: 0, tag: "poem" },
    { type: "poem", q: `《望庐山瀑布》的作者是？`, opts: ["李白", "杜甫", "白居易", "王维"], a: 0, tag: "poem" },
    { type: "poly", q: `选出“${ruby('行','xíng')}”的正确读音：银__`, opts: ["háng", "xíng", "hàng", "xìng"], a: 0, tag: "char", exp: "银行(háng)，行走(xíng)。" },
    { type: "vocab", q: `“犹豫”的近义词是？`, opts: ["迟疑", "果断", "坚定", "迅速"], a: 0, tag: "vocab" },
    { type: "rhetoric", q: `“飞流直下三千尺”使用了什么修辞手法？`, opts: ["夸张", "比喻", "拟人", "排比"], a: 0, tag: "logic" },
    { type: "idiom", q: `下列哪个成语是寓言故事？`, opts: ["掩耳盗铃", "风和日丽", "五颜六色", "四面八方"], a: 0, tag: "idiom" },
    { type: "poem", q: `“借问酒家何处有”的下一句？`, opts: ["牧童遥指杏花村", "清明时节雨纷纷", "路上行人欲断魂", "早有蜻蜓立上头"], a: 0, tag: "poem" },
    { type: "logic", q: `选出不同类的一项：`, opts: ["铅笔", "橡皮", "尺子", "足球"], a: 3, tag: "logic" },
    { type: "vocab", q: `“疾驰”的意思是？`, opts: ["飞快地奔跑", "慢慢地走", "生病了", "停止不动"], a: 0, tag: "vocab" },
    { type: "char", q: `下列哪个字是形声字？`, opts: ["妈", "休", "上", "日"], a: 0, tag: "char", exp: "妈：女表意，马表音。" }
  ],
  // Grade 5-6: Literature, History, Complex Logic
  high: [
    { type: "lit", q: `《三国演义》中“桃园三结义”不包括？`, opts: ["赵云", "刘备", "关羽", "张飞"], a: 0, tag: "lit", exp: "刘关张桃园结义。" },
    { type: "lit", q: `“花谢花飞花满天”出自哪部名著？`, opts: ["《红楼梦》", "《西游记》", "《水浒传》", "《三国演义》"], a: 0, tag: "lit", exp: "林黛玉《葬花吟》。" },
    { type: "poem", q: `“人生自古谁无死，留取丹心照汗青”的作者是？`, opts: ["文天祥", "岳飞", "陆游", "辛弃疾"], a: 0, tag: "poem" },
    { type: "idiom", q: `下列成语中褒义词是？`, opts: ["神机妙算", "阴谋诡计", "自以为是", "口蜜腹剑"], a: 0, tag: "idiom" },
    { type: "logic", q: `“只有努力学习，才能取得好成绩”是？`, opts: ["条件关系", "因果关系", "转折关系", "并列关系"], a: 0, tag: "logic" },
    { type: "lit", q: `鲁迅先生的第一篇白话小说是？`, opts: ["《狂人日记》", "《阿Q正传》", "《孔乙己》", "《药》"], a: 0, tag: "lit" },
    { type: "poem", q: `“粉骨碎身浑不怕”描写的是？`, opts: ["石灰", "煤炭", "竹子", "梅花"], a: 0, tag: "poem" },
    { type: "idiom", q: `“完璧归赵”的主人公是？`, opts: ["蔺相如", "廉颇", "赵括", "荆轲"], a: 0, tag: "lit" },
    { type: "vocab", q: `下列词语书写完全正确的是？`, opts: ["再接再厉", "再接再励", "迫不急待", "穿流不息"], a: 0, tag: "vocab", exp: "再接再厉，迫不及待，川流不息。" },
    { type: "lit", q: `被称为“诗圣”的是？`, opts: ["杜甫", "李白", "白居易", "王维"], a: 0, tag: "lit" },
    { type: "rhetoric", q: `“那翠绿的颜色，明亮地照耀着我们的眼睛”缩句正确的是？`, opts: ["颜色照耀着眼睛", "翠绿照耀着眼睛", "颜色照耀着我们", "明亮照耀着眼睛"], a: 0, tag: "logic" },
    { type: "lit", q: `孙悟空大闹天宫后被压在？`, opts: ["五行山下", "火焰山下", "灵山下", "花果山下"], a: 0, tag: "lit" }
  ]
};

// --- 3. RPG Systems (Heroes & Monsters) ---

const heroes = {
  scholar: { 
    name: "小书生", 
    avatar: "🎓", 
    hp: 100, 
    attack: 12, 
    passive: "【博闻强记】答对诗词类题目时，额外恢复 10 点生命。",
    skillName: "时间静止",
    skillDesc: "移除两个错误选项，并暂停 Boss 技能一回合。",
    skillCd: 3,
    typeBonus: "poem"
  },
  warrior: { 
    name: "文字游侠", 
    avatar: "🗡️", 
    hp: 140, 
    attack: 18, 
    passive: "【越战越勇】生命值低于 50% 时，攻击力提升 50%。",
    skillName: "破釜沉舟",
    skillDesc: "消耗 10% 当前生命，对敌人造成 300% 攻击力的真实伤害。",
    skillCd: 4,
    typeBonus: "idiom"
  },
  mage: { 
    name: "诗词法师", 
    avatar: "🔮", 
    hp: 90, 
    attack: 15, 
    passive: "【灵感迸发】连续答对 3 题后，下一次攻击必定暴击。",
    skillName: "万物复苏",
    skillDesc: "恢复 40% 最大生命值，并净化所有负面状态。",
    skillCd: 5,
    typeBonus: "char"
  }
};

const monsters = [
  { name: "错别字小妖", avatar: "👾", hp: 40, type: "vocab" },
  { name: "拼音蝙蝠", avatar: "🦇", hp: 50, type: "char" },
  { name: "成语独眼怪", avatar: "👹", hp: 70, type: "idiom" },
  { name: "诗词幽灵", avatar: "👻", hp: 60, type: "poem" },
  { name: "逻辑石头人", avatar: "🗿", hp: 90, type: "logic" }
];

const bosses = [
  { name: "墨汁大魔王", avatar: "🐙", hp: 200, skill: "ink_blind", desc: "技能：墨汁遮挡（屏幕变黑 2 秒）" },
  { name: "遗忘领主", avatar: "🧠", hp: 300, skill: "silence", desc: "技能：封印（无法使用技能）" },
  { name: "时间吞噬者", avatar: "⏳", hp: 400, skill: "time_warp", desc: "技能：时间加速（答题时间减半）" }
];

// --- 4. Game State & Logic ---

let gameState = {
  grade: 1,
  hero: 'scholar',
  level: 1,
  xp: 0,
  maxXp: 100,
  score: 0,
  highScore: parseInt(localStorage.getItem('chinese-legend-highscore') || 0),
  playerHp: 100,
  maxPlayerHp: 100,
  currentMonster: null,
  currentMonsterHp: 0,
  maxMonsterHp: 0,
  currentQuestion: null,
  streak: 0,
  skillCooldown: 0,
  statusEffects: [], // 'silence', 'blind'
  bossActive: false
};

// DOM Elements
const screens = document.querySelectorAll('.screen');
const gradeBtns = document.querySelectorAll('.grade-btn');
const heroCards = document.querySelectorAll('.hero-card');
const startBtn = document.getElementById('start-game-btn');
const restartBtn = document.getElementById('restart-btn');
const changeGradeBtn = document.getElementById('change-grade-btn');
const continueBtn = document.getElementById('continue-btn');
const skillBtn = document.getElementById('skill-btn');

const optionsContainer = document.getElementById('options-container');
const questionText = document.getElementById('question-text');
const playerHealthBar = document.getElementById('player-health');
const playerXpBar = document.getElementById('player-xp');
const enemyHealthBar = document.getElementById('enemy-health');
const enemyAvatar = document.getElementById('enemy-avatar');
const enemySprite = document.querySelector('.enemy-sprite');
const enemyName = document.getElementById('enemy-name');
const playerLevel = document.getElementById('player-level');
const streakCounter = document.querySelector('.streak-counter');
const streakNum = document.getElementById('streak-num');
const feedbackArea = document.getElementById('feedback-area');
const comboEffect = document.getElementById('combo-effect');
const damageText = document.querySelector('.damage-text');
const playerAvatarDisplay = document.getElementById('player-avatar-display');
const bossWarning = document.createElement('div'); // Dynamic element

// Modal Elements
const explanationModal = document.getElementById('explanation-modal');
const explanationTitle = document.getElementById('explanation-title');
const explanationText = document.getElementById('explanation-text');
const closeExplanationBtn = document.getElementById('close-explanation-btn');

// --- Initialization ---
function init() {
  bossWarning.className = 'boss-warning hidden';
  bossWarning.textContent = '⚠️ BOSS 来袭 ⚠️';
  document.querySelector('.battle-area').appendChild(bossWarning);
  
  updateSkillUI();
}

// Event Listeners
gradeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    gameState.grade = parseInt(btn.dataset.grade);
    showScreen('start-screen');
  });
});

heroCards.forEach(card => {
  card.addEventListener('click', () => {
    heroCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    gameState.hero = card.dataset.hero;
    // Update hero description dynamically if needed
  });
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
changeGradeBtn.addEventListener('click', () => showScreen('grade-screen'));
continueBtn.addEventListener('click', () => {
  showScreen('battle-screen');
  nextQuestion();
});

skillBtn.addEventListener('click', useSkill);
closeExplanationBtn.addEventListener('click', () => {
  explanationModal.classList.add('hidden');
  if (gameState.playerHp > 0) {
    nextQuestion();
  } else {
    gameOver();
  }
});

function showScreen(id) {
  screens.forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function startGame() {
  const heroStats = heroes[gameState.hero];
  gameState.maxPlayerHp = heroStats.hp;
  gameState.playerHp = heroStats.hp;
  playerAvatarDisplay.textContent = heroStats.avatar;
  
  document.querySelector('.skill-name').textContent = heroStats.skillName;
  gameState.skillCooldown = 0;
  gameState.statusEffects = [];
  updateSkillUI();

  gameState.level = 1;
  gameState.xp = 0;
  gameState.maxXp = 100;
  gameState.score = 0;
  gameState.streak = 0;
  
  if (audio.ctx.state === 'suspended') audio.ctx.resume();

  updateStats();
  showScreen('battle-screen');
  loadLevel();
}

function loadLevel() {
  const isBossLevel = gameState.level % 5 === 0;
  gameState.bossActive = isBossLevel;

  if (isBossLevel) {
    audio.playBossWarning();
    bossWarning.classList.remove('hidden');
    setTimeout(() => bossWarning.classList.add('hidden'), 2000);
    
    const bossIndex = Math.floor((gameState.level / 5) - 1) % bosses.length;
    const bossTemplate = bosses[bossIndex];
    gameState.currentMonster = { ...bossTemplate, isBoss: true };
    enemySprite.classList.add('boss-size');
  } else {
    const monsterTemplate = monsters[Math.floor(Math.random() * monsters.length)];
    gameState.currentMonster = { ...monsterTemplate, isBoss: false };
    enemySprite.classList.remove('boss-size');
  }

  // Scaling
  const scaleFactor = 1 + (gameState.level * 0.15);
  gameState.currentMonster.hp = Math.floor(gameState.currentMonster.hp * scaleFactor);
  gameState.maxMonsterHp = gameState.currentMonster.hp;
  gameState.currentMonsterHp = gameState.currentMonster.hp;

  // UI
  enemyAvatar.textContent = gameState.currentMonster.avatar;
  enemySprite.textContent = gameState.currentMonster.avatar;
  enemyName.textContent = gameState.currentMonster.name + ` (Lv.${gameState.level})`;
  if (gameState.currentMonster.isBoss) {
    enemyName.textContent += ` [${gameState.currentMonster.desc}]`;
  }
  playerLevel.textContent = gameState.level;
  
  updateStats();
  nextQuestion();
}

function getQuestionPool() {
  if (gameState.grade <= 2) return questionBank.low;
  if (gameState.grade <= 4) return questionBank.mid;
  return questionBank.high;
}

function nextQuestion() {
  const pool = getQuestionPool();
  // Random pick
  const q = pool[Math.floor(Math.random() * pool.length)];
  gameState.currentQuestion = q;
  
  questionText.innerHTML = q.q;
  optionsContainer.innerHTML = '';
  
  // Boss Effect: Ink Blind
  if (gameState.bossActive && gameState.currentMonster.skill === 'ink_blind') {
    document.querySelector('.question-area').classList.add('ink-blind');
    setTimeout(() => document.querySelector('.question-area').classList.remove('ink-blind'), 2000);
  }

  q.opts.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = opt;
    btn.onclick = () => handleAnswer(index);
    optionsContainer.appendChild(btn);
  });

  // Cooldown tick
  if (gameState.skillCooldown > 0) {
    gameState.skillCooldown--;
    updateSkillUI();
  }
}

function handleAnswer(selectedIndex) {
  const isCorrect = selectedIndex === gameState.currentQuestion.a;
  const hero = heroes[gameState.hero];
  
  if (isCorrect) {
    audio.playCorrect();
    gameState.streak++;
    gameState.score += 10 * gameState.streak;
    
    // Combo UI
    if (gameState.streak > 1) {
      streakCounter.classList.remove('hidden');
      streakNum.textContent = gameState.streak;
      comboEffect.classList.remove('hidden');
      comboEffect.textContent = `${gameState.streak} COMBO!`;
      setTimeout(() => comboEffect.classList.add('hidden'), 500);
    }

    showFeedback('✅', 'correct');
    
    // Damage Calculation
    let damage = hero.attack;
    let isCrit = false;

    // Passive: Warrior (Low HP Rage)
    if (gameState.hero === 'warrior' && gameState.playerHp < gameState.maxPlayerHp * 0.5) {
      damage *= 1.5;
      showFeedback('狂暴!', 'correct');
    }

    // Passive: Mage (Streak Crit)
    if (gameState.hero === 'mage' && gameState.streak >= 3) {
      isCrit = true;
      damage *= 2;
      showFeedback('法术暴击!', 'correct');
    }

    // Passive: Scholar (Heal on Poem)
    if (gameState.hero === 'scholar' && gameState.currentQuestion.tag === 'poem') {
      healPlayer(10);
      showFeedback('诗词回血', 'correct');
    }

    // Type Weakness Bonus
    if (hero.typeBonus === gameState.currentQuestion.tag) {
      damage *= 1.2;
    }

    // Combo Bonus
    if (gameState.streak > 2) damage *= 1.2;

    damageEnemy(Math.floor(damage), isCrit);
    gainXp(20);

  } else {
    audio.playWrong();
    gameState.streak = 0;
    streakCounter.classList.add('hidden');
    showFeedback('❌', 'wrong');
    
    // Boss Damage
    let incomingDmg = 15 + (gameState.level * 2);
    if (gameState.bossActive) incomingDmg *= 1.5;
    
    damagePlayer(Math.floor(incomingDmg));
    document.querySelector('.battle-area').classList.add('shake');
    setTimeout(() => document.querySelector('.battle-area').classList.remove('shake'), 500);
    
    setTimeout(() => showExplanation(false), 600);
  }
}

function useSkill() {
  if (gameState.skillCooldown > 0) return;
  if (gameState.statusEffects.includes('silence')) {
    showFeedback('被封印!', 'wrong');
    return;
  }
  
  audio.playSkill();
  const hero = heroes[gameState.hero];
  gameState.skillCooldown = hero.skillCd;
  updateSkillUI();
  
  if (gameState.hero === 'scholar') {
    // Time Freeze / Hint
    const buttons = Array.from(optionsContainer.children);
    let removed = 0;
    buttons.forEach((btn, idx) => {
      if (removed < 2 && idx !== gameState.currentQuestion.a) {
        btn.style.visibility = 'hidden';
        removed++;
      }
    });
    showFeedback('博学提示', 'correct');
  } else if (gameState.hero === 'warrior') {
    // Slay
    damagePlayer(Math.floor(gameState.playerHp * 0.1)); // Cost HP
    damageEnemy(hero.attack * 3, true);
    showFeedback('破釜沉舟!', 'correct');
  } else if (gameState.hero === 'mage') {
    // Heal & Cleanse
    healPlayer(Math.floor(gameState.maxPlayerHp * 0.4));
    gameState.statusEffects = [];
    showFeedback('净化治愈', 'correct');
  }
}

function showExplanation(isCorrect) {
  explanationTitle.textContent = isCorrect ? "回答正确" : "回答错误";
  explanationTitle.style.color = isCorrect ? "var(--success-color)" : "var(--danger-color)";
  
  const q = gameState.currentQuestion;
  const correctOpt = q.opts[q.a];
  
  let html = `<p><strong>正确答案：</strong> ${correctOpt}</p>`;
  if (q.exp) {
    html += `<p><strong>解析：</strong> ${q.exp}</p>`;
  } else {
    html += `<p><strong>解析：</strong> 暂无详细解析。</p>`;
  }
  
  explanationText.innerHTML = html;
  explanationModal.classList.remove('hidden');
}

function damageEnemy(amount, isCrit = false) {
  audio.playAttack();
  gameState.currentMonsterHp = Math.max(0, gameState.currentMonsterHp - amount);
  
  damageText.textContent = isCrit ? `暴击 -${amount}` : `-${amount}`;
  damageText.style.color = isCrit ? '#ef4444' : '#fff';
  damageText.style.fontSize = isCrit ? '2rem' : '1.5rem';
  damageText.classList.remove('hidden');
  
  damageText.style.animation = 'none';
  damageText.offsetHeight; 
  damageText.style.animation = null; 
  
  updateStats();
  
  enemySprite.classList.add('damage-effect');
  setTimeout(() => enemySprite.classList.remove('damage-effect'), 300);

  if (gameState.currentMonsterHp <= 0) {
    setTimeout(() => {
      gainXp(50 + (gameState.bossActive ? 100 : 0));
      gameState.level++;
      loadLevel();
    }, 800);
  } else {
    setTimeout(nextQuestion, 800);
  }
}

function damagePlayer(amount) {
  gameState.playerHp = Math.max(0, gameState.playerHp - amount);
  updateStats();
  if (gameState.playerHp <= 0) {
    // Game Over handled by modal close or immediate
  }
}

function healPlayer(amount) {
  gameState.playerHp = Math.min(gameState.maxPlayerHp, gameState.playerHp + amount);
  updateStats();
}

function gainXp(amount) {
  gameState.xp += amount;
  if (gameState.xp >= gameState.maxXp) {
    gameState.xp -= gameState.maxXp;
    gameState.maxXp = Math.floor(gameState.maxXp * 1.2);
    gameState.maxPlayerHp += 20;
    gameState.playerHp = gameState.maxPlayerHp;
    document.getElementById('new-level').textContent = gameState.level + 1;
    showScreen('levelup-screen');
  }
  updateStats();
}

function updateStats() {
  const playerPct = (gameState.playerHp / gameState.maxPlayerHp) * 100;
  const enemyPct = (gameState.currentMonsterHp / gameState.maxMonsterHp) * 100;
  const xpPct = (gameState.xp / gameState.maxXp) * 100;
  
  playerHealthBar.style.width = `${playerPct}%`;
  enemyHealthBar.style.width = `${enemyPct}%`;
  playerXpBar.style.width = `${xpPct}%`;
}

function updateSkillUI() {
  const hero = heroes[gameState.hero];
  const overlay = document.querySelector('.skill-cooldown-overlay');
  
  if (gameState.skillCooldown > 0) {
    skillBtn.disabled = true;
    const pct = (gameState.skillCooldown / hero.skillCd) * 100;
    overlay.style.height = `${pct}%`;
    document.querySelector('.skill-name').textContent = `${gameState.skillCooldown}回合`;
  } else {
    skillBtn.disabled = false;
    overlay.style.height = '0%';
    document.querySelector('.skill-name').textContent = hero.skillName;
  }
}

function showFeedback(text, type) {
  feedbackArea.textContent = text;
  feedbackArea.className = `feedback ${type}`;
  feedbackArea.classList.remove('hidden');
  setTimeout(() => {
    feedbackArea.classList.add('hidden');
  }, 600);
}

function gameOver() {
  if (gameState.score > gameState.highScore) {
    gameState.highScore = gameState.score;
    localStorage.setItem('chinese-legend-highscore', gameState.highScore);
  }
  document.getElementById('game-over-score').textContent = `最终得分: ${gameState.score}`;
  document.getElementById('game-over-high').textContent = `历史最高: ${gameState.highScore}`;
  showScreen('game-over-screen');
}

// Start
init();

