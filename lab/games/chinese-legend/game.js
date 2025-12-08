class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Lower volume
        this.masterGain.connect(this.ctx.destination);
    }

    playTone(freq, type, duration) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(this.masterGain);
        
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playAttack() { this.playTone(150, 'sawtooth', 0.1); }
    playHit() { this.playTone(100, 'square', 0.2); }
    playCorrect() { 
        this.playTone(600, 'sine', 0.1); 
        setTimeout(() => this.playTone(800, 'sine', 0.2), 100);
    }
    playWrong() { this.playTone(150, 'sawtooth', 0.3); }
    playWin() {
        [400, 500, 600, 800].forEach((f, i) => setTimeout(() => this.playTone(f, 'triangle', 0.2), i * 150));
    }
}

class Game {
    constructor() {
        // Default State (New Game)
        this.defaultState = {
            screen: 'start',
            grade: 1,
            player: {
                hp: 100,
                maxHp: 100,
                ink: 100,
                maxInk: 100,
                stats: { atk: 20, def: 10, spd: 10, crit: 0.1 },
                level: 1,
                exp: 0
            },
            enemy: {
                hp: 100,
                maxHp: 100,
                stats: { atk: 15, def: 5, spd: 8 }
            },
            combat: {
                turn: 'player', // player, enemy
                phase: 'select', // select, attack_quiz, defense_quiz
                selectedSkill: null,
                currentQuestion: null,
                questionStartTime: 0,
                turnCount: 0,
                usedQuestionIds: [] // Track used questions to avoid repeats
            },
            currentLevel: 0,
            currentLevelData: null,
            levels: [
                { id: 1, name: "1-1 初入墨林", enemyName: "错别字小怪", hp: 100, atk: 15, boss: false },
                { id: 2, name: "1-2 墨迹深处", enemyName: "偏旁部首怪", hp: 140, atk: 20, boss: false },
                { id: 3, name: "1-3 墨魇领主", enemyName: "多音字魔王", hp: 250, atk: 25, boss: true, ability: 'rage' }
            ],
            progress: {
                unlockedLevels: [1],
                completedLevels: []
            },
            collection: {
                spirits: [] // Array of spirit IDs
            },
            questionBank: []
        };

        this.spiritData = [
            { id: 'spirit_lei', name: '雷', type: 'Attack', icon: '⚡', desc: 'Chance to splash damage' },
            { id: 'spirit_feng', name: '风', type: 'Speed', icon: '💨', desc: 'Increase evasion' },
            { id: 'spirit_shui', name: '水', type: 'Heal', icon: '💧', desc: 'Passive healing' },
            { id: 'spirit_huo', name: '火', type: 'Attack', icon: '🔥', desc: 'Burn damage' },
            { id: 'spirit_shan', name: '山', type: 'Defense', icon: '⛰️', desc: 'Reduce damage taken' }
        ];

        this.state = JSON.parse(JSON.stringify(this.defaultState)); // Deep copy
        this.loadSaveData();

        this.sound = new SoundManager();

        this.dom = {
            screens: document.querySelectorAll('.screen'),
            startBtn: document.getElementById('start-btn'),
            gradeBtns: document.querySelectorAll('.grade-btn'),
            playerHp: document.getElementById('player-hp'),
            playerInk: document.getElementById('player-ink'),
            enemyHp: document.getElementById('enemy-hp'),
            skillMenu: document.getElementById('skill-menu'),
            questionPanel: document.getElementById('question-panel'),
            qText: document.getElementById('q-text'),
            qOptions: document.getElementById('q-options'),
            damageDisplay: document.getElementById('damage-display'),
            playerChar: document.getElementById('player-char'),
            enemyChar: document.getElementById('enemy-char'),
            backMapBtn: document.getElementById('back-map-btn'),
            nextLevelBtn: document.getElementById('next-level-btn'),
            mapNodes: document.querySelector('.map-nodes'),
            backToMenuBtn: document.getElementById('back-to-menu-btn'),
            stageName: document.getElementById('stage-name'),
            enemyName: document.getElementById('enemy-name'),
            // Spirit Dex UI
            spiritDexBtn: document.getElementById('spirit-dex-btn'),
            mapDexBtn: document.getElementById('map-dex-btn'),
            closeDexBtn: document.getElementById('close-dex-btn'),
            spiritGrid: document.getElementById('spirit-grid')
        };

        this.init();
    }

    loadSaveData() {
        const saved = localStorage.getItem('chinese_legend_save_v3');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge saved progress into state
            this.state.progress = parsed.progress;
            this.state.player.level = parsed.player.level;
            this.state.player.stats = parsed.player.stats;
            this.state.grade = parsed.grade || 1;
            if (parsed.collection) {
                this.state.collection = parsed.collection;
            }
            console.log("Save data loaded");
        }
    }

    saveData() {
        const dataToSave = {
            progress: this.state.progress,
            player: {
                level: this.state.player.level,
                stats: this.state.player.stats
            },
            grade: this.state.grade,
            collection: this.state.collection
        };
        localStorage.setItem('chinese_legend_save_v3', JSON.stringify(dataToSave));
    }

    init() {
        // Grade Selection
        this.dom.gradeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.dom.gradeBtns.forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
                this.state.grade = parseInt(e.target.dataset.grade);
            });
        });

        // Start Game -> Map
        this.dom.startBtn.addEventListener('click', () => {
            this.sound.ctx.resume(); // Unlock audio context
            this.loadQuestions().then(() => this.showMap());
        });

        // Back to Menu
        this.dom.backToMenuBtn.addEventListener('click', () => this.switchScreen('start'));

        // Spirit Dex Buttons
        const openDex = () => this.showSpiritDex();
        if (this.dom.spiritDexBtn) this.dom.spiritDexBtn.addEventListener('click', openDex);
        if (this.dom.mapDexBtn) this.dom.mapDexBtn.addEventListener('click', openDex);
        if (this.dom.closeDexBtn) this.dom.closeDexBtn.addEventListener('click', () => {
            // Return to previous screen (simple logic: if game started, go map, else start)
            if (this.state.currentLevel > 0) {
                this.switchScreen('map');
            } else {
                this.switchScreen('start');
            }
        });

        // Skill Selection
        document.querySelectorAll('.skill-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (card.classList.contains('disabled')) return;
                const type = card.dataset.type; // attack, skill, heal
                this.useSkill(type);
            });
        });

        // Result Screen Buttons
        if (this.dom.backMapBtn) {
            this.dom.backMapBtn.addEventListener('click', () => this.showMap());
        }
        if (this.dom.nextLevelBtn) {
            this.dom.nextLevelBtn.addEventListener('click', () => this.goToNextLevel());
        }

        // Default selection
        this.dom.gradeBtns[0].click();
    }

    showMap() {
        this.switchScreen('map');
        this.dom.mapNodes.innerHTML = '';
        
        this.state.levels.forEach(level => {
            const node = document.createElement('div');
            node.className = 'map-node';
            node.textContent = level.id;
            
            if (this.state.progress.unlockedLevels.includes(level.id)) {
                node.classList.add('unlocked');
                node.onclick = () => this.startLevel(level);
            }

            if (this.state.progress.completedLevels.includes(level.id)) {
                node.classList.add('completed');
            }
            
            if (level.boss) node.classList.add('boss');
            
            this.dom.mapNodes.appendChild(node);
        });
    }

    startLevel(levelData) {
        this.state.currentLevel = levelData.id;
        this.state.currentLevelData = levelData;
        this.state.combat.turnCount = 0;
        
        // Init Enemy Stats
        this.state.enemy.maxHp = levelData.hp;
        this.state.enemy.hp = levelData.hp;
        this.state.enemy.stats.atk = levelData.atk || 15;

        // Boss UI Handling
        const bossHpContainer = document.getElementById('boss-hp-container');
        const normalHpContainer = document.querySelector('.enemy-status .hp-bar-container');
        
        if (levelData.boss) {
            this.dom.enemyChar.classList.add('boss');
            bossHpContainer.style.display = 'block';
            normalHpContainer.style.display = 'none';
        } else {
            this.dom.enemyChar.classList.remove('boss');
            bossHpContainer.style.display = 'none';
            normalHpContainer.style.display = 'flex';
        }

        // Reset Player Combat State
        this.state.player.hp = this.state.player.maxHp; 
        this.state.player.ink = this.state.player.maxInk;
        
        this.dom.stageName.textContent = levelData.name;
        this.dom.enemyName.textContent = levelData.enemyName;
        
        this.startPlayerTurn();
        this.switchScreen('battle');
    }

    startPlayerTurn() {
        this.state.combat.turn = 'player';
        this.state.combat.phase = 'select';
        this.updateHpUI();
        this.showSkillMenu();
    }

    startEnemyTurn() {
        this.state.combat.turn = 'enemy';
        this.state.combat.phase = 'defense_quiz';
        this.state.combat.turnCount++;
        
        let attackDelay = 1000;
        let warningMsg = "";

        // Boss Ability: Rage (Every 3 turns, double damage)
        if (this.state.currentLevelData && this.state.currentLevelData.ability === 'rage') {
            if (this.state.combat.turnCount % 3 === 0) {
                this.state.enemy.stats.atk *= 2;
                warningMsg = "⚠️ BOSS ENRAGED! Massive Damage Incoming!";
                this.showDamage("RAGE!", 'enemy');
                this.dom.enemyChar.classList.add('shake');
            } else if (this.state.combat.turnCount % 3 === 1 && this.state.combat.turnCount > 1) {
                // Reset attack after rage turn
                this.state.enemy.stats.atk /= 2; 
            }
        }

        // Enemy Attack! Trigger Defense Question
        setTimeout(() => {
            this.dom.qText.textContent = warningMsg || `⚠️ ${this.state.enemyName} is attacking! Answer to defend!`;
            if (warningMsg) this.dom.qText.style.color = '#e74c3c';
            else this.dom.qText.style.color = '';
            
            this.showQuestion(true); // true = isDefense
            
            // Start Defense Timer
            this.startDefenseTimer(10); // 10 seconds to answer
        }, attackDelay);
    }

    startDefenseTimer(seconds) {
        const timerEl = document.getElementById('defense-timer');
        timerEl.style.display = 'block';
        timerEl.textContent = seconds;
        
        if (this.defenseTimerInterval) clearInterval(this.defenseTimerInterval);
        
        this.defenseTimerInterval = setInterval(() => {
            seconds--;
            timerEl.textContent = seconds;
            if (seconds <= 0) {
                clearInterval(this.defenseTimerInterval);
                timerEl.style.display = 'none';
                // Time out = Wrong Answer
                this.handleAnswer(-1, null); // -1 indicates timeout
            }
        }, 1000);
    }

    stopDefenseTimer() {
        if (this.defenseTimerInterval) clearInterval(this.defenseTimerInterval);
        document.getElementById('defense-timer').style.display = 'none';
    }

    async loadQuestions() {
        const realmMap = {
            1: "lianqi", 2: "zhuji", 3: "jiedan", 
            4: "yuanying", 5: "huashen", 6: "dacheng"
        };
        const realm = realmMap[this.state.grade] || "lianqi";
        const filename = `questions_grade_${this.state.grade}_${realm}.json`;

        try {
            const response = await fetch(`../../../data/ai/games/chinese-legend/${filename}`);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            // Shuffle questions to ensure variety each session
            for (let i = data.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [data[i], data[j]] = [data[j], data[i]];
            }
            this.state.questionBank = data;
            console.log(`Loaded ${data.length} questions for Realm ${realm}`);
        } catch (error) {
            console.warn("Failed to load questions, using fallback data.", error);
            this.state.questionBank = [
                { "id": "fb1", "type": "choice", "question": "Fallback Q1", "options": ["A", "B"], "answer": 0, "explanation": "..." }
            ];
        }
    }

    resetBattle() {
        // Apply Spirit Passives (Start of Battle)
        if (this.state.collection.spirits.includes('spirit_shui')) {
            this.healPlayer(10); // Water Spirit: Passive Heal
            this.showDamage("Water Spirit Heal!", 'player', true);
        }
        
        this.updateHpUI();
        this.showSkillMenu();
    }

    switchScreen(screenName) {
        this.dom.screens.forEach(s => s.classList.remove('active'));
        document.getElementById(`${screenName}-screen`).classList.add('active');
    }

    updateHpUI() {
        const pPct = (this.state.player.hp / this.state.player.maxHp) * 100;
        const ePct = (this.state.enemy.hp / this.state.enemy.maxHp) * 100;
        const iPct = (this.state.player.ink / this.state.player.maxInk) * 100;
        
        this.dom.playerHp.style.width = `${Math.max(0, pPct)}%`;
        this.dom.enemyHp.style.width = `${Math.max(0, ePct)}%`;
        
        // Update Boss HP if active
        const bossHp = document.getElementById('boss-hp');
        if (bossHp) bossHp.style.width = `${Math.max(0, ePct)}%`;

        if (this.dom.playerInk) {
            this.dom.playerInk.style.width = `${Math.max(0, iPct)}%`;
        }

        // Update skill buttons availability
        const skillCards = document.querySelectorAll('.skill-card');
        skillCards.forEach(card => {
            const type = card.dataset.type;
            let cost = 0;
            if (type === 'skill') cost = 30;
            if (type === 'heal') cost = 20;
            
            if (this.state.player.ink < cost) {
                card.classList.add('disabled');
            } else {
                card.classList.remove('disabled');
            }
        });
    }

    useSkill(type) {
        let cost = 0;
        if (type === 'skill') cost = 30;
        if (type === 'heal') cost = 20;

        if (this.state.player.ink < cost) {
            this.sound.playWrong(); // Not enough ink
            return;
        }

        this.state.combat.selectedSkill = type;
        this.state.combat.phase = 'attack_quiz';
        this.showQuestion();
    }

    showSkillMenu() {
        this.dom.skillMenu.classList.add('active');
        this.dom.questionPanel.classList.remove('active');
    }

    showQuestion(isDefense = false) {
        this.dom.skillMenu.classList.remove('active');
        this.dom.questionPanel.classList.add('active');

        // Filter questions based on phase
        let availableQuestions = this.state.questionBank;
        if (isDefense) {
            // Allow ALL questions for defense to prevent repetition (User Feedback Fix)
            // Previously restricted to subtype 'defense' which caused repetition
            availableQuestions = this.state.questionBank;
        } else {
            availableQuestions = this.state.questionBank.filter(q => q.subtype !== 'defense');
        }

        // Filter out used questions
        let unusedQuestions = availableQuestions.filter(q => !this.state.combat.usedQuestionIds.includes(q.id));
        
        // If all questions used, reset the used list for this type
        if (unusedQuestions.length === 0) {
            // Only clear IDs that belong to the current pool to avoid clearing everything
            const currentPoolIds = availableQuestions.map(q => q.id);
            this.state.combat.usedQuestionIds = this.state.combat.usedQuestionIds.filter(id => !currentPoolIds.includes(id));
            unusedQuestions = availableQuestions;
        }

        // Pick random question
        const q = unusedQuestions[Math.floor(Math.random() * unusedQuestions.length)];
        this.state.combat.usedQuestionIds.push(q.id);
        
        this.state.combat.currentQuestion = q;
        this.state.combat.questionStartTime = Date.now();

        // Pinyin Fix: Check if question contains pinyin-like characters and wrap/style
        const isPinyin = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(q.question);
        
        this.dom.qText.innerHTML = ''; // Clear text
        const prefix = document.createElement('span');
        prefix.textContent = isDefense ? "🛡️ DEFEND! " : "⚔️ ATTACK! ";
        this.dom.qText.appendChild(prefix);

        const content = document.createElement('span');
        content.textContent = q.question;
        if (isPinyin || q.subtype === 'pinyin') {
            content.className = 'pinyin-text';
        }
        this.dom.qText.appendChild(content);

        this.dom.qOptions.innerHTML = '';

        q.options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            if (isPinyin || q.subtype === 'pinyin') {
                btn.classList.add('pinyin-text');
            }
            btn.textContent = opt;
            btn.onclick = () => this.handleAnswer(idx, btn);
            this.dom.qOptions.appendChild(btn);
        });
    }

    handleAnswer(selectedIndex, btnElement) {
        // Stop timer if running
        this.stopDefenseTimer();

        if (btnElement && btnElement.disabled) return;
        const allBtns = this.dom.qOptions.querySelectorAll('button');
        allBtns.forEach(b => b.disabled = true);

        // Handle Timeout (-1)
        if (selectedIndex === -1) {
             this.sound.playWrong();
             this.performDefense(false);
             return;
        }

        const isCorrect = selectedIndex === this.state.combat.currentQuestion.answer;
        const timeTaken = (Date.now() - this.state.combat.questionStartTime) / 1000;
        const isPerfect = isCorrect && timeTaken < 3.0; // 3 seconds for perfect

        if (isCorrect) {
            btnElement.classList.add('correct');
            this.sound.playCorrect();
            
            if (this.state.combat.phase === 'attack_quiz') {
                this.performPlayerAttack(isPerfect);
            } else {
                this.performDefense(true);
            }

        } else {
            btnElement.classList.add('wrong');
            this.sound.playWrong();
            allBtns[this.state.combat.currentQuestion.answer].classList.add('correct');
            
            if (this.state.combat.phase === 'attack_quiz') {
                this.takeDamage(5, true); // Backlash damage
                setTimeout(() => this.startEnemyTurn(), 1000);
            } else {
                this.performDefense(false);
            }
        }
    }

    spawnParticles(x, y, color, count = 10) {
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.backgroundColor = color;
            p.style.left = x + 'px';
            p.style.top = y + 'px';
            
            // Random velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 50 + 20;
            const tx = Math.cos(angle) * speed;
            const ty = Math.sin(angle) * speed;
            
            p.style.setProperty('--tx', `${tx}px`);
            p.style.setProperty('--ty', `${ty}px`);
            
            document.body.appendChild(p);
            setTimeout(() => p.remove(), 800);
        }
    }

    shakeScreen(intensity = 10) {
        const container = document.getElementById('game-container');
        container.animate([
            { transform: `translate(0, 0)` },
            { transform: `translate(-${intensity}px, ${intensity}px)` },
            { transform: `translate(${intensity}px, -${intensity}px)` },
            { transform: `translate(-${intensity}px, -${intensity}px)` },
            { transform: `translate(${intensity}px, ${intensity}px)` },
            { transform: `translate(0, 0)` }
        ], {
            duration: 300,
            easing: 'ease-out'
        });
    }

    spawnProjectile(from, to, type = 'ink') {
        const startEl = from === 'player' ? this.dom.playerChar : this.dom.enemyChar;
        const endEl = to === 'player' ? this.dom.playerChar : this.dom.enemyChar;
        
        const startRect = startEl.getBoundingClientRect();
        const endRect = endEl.getBoundingClientRect();
        
        const projectile = document.createElement('div');
        projectile.className = `projectile ${type}`;
        
        // Initial Position
        const startX = startRect.left + startRect.width / 2;
        const startY = startRect.top + startRect.height / 2;
        projectile.style.left = `${startX}px`;
        projectile.style.top = `${startY}px`;
        
        document.body.appendChild(projectile);
        
        // Animate
        const endX = endRect.left + endRect.width / 2;
        const endY = endRect.top + endRect.height / 2;
        
        const anim = projectile.animate([
            { transform: 'translate(0, 0) scale(0.5)' },
            { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(1.5)` }
        ], {
            duration: 500,
            easing: 'ease-in'
        });
        
        anim.onfinish = () => projectile.remove();
        return anim.finished;
    }

    async performPlayerAttack(isPerfect) {
        let damage = this.state.player.stats.atk;
        let inkCost = 0;

        if (this.state.combat.selectedSkill === 'skill') {
            damage *= 1.5;
            inkCost = 30;
        }
        if (this.state.combat.selectedSkill === 'heal') {
            this.healPlayer(30);
            damage = 0;
            inkCost = 20;
            this.updateHpUI();
            setTimeout(() => this.startEnemyTurn(), 1500);
            return; // Skip attack animation for heal
        }

        // Spirit Passive: Lei (Thunder) - Chance for extra damage
        let isThunder = false;
        if (this.state.collection.spirits.includes('spirit_lei') && Math.random() < 0.3) {
            damage += 10;
            isThunder = true;
            this.showDamage("Thunder Strike!", 'enemy');
        }

        // Spirit Passive: Huo (Fire) - Flat damage boost
        if (this.state.collection.spirits.includes('spirit_huo')) {
            damage += 5;
        }

        // Spirit Passive: Feng (Wind) - Chance to attack twice (Double Strike)
        if (this.state.collection.spirits.includes('spirit_feng') && Math.random() < 0.15) {
             damage *= 2;
             this.showDamage("Wind Fury!", 'enemy');
        }

        // Critical Hit (Perfect Answer)
        if (isPerfect && damage > 0) {
            damage *= 1.5;
            this.showDamage("CRIT!", 'enemy');
            this.state.player.ink = Math.min(this.state.player.maxInk, this.state.player.ink + 10); // Recover Ink
        }

        // Consume Ink
        this.state.player.ink = Math.max(0, this.state.player.ink - inkCost);
        this.updateHpUI();

        if (damage > 0) {
            // Animation Sequence
            this.dom.playerChar.classList.add('attack-lunge');
            setTimeout(() => this.dom.playerChar.classList.remove('attack-lunge'), 500);
            
            const projType = isThunder ? 'thunder' : 'ink';
            await this.spawnProjectile('player', 'enemy', projType);

            // Impact FX
            const enemyRect = this.dom.enemyChar.getBoundingClientRect();
            this.spawnParticles(
                enemyRect.left + enemyRect.width/2, 
                enemyRect.top + enemyRect.height/2, 
                '#c0392b', 
                15
            );
            this.shakeScreen(isPerfect ? 15 : 5);

            this.sound.playAttack();
            this.state.enemy.hp -= damage;
            this.showDamage(Math.floor(damage), 'enemy');
            this.dom.enemyChar.classList.add('shake');
            setTimeout(() => this.dom.enemyChar.classList.remove('shake'), 500);
        }
        
        this.updateHpUI();
        
        if (this.state.enemy.hp <= 0) {
            this.checkWinCondition();
        } else {
            setTimeout(() => this.startEnemyTurn(), 1500);
        }
    }

    async performDefense(isSuccess) {
        let damage = this.state.enemy.stats.atk;
        
        // Defense Calculation
        damage = damage * (100 / (100 + this.state.player.stats.def));

        // Spirit Passive: Shan (Mountain) - Reduce damage taken
        if (this.state.collection.spirits.includes('spirit_shan')) {
            damage *= 0.9; 
        }

        // Enemy Attack Animation
        this.dom.enemyChar.classList.add('attack-lunge');
        setTimeout(() => this.dom.enemyChar.classList.remove('attack-lunge'), 500);
        
        await this.spawnProjectile('enemy', 'player', 'fire');

        if (isSuccess) {
            damage *= 0.3; // Block 70% damage
            this.showDamage("BLOCKED!", 'player', true);
            
            // Shield Visual
            const shield = document.getElementById('player-shield');
            shield.classList.add('active');
            setTimeout(() => shield.classList.remove('active'), 1000);

            // Block Particles
            const playerRect = this.dom.playerChar.getBoundingClientRect();
            this.spawnParticles(
                playerRect.left + playerRect.width/2, 
                playerRect.top + playerRect.height/2, 
                '#3498db', 
                10
            );

        } else {
            this.dom.playerChar.classList.add('shake');
            this.shakeScreen(10); // Shake on hit
            setTimeout(() => this.dom.playerChar.classList.remove('shake'), 500);
        }

        this.takeDamage(Math.floor(damage));
        
        if (this.state.player.hp > 0) {
            setTimeout(() => this.startPlayerTurn(), 1500);
        }
    }

    takeDamage(amount, isBacklash = false) {
        this.sound.playHit();
        this.state.player.hp -= amount;
        this.showDamage(amount, 'player');
        this.updateHpUI();
        this.checkWinCondition();
    }

    healPlayer(amount) {
        this.state.player.hp = Math.min(this.state.player.maxHp, this.state.player.hp + amount);
        this.showDamage(amount, 'player', true); 
        this.updateHpUI();
    }

    showDamage(amount, target, isHeal = false) {
        const text = document.createElement('div');
        text.className = 'damage-popup';
        text.textContent = isHeal ? `+${amount}` : `-${amount}`;
        text.style.color = isHeal ? '#2ecc71' : '#c0392b';
        text.style.position = 'absolute';
        text.style.left = target === 'player' ? '20%' : '80%';
        text.style.top = '40%';
        text.style.fontSize = '2rem';
        text.style.fontWeight = 'bold';
        text.style.transition = 'all 1s';
        
        this.dom.damageDisplay.appendChild(text);
        
        setTimeout(() => {
            text.style.transform = 'translateY(-50px)';
            text.style.opacity = '0';
        }, 50);

        setTimeout(() => text.remove(), 1000);
    }

    showSpiritDex() {
        this.switchScreen('spirit');
        this.dom.spiritGrid.innerHTML = '';

        this.spiritData.forEach(spirit => {
            const isUnlocked = this.state.collection.spirits.includes(spirit.id);
            
            const card = document.createElement('div');
            card.className = `spirit-card ${isUnlocked ? '' : 'locked'}`;
            
            card.innerHTML = `
                <div class="spirit-icon">${spirit.icon}</div>
                <div class="spirit-name">${isUnlocked ? spirit.name : '???'}</div>
                <div class="spirit-type">${spirit.type}</div>
            `;

            if (isUnlocked) {
                card.title = spirit.desc;
            }

            this.dom.spiritGrid.appendChild(card);
        });
    }

    checkWinCondition() {
        if (this.state.enemy.hp <= 0) {
            this.sound.playWin();
            
            // Mark level as completed
            if (!this.state.progress.completedLevels.includes(this.state.currentLevel)) {
                this.state.progress.completedLevels.push(this.state.currentLevel);
            }

            // Unlock next level
            const nextLevelId = this.state.currentLevel + 1;
            const hasNextLevel = this.state.levels.some(l => l.id === nextLevelId);
            
            if (hasNextLevel && !this.state.progress.unlockedLevels.includes(nextLevelId)) {
                this.state.progress.unlockedLevels.push(nextLevelId);
            }

            // Spirit Drop Logic (30% chance)
            let dropMsg = "";
            if (Math.random() < 0.3) {
                // Pick a random spirit not yet collected (or just random)
                const uncollected = this.spiritData.filter(s => !this.state.collection.spirits.includes(s.id));
                if (uncollected.length > 0) {
                    const newSpirit = uncollected[Math.floor(Math.random() * uncollected.length)];
                    this.state.collection.spirits.push(newSpirit.id);
                    dropMsg = `Captured Spirit: ${newSpirit.name} (${newSpirit.icon})!`;
                }
            }

            // Save Game
            this.saveData();

            // Show Result Screen
            setTimeout(() => {
                this.switchScreen('result');
                const resultTitle = document.querySelector('#result-screen h2');
                resultTitle.textContent = "Victory!";
                
                const rewards = document.querySelector('.rewards');
                rewards.innerHTML = `
                    <p>Exp Gained: 100</p>
                    ${dropMsg ? `<p style="color:var(--magic-blue); font-weight:bold;">${dropMsg}</p>` : ''}
                `;

                // Toggle Next Level Button
                if (hasNextLevel) {
                    this.dom.nextLevelBtn.style.display = 'block';
                } else {
                    this.dom.nextLevelBtn.style.display = 'none';
                    resultTitle.textContent = "Game Completed!";
                }
            }, 1000);

        } else if (this.state.player.hp <= 0) {
            this.sound.playWrong(); // Game Over sound?
            setTimeout(() => {
                this.switchScreen('result');
                document.querySelector('#result-screen h2').textContent = "Defeat...";
                this.dom.nextLevelBtn.style.display = 'none';
            }, 1000);
        }
    }

    goToNextLevel() {
        const nextLevelId = this.state.currentLevel + 1;
        const nextLevel = this.state.levels.find(l => l.id === nextLevelId);
        if (nextLevel) {
            this.startLevel(nextLevel);
        }
    }
}
window.onload = () => {
    const game = new Game();
};

