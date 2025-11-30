// Sound Manager (Web Audio API)
class SoundManager {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.enabled = true;
  }

  playTone(freq, type, duration, startTime = 0) {
    if (!this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime + startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + startTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(this.ctx.currentTime + startTime);
    osc.stop(this.ctx.currentTime + startTime + duration);
  }

  playCorrect() {
    this.playTone(523.25, 'sine', 0.1, 0); // C5
    this.playTone(659.25, 'sine', 0.2, 0.1); // E5
  }

  playWrong() {
    this.playTone(150, 'sawtooth', 0.3, 0);
    this.playTone(100, 'sawtooth', 0.3, 0.1);
  }

  playAttack() {
    this.playTone(100, 'square', 0.1, 0);
    this.playTone(50, 'square', 0.2, 0.05);
  }

  playLevelUp() {
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      this.playTone(freq, 'triangle', 0.3, i * 0.1);
    });
  }
}

const audio = new SoundManager();

// Game Data
const questionsByGrade = {
  1: [
    {
      question: "“<ruby>人<rt>rén</rt></ruby>”字的笔画数是？",
      options: ["1画", "2画", "3画", "4画"],
      answer: 1,
      explanation: "“人”字共两画：撇、捺。"
    },
    {
      question: "“<ruby>大<rt>dà</rt></ruby>”的反义词是？",
      options: ["<ruby>小<rt>xiǎo</rt></ruby>", "<ruby>多<rt>duō</rt></ruby>", "<ruby>少<rt>shǎo</rt></ruby>", "<ruby>高<rt>gāo</rt></ruby>"],
      answer: 0,
      explanation: "大对小，多对少，高对矮。"
    },
    {
      question: "选出正确的拼音：<ruby>妈<rt>mā</rt></ruby>",
      options: ["mā", "má", "mǎ", "mà"],
      answer: 0,
      explanation: "妈妈（mā ma），第一声。"
    },
    {
      question: "“<ruby>白<rt>bái</rt></ruby><ruby>日<rt>rì</rt></ruby><ruby>依<rt>yī</rt></ruby><ruby>山<rt>shān</rt></ruby><ruby>尽<rt>jìn</rt></ruby>”的下一句？",
      options: ["<ruby>黄<rt>huáng</rt></ruby><ruby>河<rt>hé</rt></ruby><ruby>入<rt>rù</rt></ruby><ruby>海<rt>hǎi</rt></ruby><ruby>流<rt>liú</rt></ruby>", "<ruby>欲<rt>yù</rt></ruby><ruby>穷<rt>qióng</rt></ruby><ruby>千<rt>qiān</rt></ruby><ruby>里<rt>lǐ</rt></ruby><ruby>目<rt>mù</rt></ruby>", "<ruby>更<rt>gèng</rt></ruby><ruby>上<rt>shàng</rt></ruby><ruby>一<rt>yī</rt></ruby><ruby>层<rt>céng</rt></ruby><ruby>楼<rt>lóu</rt></ruby>", "<ruby>疑<rt>yí</rt></ruby><ruby>是<rt>shì</rt></ruby><ruby>地<rt>dì</rt></ruby><ruby>上<rt>shàng</rt></ruby><ruby>霜<rt>shuāng</rt></ruby>"],
      answer: 0,
      explanation: "出自王之涣《登鹳雀楼》。"
    },
    {
      question: "“<ruby>一<rt>yī</rt></ruby><ruby>去<rt>qù</rt></ruby><ruby>二<rt>èr</rt></ruby><ruby>三<rt>sān</rt></ruby><ruby>里<rt>lǐ</rt></ruby>”的下一句？",
      options: ["<ruby>烟<rt>yān</rt></ruby><ruby>村<rt>cūn</rt></ruby><ruby>四<rt>sì</rt></ruby><ruby>五<rt>wǔ</rt></ruby><ruby>家<rt>jiā</rt></ruby>", "<ruby>亭<rt>tíng</rt></ruby><ruby>台<rt>tái</rt></ruby><ruby>六<rt>liù</rt></ruby><ruby>七<rt>qī</rt></ruby><ruby>座<rt>zuò</rt></ruby>", "<ruby>八<rt>bā</rt></ruby><ruby>九<rt>jiǔ</rt></ruby><ruby>十<rt>shí</rt></ruby><ruby>枝<rt>zhī</rt></ruby><ruby>花<rt>huā</rt></ruby>", "<ruby>举<rt>jǔ</rt></ruby><ruby>头<rt>tóu</rt></ruby><ruby>望<rt>wàng</rt></ruby><ruby>明<rt>míng</rt></ruby><ruby>月<rt>yuè</rt></ruby>"],
      answer: 0,
      explanation: "出自邵雍《山村咏怀》。"
    }
  ],
  2: [
    {
      question: "“床前明月光”的下一句是？",
      options: ["疑是地上霜", "低头思故乡", "举头望明月", "红掌拨清波"],
      answer: 0,
      explanation: "出自李白《静夜思》。"
    },
    {
      question: "选出书写正确的词语：",
      options: ["己经", "已经", "已径", "已经"],
      answer: 1,
      explanation: "“已”表示过去，“己”表示自己。"
    },
    {
      question: "“遥知不是雪”的下一句是？",
      options: ["为有暗香来", "凌寒独自开", "墙角数枝梅", "千山鸟飞绝"],
      answer: 0,
      explanation: "出自王安石《梅花》。"
    },
    {
      question: "“儿童散学归来早”的下一句是？",
      options: ["忙趁东风放纸鸢", "飞入菜花无处寻", "小荷才露尖尖角", "早有蜻蜓立上头"],
      answer: 0,
      explanation: "出自高鼎《村居》。"
    }
  ],
  3: [
    {
      question: "“飞流直下三千尺”的下一句是？",
      options: ["疑是银河落九天", "轻舟已过万重山", "不及汪伦送我情", "早有蜻蜓立上头"],
      answer: 0,
      explanation: "出自李白《望庐山瀑布》。"
    },
    {
      question: "“停车坐爱枫林晚”的下一句是？",
      options: ["霜叶红于二月花", "客路青山外", "江枫渔火对愁眠", "夜半钟声到客船"],
      answer: 0,
      explanation: "出自杜牧《山行》。"
    },
    {
      question: "下列哪个词语是描写春天的？",
      options: ["春暖花开", "秋高气爽", "大雪纷飞", "烈日炎炎"],
      answer: 0,
      explanation: "其他分别描写秋、冬、夏。"
    },
    {
      question: "《绝句》“两个黄鹂鸣翠柳”的作者是？",
      options: ["杜甫", "李白", "王维", "白居易"],
      answer: 0,
      explanation: "杜甫，字子美，唐代伟大现实主义诗人。"
    }
  ],
  4: [
    {
      question: "《题西林壁》的作者是？",
      options: ["李白", "杜甫", "苏轼", "白居易"],
      answer: 2,
      explanation: "苏轼，号东坡居士，宋代文学家。"
    },
    {
      question: "“横看成岭侧成峰”的下一句是？",
      options: ["远近高低各不同", "不识庐山真面目", "只缘身在此山中", "柳暗花明又一村"],
      answer: 0,
      explanation: "这首诗描写了庐山雄奇壮丽的景色。"
    },
    {
      question: "“劝君更尽一杯酒”的下一句是？",
      options: ["西出阳关无故人", "天下谁人不识君", "西出阳关无古人", "莫愁前路无知己"],
      answer: 0,
      explanation: "出自王维《送元二使安西》。"
    },
    {
      question: "下列哪个成语故事与项羽有关？",
      options: ["破釜沉舟", "卧薪尝胆", "三顾茅庐", "负荆请罪"],
      answer: 0,
      explanation: "破釜沉舟出自巨鹿之战。卧薪尝胆-勾践，三顾茅庐-刘备，负荆请罪-廉颇。"
    }
  ],
  5: [
    {
      question: "下列哪个成语形容“非常安静”？",
      options: ["鸦雀无声", "人声鼎沸", "震耳欲聋", "响彻云霄"],
      answer: 0,
      explanation: "鸦雀无声：连乌鸦麻雀的声音都没有。形容非常静。"
    },
    {
      question: "《草船借箭》选自哪部名著？",
      options: ["《红楼梦》", "《西游记》", "《水浒传》", "《三国演义》"],
      answer: 3,
      explanation: "《三国演义》作者罗贯中。"
    },
    {
      question: "“粉身碎骨浑不怕”的下一句是？",
      options: ["要留清白在人间", "留取丹心照汗青", "化作春泥更护花", "只留清气满乾坤"],
      answer: 0,
      explanation: "出自于谦《石灰吟》。"
    },
    {
      question: "下列不属于“四大名著”的是？",
      options: ["《聊斋志异》", "《红楼梦》", "《西游记》", "《三国演义》"],
      answer: 0,
      explanation: "四大名著：《红楼梦》《西游记》《水浒传》《三国演义》。"
    }
  ],
  6: [
    {
      question: "“人生自古谁无死”的下一句是？",
      options: ["留取丹心照汗青", "要留清白在人间", "粉骨碎身浑不怕", "化作春泥更护花"],
      answer: 0,
      explanation: "出自文天祥《过零丁洋》。"
    },
    {
      question: "鲁迅的原名是？",
      options: ["周树人", "周作人", "冰心", "老舍"],
      answer: 0,
      explanation: "鲁迅，原名周树人，字豫才。"
    },
    {
      question: "“落红不是无情物”的下一句是？",
      options: ["化作春泥更护花", "留取丹心照汗青", "蜡炬成灰泪始干", "春蚕到死丝方尽"],
      answer: 0,
      explanation: "出自龚自珍《己亥杂诗》。"
    },
    {
      question: "下列哪个字读音不同？",
      options: ["折(shé)本", "折(zhé)断", "折(zhé)磨", "曲折(zhé)"],
      answer: 0,
      explanation: "折本(shé)，其他读(zhé)。"
    }
  ]
};

const monsters = [
  { name: "错别字怪兽", avatar: "👾", hp: 30 },
  { name: "诗词幽灵", avatar: "👻", hp: 40 },
  { name: "成语魔王", avatar: "👹", hp: 60 },
  { name: "文言文巨龙", avatar: "🐉", hp: 100 }
];

const heroes = {
  scholar: { 
    name: "小书生", 
    avatar: "🎓", 
    hp: 100, 
    attack: 10, 
    skillName: "博学提示",
    skillDesc: "排除两个错误选项",
    skillCd: 3 
  },
  warrior: { 
    name: "文字游侠", 
    avatar: "🗡️", 
    hp: 120, 
    attack: 15, 
    skillName: "会心一击",
    skillDesc: "下一次攻击造成3倍伤害",
    skillCd: 4 
  },
  mage: { 
    name: "诗词法师", 
    avatar: "🔮", 
    hp: 80, 
    attack: 12, 
    skillName: "治愈之光",
    skillDesc: "恢复30%生命值",
    skillCd: 3 
  }
};

let gameState = {
  grade: 1,
  hero: 'scholar',
  level: 1,
  xp: 0,
  maxXp: 100,
  score: 0,
  highScore: localStorage.getItem('chinese-legend-highscore') || 0,
  playerHp: 100,
  maxPlayerHp: 100,
  currentMonster: null,
  currentMonsterHp: 0,
  maxMonsterHp: 0,
  currentQuestion: null,
  streak: 0,
  skillReady: false,
  skillCooldown: 0,
  nextAttackMultiplier: 1
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

// Modal Elements
const explanationModal = document.getElementById('explanation-modal');
const explanationTitle = document.getElementById('explanation-title');
const explanationText = document.getElementById('explanation-text');
const closeExplanationBtn = document.getElementById('close-explanation-btn');

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
  // Init Hero Stats
  const heroStats = heroes[gameState.hero];
  gameState.maxPlayerHp = heroStats.hp;
  gameState.playerHp = heroStats.hp;
  playerAvatarDisplay.textContent = heroStats.avatar;
  
  // Init Skill UI
  document.querySelector('.skill-name').textContent = heroStats.skillName;
  gameState.skillCooldown = 0;
  updateSkillUI();

  gameState.level = 1;
  gameState.xp = 0;
  gameState.maxXp = 100;
  gameState.score = 0;
  gameState.streak = 0;
  gameState.nextAttackMultiplier = 1;
  
  // Resume Audio Context if needed
  if (audio.ctx.state === 'suspended') {
    audio.ctx.resume();
  }

  updateStats();
  showScreen('battle-screen');
  loadLevel();
}

function loadLevel() {
  // Select monster based on level
  const monsterTemplate = monsters[(gameState.level - 1) % monsters.length];
  gameState.currentMonster = { ...monsterTemplate };
  // Scale monster HP
  gameState.currentMonster.hp += (gameState.level - 1) * 20;
  gameState.maxMonsterHp = gameState.currentMonster.hp;
  gameState.currentMonsterHp = gameState.currentMonster.hp;

  // Update UI
  enemyAvatar.textContent = gameState.currentMonster.avatar;
  enemySprite.textContent = gameState.currentMonster.avatar;
  enemyName.textContent = gameState.currentMonster.name + ` (Lv.${gameState.level})`;
  playerLevel.textContent = gameState.level;
  
  updateStats();
  nextQuestion();
}

function nextQuestion() {
  // Get questions for current grade
  const gradeQuestions = questionsByGrade[gameState.grade] || questionsByGrade[1];
  const qIndex = Math.floor(Math.random() * gradeQuestions.length);
  gameState.currentQuestion = gradeQuestions[qIndex];
  
  questionText.innerHTML = gameState.currentQuestion.question;
  optionsContainer.innerHTML = '';
  
  gameState.currentQuestion.options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = opt;
    btn.onclick = () => handleAnswer(index);
    optionsContainer.appendChild(btn);
  });

  // Reduce cooldown
  if (gameState.skillCooldown > 0) {
    gameState.skillCooldown--;
    updateSkillUI();
  }
}

function handleAnswer(selectedIndex) {
  const isCorrect = selectedIndex === gameState.currentQuestion.answer;
  
  if (isCorrect) {
    audio.playCorrect();
    gameState.streak++;
    gameState.score += 10 * gameState.streak;
    
    // Combo visual
    if (gameState.streak > 1) {
      streakCounter.classList.remove('hidden');
      streakNum.textContent = gameState.streak;
      comboEffect.classList.remove('hidden');
      comboEffect.textContent = `${gameState.streak} COMBO!`;
      setTimeout(() => comboEffect.classList.add('hidden'), 500);
    }

    showFeedback('✅', 'correct');
    
    // Calculate Damage
    let damage = heroes[gameState.hero].attack;
    if (gameState.streak > 2) damage *= 1.5; // Combo bonus
    if (gameState.hero === 'warrior') damage *= 1.2; // Class bonus
    
    // Apply Skill Multiplier
    damage *= gameState.nextAttackMultiplier;
    gameState.nextAttackMultiplier = 1; // Reset

    damageEnemy(Math.floor(damage));
    gainXp(20);

  } else {
    audio.playWrong();
    gameState.streak = 0;
    streakCounter.classList.add('hidden');
    showFeedback('❌', 'wrong');
    damagePlayer(15);
    document.querySelector('.battle-area').classList.add('shake');
    setTimeout(() => document.querySelector('.battle-area').classList.remove('shake'), 500);
    
    // Show explanation on wrong answer
    setTimeout(() => showExplanation(false), 600);
  }
}

function showExplanation(isCorrect) {
  explanationTitle.textContent = isCorrect ? "回答正确" : "回答错误";
  explanationTitle.style.color = isCorrect ? "var(--success-color)" : "var(--danger-color)";
  
  const q = gameState.currentQuestion;
  const correctOpt = q.options[q.answer];
  
  let html = `<p><strong>正确答案：</strong> ${correctOpt}</p>`;
  if (q.explanation) {
    html += `<p><strong>解析：</strong> ${q.explanation}</p>`;
  }
  
  explanationText.innerHTML = html;
  explanationModal.classList.remove('hidden');
}

function useSkill() {
  if (gameState.skillCooldown > 0) return;
  
  const hero = heroes[gameState.hero];
  gameState.skillCooldown = hero.skillCd;
  updateSkillUI();
  
  // Skill Effects
  if (gameState.hero === 'scholar') {
    // Remove 2 wrong options
    const buttons = Array.from(optionsContainer.children);
    let removed = 0;
    buttons.forEach((btn, idx) => {
      if (removed < 2 && idx !== gameState.currentQuestion.answer) {
        btn.style.visibility = 'hidden';
        removed++;
      }
    });
    showFeedback('博学提示！', 'correct');
  } else if (gameState.hero === 'warrior') {
    gameState.nextAttackMultiplier = 3;
    showFeedback('蓄力中！', 'correct');
  } else if (gameState.hero === 'mage') {
    const heal = Math.floor(gameState.maxPlayerHp * 0.3);
    gameState.playerHp = Math.min(gameState.maxPlayerHp, gameState.playerHp + heal);
    updateStats();
    showFeedback(`回复 ${heal} HP`, 'correct');
  }
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

function damageEnemy(amount) {
  audio.playAttack();
  gameState.currentMonsterHp = Math.max(0, gameState.currentMonsterHp - amount);
  
  // Show damage number
  damageText.textContent = `-${amount}`;
  damageText.classList.remove('hidden');
  // Reset animation
  damageText.style.animation = 'none';
  damageText.offsetHeight; /* trigger reflow */
  damageText.style.animation = null; 
  
  updateStats();
  
  // Visual effect
  enemySprite.classList.add('damage-effect');
  setTimeout(() => enemySprite.classList.remove('damage-effect'), 300);

  if (gameState.currentMonsterHp <= 0) {
    setTimeout(() => {
      // Monster defeated
      gainXp(50);
      gameState.level++; // Simple level up for monster scaling
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
    // Wait for modal close if it's open, otherwise game over
    // Actually, modal handles game over on close
  } else {
    // Wait for modal close
  }
}

function gainXp(amount) {
  gameState.xp += amount;
  if (gameState.xp >= gameState.maxXp) {
    audio.playLevelUp();
    gameState.xp -= gameState.maxXp;
    gameState.maxXp = Math.floor(gameState.maxXp * 1.2);
    // Level Up Event
    gameState.maxPlayerHp += 20;
    gameState.playerHp = gameState.maxPlayerHp;
    document.getElementById('new-level').textContent = gameState.level + 1; // Visual level
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

function gameOver() {
  if (gameState.score > gameState.highScore) {
    gameState.highScore = gameState.score;
    localStorage.setItem('chinese-legend-highscore', gameState.highScore);
  }
  document.getElementById('game-over-score').textContent = `最终得分: ${gameState.score}`;
  document.getElementById('game-over-high').textContent = `历史最高: ${gameState.highScore}`;
  showScreen('game-over-screen');
}
