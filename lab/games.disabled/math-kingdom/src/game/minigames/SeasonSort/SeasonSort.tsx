import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Sun, CloudSnow, CloudRain, Leaf, Clock } from 'lucide-react';
import { useGameStore } from '../../../core/store';
import { HUD } from '../../ui/HUD';
import { MathSprite } from '../../ui/MathSprite';
import { RewardPopup } from '../../ui/RewardPopup';
import tasksData from '../../../data/grade1/tasks.json';

export const SeasonSort: React.FC = () => {
  const navigate = useNavigate();
  const { addCoins, addStars, addXp, consumeEnergy } = useGameStore();
  
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [showReward, setShowReward] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [spriteMessage, setSpriteMessage] = useState<string>("我们来学习季节和时间吧！");
  
  useEffect(() => {
    const seasonTasks = tasksData.filter(t => t.domain === 'classify' || t.domain === 'time');
    setTasks(seasonTasks);
    pickTask(seasonTasks);
  }, []);

  const pickTask = (taskList: any[]) => {
    const task = taskList[Math.floor(Math.random() * taskList.length)];
    setCurrentTask(task);
    setIsCorrect(null);
    setSpriteMessage(task.domain === 'time' ? "现在是几点钟？" : "这个属于哪个季节？");
  };

  const handleOptionClick = (option: string) => {
    if (showReward || isCorrect === true) return;

    const correct = option === currentTask.payload.target;

    if (correct) {
      setIsCorrect(true);
      setSpriteMessage("答对了！你真聪明！");
      addCoins(10);
      addStars(1);
      addXp(20);
      setTimeout(() => setShowReward(true), 1000);
    } else {
      setIsCorrect(false);
      consumeEnergy(5);
      setSpriteMessage(currentTask.explain || "不对哦，再想想！");
      setTimeout(() => setIsCorrect(null), 1000);
    }
  };

  const handleNext = () => {
    setShowReward(false);
    pickTask(tasks);
  };

  if (!currentTask) return <div>Loading...</div>;

  const isTimeTask = currentTask.domain === 'time';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom, #E0F7FA 0%, #B2EBF2 100%)',
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

      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2rem'
      }}>
        
        {/* Question Area */}
        <div className="card" style={{ padding: '2rem', textAlign: 'center', minWidth: '300px' }}>
          <h2 style={{ margin: 0, marginBottom: '1rem' }}>{currentTask.prompt}</h2>
          
          {isTimeTask ? (
            <div style={{ 
              width: '150px', 
              height: '150px', 
              border: '8px solid #333', 
              borderRadius: '50%', 
              position: 'relative',
              margin: '0 auto',
              background: 'white'
            }}>
              {/* Clock Face */}
              <div style={{ position: 'absolute', top: '50%', left: '50%', width: '10px', height: '10px', background: '#333', borderRadius: '50%', transform: 'translate(-50%, -50%)' }} />
              {/* Hour Hand */}
              <div style={{ 
                position: 'absolute', 
                top: '50%', left: '50%', 
                width: '6px', height: '40px', 
                background: '#333', 
                transformOrigin: 'bottom center',
                transform: `translate(-50%, -100%) rotate(${currentTask.payload.clock * 30}deg)`
              }} />
              {/* Minute Hand (Always 12 for MVP) */}
              <div style={{ 
                position: 'absolute', 
                top: '50%', left: '50%', 
                width: '4px', height: '60px', 
                background: '#666', 
                transformOrigin: 'bottom center',
                transform: `translate(-50%, -100%) rotate(0deg)`
              }} />
            </div>
          ) : (
            <div style={{ fontSize: '4rem' }}>
              {currentTask.payload.item === 'snowman' ? '⛄' : '🍉'}
            </div>
          )}
        </div>

        {/* Options */}
        <div style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
          marginTop: '1rem'
        }}>
          {currentTask.payload.options.map((opt: string, idx: number) => {
            let icon = null;
            let label = opt;
            let color = '#2196F3';

            if (!isTimeTask) {
              switch(opt) {
                case 'spring': icon = <Leaf />; label = '春天'; color = '#66BB6A'; break;
                case 'summer': icon = <Sun />; label = '夏天'; color = '#FFA726'; break;
                case 'autumn': icon = <CloudRain />; label = '秋天'; color = '#FF7043'; break; // Using Rain for autumn for now
                case 'winter': icon = <CloudSnow />; label = '冬天'; color = '#42A5F5'; break;
              }
            } else {
              icon = <Clock />;
              color = '#7E57C2';
            }

            return (
              <motion.button
                key={`${currentTask.id}-${idx}`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleOptionClick(opt)}
                style={{
                  width: '120px',
                  height: '120px',
                  background: color,
                  border: 'none',
                  borderRadius: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'white',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  gap: '0.5rem',
                  boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                }}
              >
                {icon}
                <span>{label}</span>
              </motion.button>
            );
          })}
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
