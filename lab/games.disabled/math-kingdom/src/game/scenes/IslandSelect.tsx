import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, MapPin } from 'lucide-react';

const islands = [
  { id: 'grade1', name: '数字森林', level: 1, unlocked: true, color: '#4CAF50' },
  { id: 'grade2', name: '算术村庄', level: 2, unlocked: false, color: '#8BC34A' },
  { id: 'grade3', name: '几何之城', level: 3, unlocked: false, color: '#03A9F4' },
  { id: 'grade4', name: '分数山谷', level: 4, unlocked: false, color: '#9C27B0' },
  { id: 'grade5', name: '比例沙漠', level: 5, unlocked: false, color: '#FF9800' },
  { id: 'grade6', name: '方程群岛', level: 6, unlocked: false, color: '#F44336' },
];

export const IslandSelect: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      padding: '2rem',
      background: 'linear-gradient(to bottom, #87CEEB 0%, #E0F7FA 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      <h2 style={{ 
        fontSize: '2.5rem', 
        color: '#fff', 
        textShadow: '0 2px 4px rgba(0,0,0,0.2)',
        marginBottom: '2rem'
      }}>
        选择你的冒险
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '2rem',
        width: '100%',
        maxWidth: '1000px'
      }}>
        {islands.map((island, index) => (
          <motion.div
            key={island.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={island.unlocked ? { scale: 1.05 } : {}}
            onClick={() => {
              if (island.unlocked) {
                navigate(`/map/${island.id}`);
              }
            }}
            className="card"
            style={{
              cursor: island.unlocked ? 'pointer' : 'not-allowed',
              opacity: island.unlocked ? 1 : 0.7,
              background: island.unlocked ? 'white' : '#eee',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '2rem',
              position: 'relative',
              border: `4px solid ${island.color}`
            }}
          >
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: island.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
              color: 'white'
            }}>
              {island.unlocked ? <MapPin size={40} /> : <Lock size={40} />}
            </div>
            
            <h3 style={{ margin: 0, fontSize: '1.5rem', color: '#333' }}>{island.name}</h3>
            <p style={{ margin: '0.5rem 0 0', color: '#666' }}>{island.level} 年级</p>
            
            {!island.unlocked && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(255,255,255,0.5)',
                borderRadius: '12px'
              }} />
            )}
          </motion.div>
        ))}
      </div>
      
      <button 
        className="btn-secondary" 
        style={{ marginTop: '3rem' }}
        onClick={() => navigate('/')}
      >
        返回主页
      </button>
    </div>
  );
};
