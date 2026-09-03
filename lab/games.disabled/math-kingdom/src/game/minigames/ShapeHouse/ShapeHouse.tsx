import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Square, Circle, Triangle, RectangleHorizontal } from 'lucide-react';
import { useGameStore } from '../../../core/store';
import { HUD } from '../../ui/HUD';
import { MathSprite } from '../../ui/MathSprite';
import { RewardPopup } from '../../ui/RewardPopup';
import tasksData from '../../../data/grade1/tasks.json';

const ShapeIcon = ({ type, size = 64, color = 'white' }: { type: string, size?: number, color?: string }) => {
  switch (type) {
    case 'square': return <Square size={size} fill={color} color={color} />;
    case 'circle': return <Circle size={size} fill={color} color={color} />;
    case 'triangle': return <Triangle size={size} fill={color} color={color} />;
    case 'rectangle': return <RectangleHorizontal size={size} fill={color} color={color} />;
    default: return null;
  }
};

export const ShapeHouse: React.FC = () => {
  const navigate = useNavigate();
  const { addCoins, addStars, addXp, consumeEnergy } = useGameStore();
  
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [showReward, setShowReward] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [spriteMessage, setSpriteMessage] = useState<string>("帮我盖房子吧！");
  
  useEffect(() => {
    const shapeTasks = tasksData.filter(t => t.domain === 'shape');
    setTasks(shapeTasks);
    pickTask(shapeTasks);
  }, []);

  const pickTask = (taskList: any[]) => {
    const task = taskList[Math.floor(Math.random() * taskList.length)];
    setCurrentTask(task);
    setIsCorrect(null);
    setSpriteMessage("哪个形状能填进缺口里？");
  };

  const handleOptionClick = (option: string) => {
    if (showReward || isCorrect === true) return;

    const correct = option === currentTask.payload.target;

    if (correct) {
      setIsCorrect(true);
      setSpriteMessage("太棒了！形状刚刚好！");
      addCoins(10);
      addStars(1);
      addXp(20);
      setTimeout(() => setShowReward(true), 1000);
    } else {
      setIsCorrect(false);
      consumeEnergy(5);
      setSpriteMessage(currentTask.explain || "形状不对哦，再试一次！");
      setTimeout(() => setIsCorrect(null), 1000);
    }
  };

  const handleNext = () => {
    setShowReward(false);
    pickTask(tasks);
  };

  if (!currentTask) return <div>Loading...</div>;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom, #FFF9C4 0%, #FFF176 100%)',
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
        
        {/* House Construction Site */}
        <div style={{
          width: '300px',
          height: '300px',
          background: '#795548',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '8px 8px 0 0',
          boxShadow: '0 10px 20px rgba(0,0,0,0.2)'
        }}>
          {/* Roof */}
          <div style={{
            position: 'absolute',
            top: '-100px',
            left: '-20px',
            width: 0,
            height: 0,
            borderLeft: '170px solid transparent',
            borderRight: '170px solid transparent',
            borderBottom: '100px solid #5D4037'
          }} />

          {/* The Hole (Target) */}
          <div style={{
            width: '120px',
            height: '120px',
            background: 'rgba(0,0,0,0.3)',
            border: '4px dashed #FFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
             {isCorrect && (
               <motion.div
                 initial={{ scale: 0 }}
                 animate={{ scale: 1 }}
               >
                 <ShapeIcon type={currentTask.payload.target} size={100} color="#FFC107" />
               </motion.div>
             )}
          </div>
        </div>

        <h2 style={{ margin: 0 }}>{currentTask.prompt}</h2>

        {/* Options */}
        <div style={{
          display: 'flex',
          gap: '2rem',
          marginTop: '1rem'
        }}>
          {currentTask.payload.options.map((opt: string, idx: number) => (
            <motion.button
              key={`${currentTask.id}-${idx}`}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => handleOptionClick(opt)}
              style={{
                width: '100px',
                height: '100px',
                background: '#2196F3',
                border: 'none',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
              }}
            >
              <ShapeIcon type={opt} size={60} />
            </motion.button>
          ))}
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
