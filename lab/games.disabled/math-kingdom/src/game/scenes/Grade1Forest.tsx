import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Apple, Waves, Shapes, Calendar, Swords } from 'lucide-react';
import { HUD } from '../ui/HUD';
import { MathSprite } from '../ui/MathSprite';

const levels = [
  { id: 'fruit-sort', name: '捡果子', icon: <Apple size={32} />, color: '#FF5722', desc: '数字认识与排序' },
  { id: 'bridge-build', name: '河流搭桥', icon: <Waves size={32} />, color: '#2196F3', desc: '10 以内加减法' },
  { id: 'shape-house', name: '形状积木屋', icon: <Shapes size={32} />, color: '#9C27B0', desc: '基础几何形状' },
  { id: 'season-sort', name: '四季分类', icon: <Calendar size={32} />, color: '#FFC107', desc: '分类与时间' },
];

export const Grade1Forest: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom, #A5D6A7 0%, #E8F5E9 100%)',
      padding: '2rem',
      paddingTop: '80px' // Space for HUD
    }}>
      <HUD />
      <MathSprite message="欢迎来到数字森林！我们要先去哪里探险呢？" />

      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
          <button 
            className="btn-secondary" 
            onClick={() => navigate('/map')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
          >
            <ArrowLeft size={20} /> 返回地图
          </button>
          <h1 style={{ marginLeft: '1rem', color: '#2E7D32', margin: '0 0 0 1rem' }}>数字森林</h1>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '2rem'
        }}>
          {/* Main Levels */}
          {levels.map((level, index) => (
            <motion.div
              key={level.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.03 }}
              className="card"
              style={{
                cursor: 'pointer',
                borderTop: `6px solid ${level.color}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '2rem',
                textAlign: 'center'
              }}
              onClick={() => {
                if (level.id === 'fruit-sort') {
                  navigate('/game/grade1/fruit-sort');
                } else if (level.id === 'bridge-build') {
                  navigate('/game/grade1/bridge-build');
                } else if (level.id === 'shape-house') {
                  navigate('/game/grade1/shape-house');
                } else if (level.id === 'season-sort') {
                  navigate('/game/grade1/season-sort');
                } else {
                  alert(`进入关卡: ${level.name} (开发中)`);
                }
              }}
            >
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: `${level.color}20`,
                color: level.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1rem'
              }}>
                {level.icon}
              </div>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.5rem' }}>{level.name}</h3>
              <p style={{ margin: 0, color: '#666' }}>{level.desc}</p>
            </motion.div>
          ))}

          {/* Endless Mode */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            whileHover={{ scale: 1.03 }}
            className="card"
            style={{
              gridColumn: '1 / -1',
              background: 'linear-gradient(135deg, #3F51B5 0%, #2196F3 100%)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '2rem',
              cursor: 'pointer',
              marginTop: '1rem'
            }}
            onClick={() => alert('进入无限挑战 (开发中)')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Swords size={32} color="white" />
              </div>
              <div style={{ textAlign: 'left' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.8rem' }}>无限挑战：森林试炼</h3>
                <p style={{ margin: 0, opacity: 0.9 }}>混合所有题型，挑战最高连胜纪录！</p>
              </div>
            </div>
            <div className="btn-secondary" style={{ background: 'white', color: '#3F51B5' }}>
              开始挑战
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
