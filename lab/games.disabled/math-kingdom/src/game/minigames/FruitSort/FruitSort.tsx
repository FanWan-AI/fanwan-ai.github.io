import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useGameStore } from '../../../core/store';
import { HUD } from '../../ui/HUD';
import { MathSprite } from '../../ui/MathSprite';
import { RewardPopup } from '../../ui/RewardPopup';
import tasksData from '../../../data/grade1/tasks.json';

// Simple shuffle function
const shuffle = <T,>(array: T[]): T[] => {
  return [...array].sort(() => Math.random() - 0.5);
};

export const FruitSort: React.FC = () => {
  const navigate = useNavigate();
  const { addCoins, addStars, addXp, consumeEnergy } = useGameStore();
  
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showReward, setShowReward] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [spriteMessage, setSpriteMessage] = useState<string>("把正确的果子拖到篮子里！");
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    // Filter for 'number' domain tasks and shuffle
    const numberTasks = tasksData.filter(t => t.domain === 'number');
    setTasks(shuffle(numberTasks));
  }, []);

  const currentTask = tasks[currentTaskIndex];

  const handleOptionClick = (option: number) => {
    if (showReward) return;
    
    setSelectedOption(option);
    
    // Simple logic for "match" type tasks (MVP)
    // In a real app, we'd handle different payload types more robustly
    let correct = false;
    
    if (currentTask.payload.type === 'match') {
      correct = option === currentTask.payload.target;
    } else if (currentTask.payload.type === 'compare-greater') {
      correct = option > currentTask.payload.target; // Wait, target is the reference value in prompt usually? 
      // Let's check data: "target": 5, "options": [1, 2, 5], prompt: "哪个数字比 2 大？" -> target should be the correct answer or reference?
      // In my JSON: "target": 5 (correct answer), "options": [1, 2, 5]. So check equality with target.
      correct = option === currentTask.payload.target;
    } else if (currentTask.payload.type === 'compare-smaller') {
      correct = option === currentTask.payload.target;
    } else if (currentTask.payload.type === 'counting') {
      correct = option === currentTask.payload.target;
    }

    setIsCorrect(correct);
    
    if (correct) {
      setSpriteMessage("太棒了！答对了！");
      setStreak(s => s + 1);
      // Rewards
      const streakBonus = Math.floor(streak / 3);
      addCoins(10 + streakBonus * 5);
      addStars(1);
      addXp(20);
      setShowReward(true);
    } else {
      setSpriteMessage(currentTask.explain || "再试一次哦！");
      setStreak(0);
      consumeEnergy(5);
      // Shake effect or sound could go here
    }
  };

  const handleNext = () => {
    setShowReward(false);
    setSelectedOption(null);
    if (currentTaskIndex < tasks.length - 1) {
      setCurrentTaskIndex(prev => prev + 1);
      setSpriteMessage("准备好下一题了吗？");
    } else {
      // Level Complete
      setSpriteMessage("恭喜你完成了所有任务！");
      navigate('/map/grade1');
    }
  };

  if (!currentTask) return <div>Loading...</div>;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom, #81C784 0%, #C8E6C9 100%)',
      padding: '2rem',
      paddingTop: '80px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <HUD />
      <MathSprite message={spriteMessage} emotion={isCorrect ? 'celebrate' : 'happy'} />

      {/* Back Button */}
      <button 
        className="btn-secondary" 
        onClick={() => navigate('/map/grade1')}
        style={{ position: 'absolute', top: '90px', left: '2rem', zIndex: 10 }}
      >
        <ArrowLeft size={20} /> 退出
      </button>

      {/* Game Area */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2rem'
      }}>
        {/* Question Board */}
        <div className="card" style={{ 
          padding: '2rem', 
          width: '100%', 
          textAlign: 'center',
          background: 'white',
          border: '4px solid #4CAF50'
        }}>
          <h2 style={{ fontSize: '2rem', margin: 0 }}>{currentTask.prompt}</h2>
        </div>

        {/* Basket (Target) - Visual only for now, or drop target */}
        <div style={{
          width: '200px',
          height: '150px',
          background: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'150\' viewBox=\'0 0 200 150\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M20 50 L180 50 L160 140 L40 140 Z\' fill=\'%23795548\'/%3E%3C/svg%3E") no-repeat center bottom',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: '2rem'
        }}>
          {/* If it's a matching task, maybe show the target number on the basket? */}
          {currentTask.payload.type === 'match' && (
            <span style={{ fontSize: '4rem', color: 'white', fontWeight: 'bold', textShadow: '2px 2px 0 #3E2723' }}>
              {currentTask.payload.target}
            </span>
          )}
        </div>

        {/* Options (Fruits) */}
        <div style={{
          display: 'flex',
          gap: '2rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
          marginTop: '2rem'
        }}>
          <AnimatePresence mode='popLayout'>
            {currentTask.payload.options.map((opt: number, idx: number) => (
              <motion.div
                key={`${currentTask.id}-${idx}`}
                initial={{ scale: 0, y: 50 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                whileHover={{ scale: 1.1, rotate: 10 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleOptionClick(opt)}
                style={{
                  width: '100px',
                  height: '100px',
                  background: selectedOption === opt ? '#E64A19' : '#FF5722',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                  position: 'relative'
                }}
              >
                {/* Stem/Leaf */}
                <div style={{ position: 'absolute', top: -10, width: 10, height: 20, background: '#5D4037', borderRadius: 4 }} />
                <div style={{ position: 'absolute', top: -5, right: 20, width: 30, height: 15, background: '#4CAF50', borderRadius: '50% 0 50% 0' }} />
                
                <span style={{ fontSize: '3rem', color: 'white', fontWeight: 'bold' }}>{opt}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <RewardPopup 
        visible={showReward} 
        coins={10} 
        stars={1} 
        isWin={true}
        onNext={handleNext} 
      />
    </div>
  );
};
