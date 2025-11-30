// Game Data
const questionsByGrade = {
  1: [
    {
      question: "“<ruby>人<rt>rén</rt></ruby>”字的笔画数是？",
      options: ["1画", "2画", "3画", "4画"],
      answer: 1
    },
    {
      question: "“<ruby>大<rt>dà</rt></ruby>”的反义词是？",
      options: ["<ruby>小<rt>xiǎo</rt></ruby>", "<ruby>多<rt>duō</rt></ruby>", "<ruby>少<rt>shǎo</rt></ruby>", "<ruby>高<rt>gāo</rt></ruby>"],
      answer: 0
    },
    {
      question: "选出正确的拼音：<ruby>妈<rt>mā</rt></ruby>",
      options: ["mā", "má", "mǎ", "mà"],
      answer: 0
    },
    {
      question: "“<ruby>白<rt>bái</rt></ruby><ruby>日<rt>rì</rt></ruby><ruby>依<rt>yī</rt></ruby><ruby>山<rt>shān</rt></ruby><ruby>尽<rt>jìn</rt></ruby>”的下一句？",
      options: ["<ruby>黄<rt>huáng</rt></ruby><ruby>河<rt>hé</rt></ruby><ruby>入<rt>rù</rt></ruby><ruby>海<rt>hǎi</rt></ruby><ruby>流<rt>liú</rt></ruby>", "<ruby>欲<rt>yù</rt></ruby><ruby>穷<rt>qióng</rt></ruby><ruby>千<rt>qiān</rt></ruby><ruby>里<rt>lǐ</rt></ruby><ruby>目<rt>mù</rt></ruby>", "<ruby>更<rt>gèng</rt></ruby><ruby>上<rt>shàng</rt></ruby><ruby>一<rt>yī</rt></ruby><ruby>层<rt>céng</rt></ruby><ruby>楼<rt>lóu</rt></ruby>", "<ruby>疑<rt>yí</rt></ruby><ruby>是<rt>shì</rt></ruby><ruby>地<rt>dì</rt></ruby><ruby>上<rt>shàng</rt></ruby><ruby>霜<rt>shuāng</rt></ruby>"],
      answer: 0
    }
  ],
  2: [
    {
      question: "“床前明月光”的下一句是？",
      options: ["疑是地上霜", "低头思故乡", "举头望明月", "红掌拨清波"],
      answer: 0
    },
    {
      question: "选出书写正确的词语：",
      options: ["己经", "已经", "已径", "已经"],
      answer: 1
    }
  ],
  3: [
    {
      question: "“飞流直下三千尺”的下一句是？",
      options: ["疑是银河落九天", "轻舟已过万重山", "不及汪伦送我情", "早有蜻蜓立上头"],
      answer: 0
    },
    {
      question: "“停车坐爱枫林晚”的下一句是？",
      options: ["霜叶红于二月花", "客路青山外", "江枫渔火对愁眠", "夜半钟声到客船"],
      answer: 0
    }
  ],
  4: [
    {
      question: "《题西林壁》的作者是？",
      options: ["李白", "杜甫", "苏轼", "白居易"],
      answer: 2
    },
    {
      question: "“横看成岭侧成峰”的下一句是？",
      options: ["远近高低各不同", "不识庐山真面目", "只缘身在此山中", "柳暗花明又一村"],
      answer: 0
    }
  ],
  5: [
    {
      question: "下列哪个成语形容“非常安静”？",
      options: ["鸦雀无声", "人声鼎沸", "震耳欲聋", "响彻云霄"],
      answer: 0
    },
    {
      question: "《草船借箭》选自哪部名著？",
      options: ["《红楼梦》", "《西游记》", "《水浒传》", "《三国演义》"],
      answer: 3
    }
  ],
  6: [
    {
      question: "“人生自古谁无死”的下一句是？",
      options: ["留取丹心照汗青", "要留清白在人间", "粉骨碎身浑不怕", "化作春泥更护花"],
      answer: 0
    },
    {
      question: "鲁迅的原名是？",
      options: ["周树人", "周作人", "冰心", "老舍"],
      answer: 0
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
  scholar: { name: "小书生", avatar: "🎓", hp: 100, attack: 10, skill: "博学" },
  warrior: { name: "文字游侠", avatar: "🗡️", hp: 120, attack: 15, skill: "重击" },
  mage: { name: "诗词法师", avatar: "🔮", hp: 80, attack: 12, skill: "连击" }
};

let gameState = {
  grade: 1,
  hero: 'scholar',
  level: 1,
  xp: 0,
  maxXp: 100,
  score: 0,
  highScore: 0,
  playerHp: 100,
  maxPlayerHp: 100,
  currentMonster: null,
  currentMonsterHp: 0,
  maxMonsterHp: 0,
  currentQuestion: null,
  streak: 0
};

// DOM Elements
const screens = document.querySelectorAll('.screen');
const gradeBtns = document.querySelectorAll('.grade-btn');
const heroCards = document.querySelectorAll('.hero-card');
const startBtn = document.getElementById('start-game-btn');
const restartBtn = document.getElementById('restart-btn');
const changeGradeBtn = document.getElementById('change-grade-btn');
const continueBtn = document.getElementById('continue-btn');

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

// Audio (Placeholder)
const sfx = {
  correct: new Audio(),
  wrong: new Audio(),
  levelup: new Audio()
};

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

  gameState.level = 1;
  gameState.xp = 0;
  gameState.maxXp = 100;
  gameState.score = 0;
  gameState.streak = 0;
  
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
  
  questionText.innerHTML = gameState.currentQuestion.question; // Use innerHTML for ruby tags
  optionsContainer.innerHTML = '';
  
  gameState.currentQuestion.options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = opt; // Use innerHTML for ruby tags
    btn.onclick = () => handleAnswer(index);
    optionsContainer.appendChild(btn);
  });
}

function handleAnswer(selectedIndex) {
  const isCorrect = selectedIndex === gameState.currentQuestion.answer;
  
  if (isCorrect) {
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
    
    damageEnemy(Math.floor(damage));
    gainXp(20);

  } else {
    gameState.streak = 0;
    streakCounter.classList.add('hidden');
    showFeedback('❌', 'wrong');
    damagePlayer(15);
    document.querySelector('.battle-area').classList.add('shake');
    setTimeout(() => document.querySelector('.battle-area').classList.remove('shake'), 500);
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
    setTimeout(gameOver, 500);
  } else {
    setTimeout(nextQuestion, 800);
  }
}

function gainXp(amount) {
  gameState.xp += amount;
  if (gameState.xp >= gameState.maxXp) {
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
  }
  document.getElementById('game-over-score').textContent = `最终得分: ${gameState.score}`;
  document.getElementById('game-over-high').textContent = `历史最高: ${gameState.highScore}`;
  showScreen('game-over-screen');
}
