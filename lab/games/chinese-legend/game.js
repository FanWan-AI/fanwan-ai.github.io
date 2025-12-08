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
        this.state = {
            screen: 'start', // start, map, battle, result
            grade: 1,
            playerHp: 100,
            playerMaxHp: 100,
            ink: 100,
            maxInk: 100,
            enemyHp: 100,
            enemyMaxHp: 100,
            currentQuestion: null,
            questionBank: [],
            turn: 'player', // player, enemy
            selectedSkill: null,
            currentLevel: 0,
            levels: [
                { id: 1, name: "1-1 初入墨林", enemyName: "错别字小怪", hp: 60, boss: false },
                { id: 2, name: "1-2 墨迹深处", enemyName: "偏旁部首怪", hp: 80, boss: false },
                { id: 3, name: "1-3 墨魇领主", enemyName: "多音字魔王", hp: 150, boss: true }
            ],
            unlockedLevels: [1],
            completedLevels: []
        };

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
            enemyChar: document.getElementById('enemy-char'),
            // restartBtn: document.getElementById('restart-btn'), // Removed in HTML
            backMapBtn: document.getElementById('back-map-btn'),
            nextLevelBtn: document.getElementById('next-level-btn'),
            mapNodes: document.querySelector('.map-nodes'),
            backToMenuBtn: document.getElementById('back-to-menu-btn'),
            stageName: document.getElementById('stage-name'),
            enemyName: document.getElementById('enemy-name')
        };

        this.init();
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
            
            if (this.state.unlockedLevels.includes(level.id)) {
                node.classList.add('unlocked');
                node.onclick = () => this.startLevel(level);
            }

            if (this.state.completedLevels.includes(level.id)) {
                node.classList.add('completed');
            }
            
            if (level.boss) node.classList.add('boss');
            
            this.dom.mapNodes.appendChild(node);
        });
    }

    startLevel(levelData) {
        this.state.currentLevel = levelData.id;
        this.state.enemyMaxHp = levelData.hp;
        this.state.enemyHp = levelData.hp;
        this.state.playerHp = this.state.playerMaxHp; 
        this.state.ink = this.state.maxInk; // Reset Ink on new level
        
        this.dom.stageName.textContent = levelData.name;
        this.dom.enemyName.textContent = levelData.enemyName;
        
        this.resetBattle();
        this.switchScreen('battle');
    }

    async loadQuestions() {
        try {
            const response = await fetch('../../../assets/data/chinese-legend/questions_v1.json');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.state.questionBank = data.filter(q => Math.abs(q.grade - this.state.grade) <= 1);
            if (this.state.questionBank.length === 0) this.state.questionBank = data; 
        } catch (error) {
            console.warn("Failed to load questions, using fallback data.", error);
            this.state.questionBank = [
                { "id": "fb1", "type": "choice", "question": "Fallback Q1", "options": ["A", "B"], "answer": 0, "explanation": "..." }
            ];
        }
    }

    // async startGame() { ... } // Removed, replaced by showMap

    resetBattle() {
        this.updateHpUI();
        this.showSkillMenu();
    }

    switchScreen(screenName) {
        this.dom.screens.forEach(s => s.classList.remove('active'));
        document.getElementById(`${screenName}-screen`).classList.add('active');
    }

    updateHpUI() {
        const pPct = (this.state.playerHp / this.state.playerMaxHp) * 100;
        const ePct = (this.state.enemyHp / this.state.enemyMaxHp) * 100;
        const iPct = (this.state.ink / this.state.maxInk) * 100;
        
        this.dom.playerHp.style.width = `${Math.max(0, pPct)}%`;
        this.dom.enemyHp.style.width = `${Math.max(0, ePct)}%`;
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
            
            if (this.state.ink < cost) {
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

        if (this.state.ink < cost) {
            this.sound.playWrong(); // Not enough ink
            return;
        }

        this.state.selectedSkill = type;
        this.showQuestion();
    }

    showSkillMenu() {
        this.dom.skillMenu.classList.add('active');
        this.dom.questionPanel.classList.remove('active');
    }

    showQuestion() {
        this.dom.skillMenu.classList.remove('active');
        this.dom.questionPanel.classList.add('active');

        // Pick random question
        const q = this.state.questionBank[Math.floor(Math.random() * this.state.questionBank.length)];
        this.state.currentQuestion = q;

        this.dom.qText.textContent = q.question;
        this.dom.qOptions.innerHTML = '';

        q.options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt;
            btn.onclick = () => this.handleAnswer(idx, btn);
            this.dom.qOptions.appendChild(btn);
        });
    }

    handleAnswer(selectedIndex, btnElement) {
        if (btnElement.disabled) return;
        const allBtns = this.dom.qOptions.querySelectorAll('button');
        allBtns.forEach(b => b.disabled = true);

        const isCorrect = selectedIndex === this.state.currentQuestion.answer;

        if (isCorrect) {
            btnElement.classList.add('correct');
            this.sound.playCorrect();
            this.performPlayerAttack();
        } else {
            btnElement.classList.add('wrong');
            this.sound.playWrong();
            allBtns[this.state.currentQuestion.answer].classList.add('correct');
            this.takeDamage(10); 
        }

        setTimeout(() => {
            if (this.state.enemyHp > 0 && this.state.playerHp > 0) {
                this.showSkillMenu();
            }
        }, 1500);
    }

    performPlayerAttack() {
        let damage = 20;
        let inkCost = 0;

        if (this.state.selectedSkill === 'skill') {
            damage = 40;
            inkCost = 30;
        }
        if (this.state.selectedSkill === 'heal') {
            this.healPlayer(30);
            damage = 0;
            inkCost = 20;
        }

        // Consume Ink
        this.state.ink = Math.max(0, this.state.ink - inkCost);

        if (damage > 0) {
            this.sound.playAttack();
            this.state.enemyHp -= damage;
            this.showDamage(damage, 'enemy');
            this.dom.enemyChar.classList.add('shake');
            setTimeout(() => this.dom.enemyChar.classList.remove('shake'), 500);
        }
        
        this.updateHpUI();
        this.checkWinCondition();
    }

    takeDamage(amount) {
        this.sound.playHit();
        this.state.playerHp -= amount;
        this.showDamage(amount, 'player');
        this.updateHpUI();
        this.checkWinCondition();
    }

    healPlayer(amount) {
        this.state.playerHp = Math.min(this.state.playerMaxHp, this.state.playerHp + amount);
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

    checkWinCondition() {
        if (this.state.enemyHp <= 0) {
            this.sound.playWin();
            
            // Mark level as completed
            if (!this.state.completedLevels.includes(this.state.currentLevel)) {
                this.state.completedLevels.push(this.state.currentLevel);
            }

            // Unlock next level
            const nextLevelId = this.state.currentLevel + 1;
            const hasNextLevel = this.state.levels.some(l => l.id === nextLevelId);
            
            if (hasNextLevel && !this.state.unlockedLevels.includes(nextLevelId)) {
                this.state.unlockedLevels.push(nextLevelId);
            }

            // Show Result Screen
            setTimeout(() => {
                this.switchScreen('result');
                const resultTitle = document.querySelector('#result-screen h2');
                resultTitle.textContent = "Victory!";
                
                // Toggle Next Level Button
                if (hasNextLevel) {
                    this.dom.nextLevelBtn.style.display = 'block';
                } else {
                    this.dom.nextLevelBtn.style.display = 'none';
                    resultTitle.textContent = "Game Completed!";
                }
            }, 1000);

        } else if (this.state.playerHp <= 0) {
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

