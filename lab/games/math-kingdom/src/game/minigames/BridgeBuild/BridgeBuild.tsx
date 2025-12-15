import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Waves } from 'lucide-react';
import { useGameStore } from '../../../core/store';
import { HUD } from '../../ui/HUD';
import { MathSprite } from '../../ui/MathSprite';
import { RewardPopup } from '../../ui/RewardPopup';
import tasksData from '../../../data/grade1/tasks.json';
import { initialDifficultyState, updateDifficulty, getHintType, type DifficultyState } from '../../../core/adaptiveDifficulty';

export const BridgeBuild: React.FC = () => {
  const navigate = useNavigate();
  const { addCoins, addStars, addXp, consumeEnergy } = useGameStore();
  
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [difficultyState, setDifficultyState] = useState<DifficultyState>(initialDifficultyState);
  
  const [showReward, setShowReward] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [spriteMessage, setSpriteMessage] = useState<string>("帮我搭桥过河吧！");
  const [bridgeProgress, setBridgeProgress] = useState(0); // 0 to 100
  
  // Load tasks
  useEffect(() => {
    const addSubTasks = tasksData.filter(t => t.domain === 'addsub');
    setTasks(addSubTasks);
    pickTask(addSubTasks, difficultyState.currentDifficulty);
  }, []);

  const pickTask = (taskList: any[], difficulty: number) => {
    // Find tasks with matching difficulty, fallback to closest
    let candidates = taskList.filter(t => t.difficulty === difficulty);
    if (candidates.length === 0) {
      candidates = taskList; // Fallback to all
    }
    const task = candidates[Math.floor(Math.random() * candidates.length)];
    setCurrentTask(task);
    setIsCorrect(null);
    setSpriteMessage("拖动正确的木板补全算式！");
  };

  const handleOptionClick = (option: number) => {
    if (showReward || isCorrect === true) return;

    const correct = option === currentTask.payload.target;
    const timeTaken = 5000; // Mock time for now

    // Update Adaptive Difficulty
    const newDiffState = updateDifficulty(difficultyState, correct, timeTaken);
    setDifficultyState(newDiffState);

    if (correct) {
      setIsCorrect(true);
      setSpriteMessage("太棒了！桥搭好了！");
      setBridgeProgress(100);
      
      // Rewards
      addCoins(15);
      addStars(1);
      addXp(25);
      
      setTimeout(() => setShowReward(true), 1000);
    } else {
      setIsCorrect(false);
      consumeEnergy(10);
      
      // Hint logic
      const hintType = getHintType(newDiffState);
      if (hintType === 'strong') {
        setSpriteMessage(`试试看：${currentTask.explain}`);
      } else {
        setSpriteMessage("哎呀，木板掉下去了！再试一次！");
      }
      
      // Reset incorrect state after animation
      setTimeout(() => setIsCorrect(null), 1000);
    }
  };

  const handleNext = () => {
    setShowReward(false);
    setBridgeProgress(0);
    pickTask(tasks, difficultyState.currentDifficulty);
  };

  if (!currentTask) return <div>Loading...</div>;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom, #4FC3F7 0%, #E1F5FE 100%)', // River/Sky theme
      padding: '2rem',
      paddingTop: '80px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <HUD />
      <MathSprite message={spriteMessage} emotion={isCorrect === true ? 'celebrate' : isCorrect === false ? 'thinking' : 'happy'} />

      <button 
        className="btn-secondary" 
        onClick={() => navigate('/map/grade1')}
        style={{ position: 'absolute', top: '90px', left: '2rem', zIndex: 10 }}
      >
        <ArrowLeft size={20} /> 退出
      </button>

      {/* Difficulty Indicator (Debug) */}
      <div style={{ position: 'absolute', top: '90px', right: '2rem', opacity: 0.5, fontSize: '0.8rem' }}>
        Difficulty: {difficultyState.currentDifficulty}
      </div>

      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2rem',
        position: 'relative',
        zIndex: 1
      }}>
        
        {/* Equation Display */}
        <div className="card" style={{ 
          padding: '2rem 4rem', 
          background: 'rgba(255,255,255,0.9)',
          borderRadius: '20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '3rem', margin: 0, letterSpacing: '4px' }}>
            {currentTask.payload.equation.replace('?', '___')}
          </h2>
        </div>

        {/* River Scene */}
        <div style={{
          width: '100%',
          height: '200px',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          {/* Left Bank */}
          <div style={{ width: '100px', height: '100%', background: '#8D6E63', borderRadius: '0 20px 0 0' }} />
          
          {/* Bridge Area */}
          <div style={{ flex: 1, height: '20px', background: 'rgba(0,0,0,0.1)', position: 'relative', margin: '0 10px' }}>
             {/* Completed Bridge Plank */}
             <motion.div 
               initial={{ width: 0 }}
               animate={{ width: bridgeProgress + '%' }}
               style={{ 
                 height: '100%', 
                 background: '#795548', 
                 boxShadow: '0 4px 0 #5D4037',
                 borderRadius: '4px'
               }}
             />
             
             {/* Water Animation */}
             <div style={{ position: 'absolute', top: '40px', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: '20px', opacity: 0.6 }}>
                <Waves size={24} color="#0288D1" />
                <Waves size={24} color="#0288D1" />
                <Waves size={24} color="#0288D1" />
             </div>
          </div>

          {/* Right Bank */}
          <div style={{ width: '100px', height: '100%', background: '#8D6E63', borderRadius: '20px 0 0 0' }} />
        </div>

        {/* Options (Planks) */}
        <div style={{
          display: 'flex',
          gap: '2rem',
          marginTop: '1rem'
        }}>
          {currentTask.payload.options.map((opt: number, idx: number) => (
            <motion.button
              key={`${currentTask.id}-${idx}`}
              whileHover={{ scale: 1.05, y: -5 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleOptionClick(opt)}
              style={{
                width: '100px',
                height: '140px',
                background: '#8D6E63', // Wood color
                border: 'none',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2.5rem',
                color: '#EFEBE9',
                fontWeight: 'bold',
                boxShadow: '4px 4px 0 #5D4037',
                cursor: 'pointer',
                position: 'relative'
              }}
            >
              {/* Wood texture lines */}
              <div style={{ position: 'absolute', top: 10, left: 10, right: 10, height: 2, background: 'rgba(0,0,0,0.1)' }} />
              <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10, height: 2, background: 'rgba(0,0,0,0.1)' }} />
              {opt}
            </motion.button>
          ))}
        </div>

      </div>

      <RewardPopup 
        visible={showReward} 
        coins={15} 
        stars={1} 
        isWin={true}
        onNext={handleNext} 
      />
    </div>
  );
};
